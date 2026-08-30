/* =====================================================================
 * api.js — Datenschicht auf Supabase (Auth + Postgres + Storage)
 * =====================================================================
 * WICHTIG: Die Methodennamen und Rückgabeformate sind bewusst identisch
 * zum ursprünglichen Prototyp gehalten. Dadurch funktioniert das gesamte
 * Frontend (app.js) unverändert — nur die Daten kommen jetzt aus einer
 * echten Datenbank statt aus dem Browser-Speicher.
 * =================================================================== */

/* ---- Supabase-Client initialisieren ---- */
const _cfg = window.WPM_CONFIG || {};
if (!_cfg.SUPABASE_URL || _cfg.SUPABASE_URL.startsWith('DEINE')) {
  console.error('Supabase ist noch nicht konfiguriert. Bitte js/config.js ausfüllen.');
}
const sb = window.supabase.createClient(_cfg.SUPABASE_URL, _cfg.SUPABASE_ANON_KEY);

/* ---------------------------------------------------------------
 * Geo-Helfer (unverändert aus dem Prototyp)
 * ------------------------------------------------------------- */
const Geo = {
  haversineKm(a, b) {
    const R = 6371, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  },
  routeKm(a, b) { return this.haversineKm(a, b) * 1.3; },
};

/* ---------------------------------------------------------------
 * Geocoding & Routing (Nominatim + OSRM), unverändert
 * ------------------------------------------------------------- */
const GeoService = {
  async search(query, near) {
    if (!query || query.trim().length < 3) return [];
    let url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=de,at,ch&addressdetails=1&q=' + encodeURIComponent(query);
    if (near && near.lat && near.lng) {
      const d = 1.5;
      url += `&viewbox=${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`;
    }
    const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
    if (!res.ok) throw new Error('Adresssuche nicht erreichbar');
    let data = await res.json();
    if (near && near.lat && near.lng) {
      data = data.sort((a, b) =>
        Geo.haversineKm(near, { lat: +a.lat, lng: +a.lon }) -
        Geo.haversineKm(near, { lat: +b.lat, lng: +b.lon }));
    }
    return data.map((d) => ({
      label: d.display_name,
      shortLabel: d.display_name.split(',').slice(0, 3).join(',').trim(),
      lat: parseFloat(d.lat), lng: parseFloat(d.lon),
    }));
  },
  async route(a, b) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('routing down');
      const data = await res.json();
      const r = data.routes[0];
      return {
        km: Math.round((r.distance / 1000) * 10) / 10,
        minutes: Math.round(r.duration / 60),
        line: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        estimated: false,
      };
    } catch (e) {
      return { km: Math.round(Geo.routeKm(a, b) * 10) / 10, minutes: null, line: [[a.lat, a.lng], [b.lat, b.lng]], estimated: true };
    }
  },
};

/* ---------------------------------------------------------------
 * Mapping-Helfer: DB-Zeile (snake_case) <-> App-Objekt (camelCase)
 * Damit app.js dieselbe Objektform wie im Prototyp bekommt.
 * ------------------------------------------------------------- */
function rowToRider(p) {
  if (!p) return null;
  return {
    id: p.id, name: p.full_name, phone: p.phone,
    rating: p.rider_rating, trips: p.rider_trips || 0,
    isAdmin: !!p.is_admin, isBlocked: !!p.is_blocked,
    blockedUntil: p.blocked_until || null, warnings: p.warnings || 0, offersDisabled: !!p.offers_disabled,
    location: p.location_lat != null
      ? { label: p.location_label, lat: p.location_lat, lng: p.location_lng }
      : { label: '', lat: null, lng: null },
    horse: {
      name: p.horse_name || '', breed: p.horse_breed || '',
      height: p.horse_height || 0, weight: p.horse_weight || 0,
      temperament: p.horse_temperament || 'ruhig',
      loadingOk: p.horse_loading_ok !== false, notes: p.horse_notes || '',
    },
  };
}
function rowToDriver(p) {
  if (!p) return null;
  return {
    id: p.id, name: p.full_name, phone: p.phone,
    rating: p.driver_rating, trips: p.driver_trips || 0,
    isAdmin: !!p.is_admin, isBlocked: !!p.is_blocked,
    blockedUntil: p.blocked_until || null, warnings: p.warnings || 0, offersDisabled: !!p.offers_disabled,
    providerType: p.provider_type || 'private',
    company: { name: p.company_name || '', address: p.company_address || '', register: p.company_register || '' },
    selfDeclaredAt: p.self_declaration_at || null,
    location: p.location_lat != null
      ? { label: p.location_label, lat: p.location_lat, lng: p.location_lng }
      : { label: '', lat: null, lng: null },
    vehicle: {
      make: p.vehicle_make || '', model: p.vehicle_model || '',
      trailer: p.vehicle_trailer || '', capacity: p.vehicle_capacity || 2,
      plate: p.vehicle_plate || '',
    },
    pricePerKm: Number(p.price_per_km) || 0, basePrice: Number(p.base_price) || 0,
    maxRadiusKm: p.max_radius_km || 40,
    availability: {
      mon: p.av_mon, tue: p.av_tue, wed: p.av_wed, thu: p.av_thu,
      fri: p.av_fri, sat: p.av_sat, sun: p.av_sun, from: p.av_from, to: p.av_to,
    },
    payment: { cash: p.pay_cash, card: p.pay_card, invoice: p.pay_invoice },
    documents: {
      license: p.doc_license_path ? { fileName: p.doc_license_name, path: p.doc_license_path } : null,
      transportPermit: p.doc_permit_path ? { fileName: p.doc_permit_name, path: p.doc_permit_path } : null,
    },
    declarations: {
      license: !!p.decl_license,
      vehicle: !!p.decl_vehicle,
      eu1_2005: !!p.decl_eu_1_2005,
      trailerInsurance: !!p.decl_trailer_insurance,
    },
    declarationsAt: p.declarations_at || null,
    cancellationPolicy: {
      more48: p.cancel_more48 || 'free',
      h24_48: p.cancel_24_48 || 'free',
      h6_24: p.cancel_6_24 || 'base_fee',
      under6: p.cancel_under6 || 'base_fee',
      customText: p.cancel_custom_text || '',
    },
  };
}
function rowToRequest(r) {
  if (!r) return null;
  return {
    id: r.id, riderId: r.rider_id,
    pickup: { label: r.pickup_label, lat: r.pickup_lat, lng: r.pickup_lng },
    dropoff: { label: r.dropoff_label, lat: r.dropoff_lat, lng: r.dropoff_lng },
    when: new Date(r.when_ts).getTime(),
    urgent: r.urgent, horseCount: r.horse_count, loadingHelp: r.loading_help,
    routeKm: Number(r.route_km), routeMinutes: r.route_minutes, routeLine: r.route_line,
    status: r.status, acceptedOfferId: r.accepted_offer_id,
    createdAt: new Date(r.created_at).getTime(),
  };
}
function rowToOffer(o) {
  if (!o) return null;
  return {
    id: o.id, requestId: o.request_id, driverId: o.driver_id,
    price: Number(o.price), pricePerKm: Number(o.price_per_km), basePrice: Number(o.base_price),
    priceMode: o.price_mode || 'per_km', flatPrice: o.flat_price != null ? Number(o.flat_price) : null,
    routeKm: Number(o.route_km), status: o.status,
    acceptedAt: o.accepted_at ? new Date(o.accepted_at).getTime() : null,
    cancelWindowMs: o.cancel_window_ms,
    cancellationPolicy: o.cancellation_policy || null,
    cancellationCategory: o.cancellation_category || null,
    cancellationReason: o.cancellation_reason || '',
    cancellationMutual: !!o.cancellation_mutual,
    cancelledBy: o.cancelled_by, cancelledAt: o.cancelled_at ? new Date(o.cancelled_at).getTime() : null,
    // Zweistufige Absage
    cancelRequestedBy: o.cancel_requested_by || null,
    cancelRequestedAt: o.cancel_requested_at ? new Date(o.cancel_requested_at).getTime() : null,
    cancelRequestCategory: o.cancel_request_category || null,
    cancelRequestReason: o.cancel_request_reason || '',
    cancelConfirmComment: o.cancel_confirm_comment || '',
    riderCompleted: o.rider_completed, driverCompleted: o.driver_completed,
    completedAt: o.completed_at ? new Date(o.completed_at).getTime() : null,
    ratingByRider: o.rating_by_rider_stars ? { stars: o.rating_by_rider_stars, comment: o.rating_by_rider_comment || '', at: new Date(o.rating_by_rider_at).getTime() } : null,
    ratingByDriver: o.rating_by_driver_stars ? { stars: o.rating_by_driver_stars, comment: o.rating_by_driver_comment || '', at: new Date(o.rating_by_driver_at).getTime() } : null,
  };
}

function rowToEmptyRun(e) {
  if (!e) return null;
  return {
    id: e.id, driverId: e.driver_id,
    from: { label: e.from_label, lat: e.from_lat, lng: e.from_lng },
    to: { label: e.to_label, lat: e.to_lat, lng: e.to_lng },
    when: new Date(e.when_ts).getTime(),
    seats: e.seats, price: e.price != null ? Number(e.price) : null, priceNote: e.price_note || '', note: e.note || '',
    routeKm: e.route_km != null ? Number(e.route_km) : null, routeMinutes: e.route_minutes, routeLine: e.route_line,
    status: e.status, acceptedApplicationId: e.accepted_application_id,
    createdAt: new Date(e.created_at).getTime(),
  };
}
function rowToApplication(a) {
  if (!a) return null;
  return {
    id: a.id, emptyRunId: a.empty_run_id, riderId: a.rider_id,
    pickup: { label: a.pickup_label, lat: a.pickup_lat, lng: a.pickup_lng },
    dropoff: { label: a.dropoff_label, lat: a.dropoff_lat, lng: a.dropoff_lng },
    horseCount: a.horse_count, loadingHelp: a.loading_help, message: a.message || '',
    status: a.status,
    acceptedAt: a.accepted_at ? new Date(a.accepted_at).getTime() : null,
    cancelWindowMs: a.cancel_window_ms,
    cancellationCategory: a.cancellation_category || null,
    cancellationReason: a.cancellation_reason || '',
    cancellationMutual: !!a.cancellation_mutual,
    cancelledBy: a.cancelled_by, cancelledAt: a.cancelled_at ? new Date(a.cancelled_at).getTime() : null,
    cancelRequestedBy: a.cancel_requested_by || null,
    cancelRequestedAt: a.cancel_requested_at ? new Date(a.cancel_requested_at).getTime() : null,
    cancelRequestCategory: a.cancel_request_category || null,
    cancelRequestReason: a.cancel_request_reason || '',
    cancelConfirmComment: a.cancel_confirm_comment || '',
    riderCompleted: a.rider_completed, driverCompleted: a.driver_completed,
    completedAt: a.completed_at ? new Date(a.completed_at).getTime() : null,
    ratingByRider: a.rating_by_rider_stars ? { stars: a.rating_by_rider_stars, comment: a.rating_by_rider_comment || '', at: new Date(a.rating_by_rider_at).getTime() } : null,
    ratingByDriver: a.rating_by_driver_stars ? { stars: a.rating_by_driver_stars, comment: a.rating_by_driver_comment || '', at: new Date(a.rating_by_driver_at).getTime() } : null,
    createdAt: new Date(a.created_at).getTime(),
  };
}

/* ---------------------------------------------------------------
 * Öffentliche API — gleiche Methoden wie im Prototyp
 * ------------------------------------------------------------- */
const API = {
  Geo, GeoService,

  /* ==== AUTH ==== */
  async signUp(email, password, fullName, phone) {
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { full_name: fullName, phone } },
    });
    if (error) throw new Error(_authMsg(error.message));
    return data;
  },
  async signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(_authMsg(error.message));
    return data;
  },
  async signOut() { await sb.auth.signOut(); },
  async currentUser() {
    const { data } = await sb.auth.getUser();
    return data.user || null;
  },
  onAuthChange(cb) { sb.auth.onAuthStateChange((_e, session) => cb(session?.user || null)); },

  /**
   * Zaehlt laufende Fahrten des aktuellen Nutzers: angenommenes Angebot
   * (status 'accepted'), noch nicht abgeschlossen (completed_at null) —
   * egal ob als Fahrer oder als Reiter (ueber die eigene Anfrage).
   * Dient der UI-Vorabpruefung vor der Konto-Loeschung.
   */
  async activeTripsCount() {
    const u = await this.currentUser();
    if (!u) return 0;
    // Als Fahrer: eigene angenommene, offene Angebote
    const { data: asDriver } = await sb.from('offers')
      .select('id').eq('driver_id', u.id).eq('status', 'accepted').is('completed_at', null);
    // Als Reiter: angenommene, offene Angebote auf eigene Anfragen
    const { data: myReqs } = await sb.from('requests').select('id').eq('rider_id', u.id);
    let asRider = [];
    if (myReqs && myReqs.length) {
      const ids = myReqs.map((r) => r.id);
      const { data } = await sb.from('offers')
        .select('id').in('request_id', ids).eq('status', 'accepted').is('completed_at', null);
      asRider = data || [];
    }
    return (asDriver?.length || 0) + (asRider?.length || 0);
  },

  /**
   * Loescht das eigene Konto endgueltig (per RPC in der Datenbank).
   * Die Datenbank prueft zusaetzlich, dass keine laufende Fahrt besteht.
   * Danach wird die Sitzung beendet.
   */
  async deleteAccount() {
    const { error } = await sb.rpc('delete_my_account');
    if (error) throw new Error(error.message);
    await sb.auth.signOut();
  },

  /* ==== PROFIL ==== */
  async getMyProfile() {
    const u = await this.currentUser();
    if (!u) return null;
    // maybeSingle: liefert null statt Fehler, wenn (noch) keine Zeile da ist
    const { data, error } = await sb.from('profiles').select('*').eq('id', u.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data;
    // Kein Profil vorhanden (z. B. Trigger hat nicht gegriffen) -> selbst anlegen
    const meta = u.user_metadata || {};
    const { data: created, error: insErr } = await sb.from('profiles').insert({
      id: u.id,
      full_name: meta.full_name || '',
      phone: meta.phone || '',
    }).select().single();
    if (insErr) throw new Error(insErr.message);
    return created;
  },
  async getRider(id) {
    const { data, error } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return rowToRider(data);
  },
  async getDriver(id) {
    const { data, error } = await sb.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return rowToDriver(data);
  },
  async updateRider(id, patch) {
    const row = {};
    if (patch.name != null) row.full_name = patch.name;
    if (patch.phone != null) row.phone = patch.phone;
    if (patch.location) { row.location_label = patch.location.label; row.location_lat = patch.location.lat; row.location_lng = patch.location.lng; }
    if (patch.horse) {
      const h = patch.horse;
      Object.assign(row, {
        horse_name: h.name, horse_breed: h.breed, horse_height: h.height, horse_weight: h.weight,
        horse_temperament: h.temperament, horse_loading_ok: h.loadingOk, horse_notes: h.notes,
      });
    }
    row.is_rider = true;
    const { data, error } = await sb.from('profiles').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return rowToRider(data);
  },
  async updateDriver(id, patch) {
    const row = {};
    if (patch.name != null) row.full_name = patch.name;
    if (patch.phone != null) row.phone = patch.phone;
    if (patch.location) { row.location_label = patch.location.label; row.location_lat = patch.location.lat; row.location_lng = patch.location.lng; }
    if (patch.vehicle) {
      const v = patch.vehicle;
      Object.assign(row, { vehicle_make: v.make, vehicle_model: v.model, vehicle_trailer: v.trailer, vehicle_capacity: v.capacity, vehicle_plate: v.plate });
    }
    if (patch.pricePerKm != null) row.price_per_km = patch.pricePerKm;
    if (patch.basePrice != null) row.base_price = patch.basePrice;
    if (patch.maxRadiusKm != null) row.max_radius_km = Math.min(Math.max(patch.maxRadiusKm, 1), 65);
    if (patch.availability) {
      const a = patch.availability;
      Object.assign(row, { av_mon: a.mon, av_tue: a.tue, av_wed: a.wed, av_thu: a.thu, av_fri: a.fri, av_sat: a.sat, av_sun: a.sun, av_from: a.from, av_to: a.to });
    }
    if (patch.payment) { row.pay_cash = patch.payment.cash; row.pay_card = patch.payment.card; row.pay_invoice = patch.payment.invoice; }
    if (patch.cancellationPolicy) {
      row.cancel_more48 = patch.cancellationPolicy.more48;
      row.cancel_24_48 = patch.cancellationPolicy.h24_48;
      row.cancel_6_24 = patch.cancellationPolicy.h6_24;
      row.cancel_under6 = patch.cancellationPolicy.under6;
      row.cancel_custom_text = patch.cancellationPolicy.customText || '';
    }
    if (patch.providerType) row.provider_type = patch.providerType;
    if (patch.company) { row.company_name = patch.company.name; row.company_address = patch.company.address; row.company_register = patch.company.register; }
    if (patch.declarations) {
      const decl = patch.declarations;
      row.decl_license = !!decl.license;
      row.decl_vehicle = !!decl.vehicle;
      row.decl_eu_1_2005 = !!decl.eu1_2005;
      row.decl_trailer_insurance = !!decl.trailerInsurance;
      row.declarations_at = new Date().toISOString();
    }
    row.is_driver = true;
    const { data, error } = await sb.from('profiles').update(row).eq('id', id).select().single();
    if (error) throw new Error(error.message);
    return rowToDriver(data);
  },

  /* ==== ANFRAGEN ==== */
  async createRequest({ riderId, pickup, dropoff, when, urgent, horseCount, loadingHelp, route }) {
    const routeKm = route && route.km ? route.km : Math.round(Geo.routeKm(pickup, dropoff) * 10) / 10;
    const row = {
      rider_id: riderId,
      pickup_label: pickup.label, pickup_lat: pickup.lat, pickup_lng: pickup.lng,
      dropoff_label: dropoff.label, dropoff_lat: dropoff.lat, dropoff_lng: dropoff.lng,
      when_ts: new Date(when).toISOString(),
      urgent: !!urgent, horse_count: Math.max(1, horseCount || 1), loading_help: !!loadingHelp,
      route_km: routeKm, route_minutes: route?.minutes || null,
      route_line: route?.line || [[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]],
      status: 'open',
    };
    const { data, error } = await sb.from('requests').insert(row).select().single();
    if (error) throw new Error(error.message);
    return rowToRequest(data);
  },

  /**
   * Bestehende Anfrage bearbeiten — nur erlaubt, solange sie offen ist
   * und noch KEIN Angebot vorliegt. Sobald ein Transporteur ein Angebot
   * abgegeben hat, ist die Anfrage gesperrt (sonst wuerden Angebote auf
   * veraltete Eckdaten verweisen).
   */
  async updateRequest(requestId, { pickup, dropoff, when, urgent, horseCount, loadingHelp, route }) {
    const existing = await this.getRequest(requestId);
    if (!existing) throw new Error('Anfrage nicht gefunden');
    if (existing.status !== 'open') throw new Error('Diese Anfrage kann nicht mehr bearbeitet werden.');
    const offers = await this.listOffersForRequest(requestId);
    if (offers.length > 0) throw new Error('Es liegt bereits ein Angebot vor — die Anfrage kann nicht mehr bearbeitet werden.');
    const routeKm = route && route.km ? route.km : Math.round(Geo.routeKm(pickup, dropoff) * 10) / 10;
    const row = {
      pickup_label: pickup.label, pickup_lat: pickup.lat, pickup_lng: pickup.lng,
      dropoff_label: dropoff.label, dropoff_lat: dropoff.lat, dropoff_lng: dropoff.lng,
      when_ts: new Date(when).toISOString(),
      urgent: !!urgent, horse_count: Math.max(1, horseCount || 1), loading_help: !!loadingHelp,
      route_km: routeKm, route_minutes: route?.minutes || null,
      route_line: route?.line || [[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]],
    };
    const { data, error } = await sb.from('requests').update(row).eq('id', requestId).select().single();
    if (error) throw new Error(error.message);
    return rowToRequest(data);
  },

  /**
   * Anfrage loeschen — nur erlaubt, solange sie offen ist und noch kein
   * Angebot vorliegt.
   */
  async deleteRequest(requestId) {
    const existing = await this.getRequest(requestId);
    if (!existing) throw new Error('Anfrage nicht gefunden');
    if (existing.status !== 'open') throw new Error('Diese Anfrage kann nicht mehr gelöscht werden.');
    const offers = await this.listOffersForRequest(requestId);
    if (offers.length > 0) throw new Error('Es liegt bereits ein Angebot vor — die Anfrage kann nicht mehr gelöscht werden.');
    const { error } = await sb.from('requests').delete().eq('id', requestId);
    if (error) throw new Error(error.message);
  },

  /* ==== LEERFAHRTEN (empty runs) ==== */

  /** Transporteur stellt eine Leerfahrt ein. KEINE km-Begrenzung. */
  async createEmptyRun({ driverId, from, to, when, seats, price, priceNote, note, route }) {
    const routeKm = route && route.km != null ? route.km : Math.round(Geo.routeKm(from, to) * 10) / 10;
    const row = {
      driver_id: driverId,
      from_label: from.label, from_lat: from.lat, from_lng: from.lng,
      to_label: to.label, to_lat: to.lat, to_lng: to.lng,
      when_ts: new Date(when).toISOString(),
      seats: Math.max(1, seats || 1),
      price: (price === '' || price == null) ? null : Number(price),
      price_note: priceNote || null,
      note: note || null,
      route_km: routeKm, route_minutes: route?.minutes || null,
      route_line: route?.line || [[from.lat, from.lng], [to.lat, to.lng]],
      status: 'open',
    };
    const { data, error } = await sb.from('empty_runs').insert(row).select().single();
    if (error) throw new Error(error.message);
    return rowToEmptyRun(data);
  },

  /** Offene, zukuenftige Leerfahrten (fuer Reiter zum Stoebern). */
  async listOpenEmptyRuns() {
    const { data, error } = await sb.from('empty_runs').select('*')
      .eq('status', 'open').order('when_ts', { ascending: true });
    if (error) throw new Error(error.message);
    const runs = (data || []).map(rowToEmptyRun);
    for (const r of runs) {
      r.driver = await this.getDriver(r.driverId);
      r.reliability = await this.getReliability(r.driverId, 'driver');
      r.adjustedRating = this.computeAdjustedRating(r.driver?.rating, r.reliability);
    }
    return runs;
  },

  /** Leerfahrten eines Transporteurs (fuer seinen eigenen Tab). */
  async listEmptyRunsForDriver(driverId) {
    const { data, error } = await sb.from('empty_runs').select('*')
      .eq('driver_id', driverId).order('when_ts', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map(rowToEmptyRun);
  },

  async getEmptyRun(id) {
    const { data, error } = await sb.from('empty_runs').select('*').eq('id', id).single();
    if (error) return null;
    return rowToEmptyRun(data);
  },

  /** Leerfahrt loeschen — nur solange offen und ohne angenommene Bewerbung. */
  async deleteEmptyRun(runId) {
    const run = await this.getEmptyRun(runId);
    if (!run) throw new Error('Leerfahrt nicht gefunden');
    if (run.status !== 'open') throw new Error('Diese Leerfahrt kann nicht mehr gelöscht werden.');
    const { error } = await sb.from('empty_runs').delete().eq('id', runId);
    if (error) throw new Error(error.message);
  },

  /** Reiter bewirbt sich auf eine Leerfahrt (mit eigener Teilstrecke). */
  async applyToEmptyRun({ emptyRunId, riderId, pickup, dropoff, horseCount, loadingHelp, message }) {
    const run = await this.getEmptyRun(emptyRunId);
    if (!run) throw new Error('Leerfahrt nicht gefunden');
    if (run.status !== 'open') throw new Error('Diese Leerfahrt nimmt keine Bewerbungen mehr an.');
    const row = {
      empty_run_id: emptyRunId, rider_id: riderId,
      pickup_label: pickup.label, pickup_lat: pickup.lat, pickup_lng: pickup.lng,
      dropoff_label: dropoff.label, dropoff_lat: dropoff.lat, dropoff_lng: dropoff.lng,
      horse_count: Math.max(1, horseCount || 1), loading_help: !!loadingHelp,
      message: message || null, status: 'pending',
    };
    const { data, error } = await sb.from('empty_run_applications').insert(row).select().single();
    if (error) {
      if (String(error.message).includes('duplicate') || error.code === '23505') {
        throw new Error('Du hast dich auf diese Leerfahrt bereits beworben.');
      }
      throw new Error(error.message);
    }
    return rowToApplication(data);
  },

  /** Bewerbungen zu einer Leerfahrt (fuer den Fahrer). */
  async listApplicationsForRun(emptyRunId) {
    const { data, error } = await sb.from('empty_run_applications').select('*')
      .eq('empty_run_id', emptyRunId).order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    const apps = (data || []).map(rowToApplication);
    for (const a of apps) {
      a.rider = await this.getRider(a.riderId);
      a.reliability = await this.getReliability(a.riderId, 'rider');
      a.adjustedRating = this.computeAdjustedRating(a.rider?.rating, a.reliability);
    }
    return apps;
  },

  /** Eigene Bewerbungen eines Reiters (fuer seinen Tab). */
  async listApplicationsForRider(riderId) {
    const { data, error } = await sb.from('empty_run_applications').select('*')
      .eq('rider_id', riderId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const apps = (data || []).map(rowToApplication);
    for (const a of apps) {
      a.emptyRun = await this.getEmptyRun(a.emptyRunId);
      if (a.emptyRun) a.driver = await this.getDriver(a.emptyRun.driverId);
    }
    return apps;
  },

  async getApplication(id) {
    const { data, error } = await sb.from('empty_run_applications').select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    return rowToApplication(data);
  },

  /** Reiter zieht seine (noch offene) Bewerbung zurueck. */
  async withdrawApplication(applicationId) {
    const app = await this.getApplication(applicationId);
    if (!app) throw new Error('Bewerbung nicht gefunden');
    if (app.status !== 'pending') throw new Error('Diese Bewerbung kann nicht mehr zurückgezogen werden.');
    const { error } = await sb.from('empty_run_applications').delete().eq('id', applicationId);
    if (error) throw new Error(error.message);
  },

  /** Transporteur nimmt eine Bewerbung an (analog acceptOffer). */
  /**
   * Transporteur nimmt eine Bewerbung an. Mehrfach-Modell: es koennen
   * MEHRERE Bewerbungen angenommen werden (grosser Haenger, mehrere
   * Pferde). Die Leerfahrt bleibt OFFEN fuer weitere Bewerbungen, bis der
   * Fahrer sie aktiv schliesst ("Restliche absagen" -> closeEmptyRun).
   * Es gibt bewusst KEIN hartes Platzlimit; seats dient nur als Hinweis.
   */
  async acceptApplication(applicationId) {
    const { data: appRow, error: e1 } = await sb.from('empty_run_applications').select('*').eq('id', applicationId).single();
    if (e1) throw new Error(e1.message);
    const app = rowToApplication(appRow);
    if (app.status !== 'pending') throw new Error('Diese Bewerbung ist nicht mehr offen.');
    const { error: e2 } = await sb.from('empty_run_applications')
      .update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', applicationId);
    if (e2) throw new Error(e2.message);
    // Leerfahrt bleibt offen — andere Bewerbungen NICHT automatisch ablehnen.
    return { app };
  },

  /**
   * "Restliche absagen": alle noch offenen (pending) Bewerbungen einer
   * Leerfahrt ablehnen und die Leerfahrt schliessen. Gibt es mindestens
   * eine angenommene Bewerbung, wird die Fahrt 'assigned', sonst
   * 'cancelled' (niemand ausgewaehlt).
   */
  async closeEmptyRun(emptyRunId) {
    await sb.from('empty_run_applications').update({ status: 'rejected' })
      .eq('empty_run_id', emptyRunId).eq('status', 'pending');
    const { data: acc } = await sb.from('empty_run_applications')
      .select('id').eq('empty_run_id', emptyRunId).eq('status', 'accepted');
    const hasAccepted = (acc || []).length > 0;
    await sb.from('empty_runs').update({ status: hasAccepted ? 'assigned' : 'cancelled' }).eq('id', emptyRunId);
  },

  async rejectApplication(applicationId) {
    const { error } = await sb.from('empty_run_applications').update({ status: 'rejected' }).eq('id', applicationId);
    if (error) throw new Error(error.message);
  },

  /* ---- Lebenszyklus einer angenommenen Bewerbung (Absage/Abschluss) ---- */
  // Spiegelt die offer-Funktionen, arbeitet aber auf empty_run_applications
  // + empty_runs. cancelInfo() wird wiederverwendet (gleiche Feldnamen).

  async _finalizeAppCancellation(app, { cancelledBy, category, reason, mutual, confirmComment }) {
    const patch = {
      status: 'rejected', cancelled_by: cancelledBy, cancelled_at: new Date().toISOString(),
      cancellation_category: category, cancellation_reason: String(reason || '').trim(), cancellation_mutual: !!mutual,
    };
    if (confirmComment != null) patch.cancel_confirm_comment = String(confirmComment).trim();
    await sb.from('empty_run_applications').update(patch).eq('id', app.id);
    // Mehrfach-Modell: Die Leerfahrt-Status wird hier NICHT angefasst.
    // Andere angenommene Fahrten derselben Leerfahrt laufen unabhaengig
    // weiter. Ob die Leerfahrt noch offen ist, steuert allein der Fahrer
    // ueber "Restliche absagen" (closeEmptyRun).
  },

  async cancelApplicationTrip(applicationId, by) {
    const app = await this.getApplication(applicationId);
    if (app.status !== 'accepted') throw new Error('Keine aktive Fahrt');
    if (!this.cancelInfo(app).open) throw new Error('Nach den ersten 10 Minuten muss die Absage beantragt und von der anderen Seite bestätigt werden.');
    await this._finalizeAppCancellation(app, { cancelledBy: by, category: 'grace_period', reason: '', mutual: false });
  },

  async requestAppCancellation(applicationId, by, category, reason) {
    if (!category || !String(reason).trim()) throw new Error('Bitte Grund und Begründung angeben.');
    const app = await this.getApplication(applicationId);
    if (app.status !== 'accepted') throw new Error('Keine aktive Fahrt');
    if (this.cancelInfo(app).open) throw new Error('Innerhalb der ersten 10 Minuten kann direkt abgesagt werden.');
    if (app.cancelRequestedBy) throw new Error('Es liegt bereits ein Absage-Antrag vor.');
    const { error } = await sb.from('empty_run_applications').update({
      cancel_requested_by: by, cancel_requested_at: new Date().toISOString(),
      cancel_request_category: category, cancel_request_reason: String(reason).trim(),
    }).eq('id', applicationId);
    if (error) throw new Error(error.message);
  },

  async withdrawAppCancellation(applicationId, by) {
    const app = await this.getApplication(applicationId);
    if (app.cancelRequestedBy !== by) throw new Error('Nur die beantragende Seite kann den Antrag zurückziehen.');
    const { error } = await sb.from('empty_run_applications').update({
      cancel_requested_by: null, cancel_requested_at: null, cancel_request_category: null, cancel_request_reason: null,
    }).eq('id', applicationId);
    if (error) throw new Error(error.message);
  },

  async confirmAppCancellation(applicationId, by, comment = '') {
    const app = await this.getApplication(applicationId);
    if (app.status !== 'accepted') throw new Error('Keine aktive Fahrt');
    if (!app.cancelRequestedBy) throw new Error('Es liegt kein Absage-Antrag vor.');
    if (app.cancelRequestedBy === by) throw new Error('Die Absage muss von der anderen Seite bestätigt werden.');
    await this._finalizeAppCancellation(app, {
      cancelledBy: app.cancelRequestedBy, category: app.cancelRequestCategory,
      reason: app.cancelRequestReason, mutual: true, confirmComment: comment,
    });
  },

  async confirmAppCompletion(applicationId, by) {
    const app = await this.getApplication(applicationId);
    if (app.status !== 'accepted') throw new Error('Keine aktive Fahrt');
    if (this.cancelInfo(app).open) throw new Error('Abschluss erst nach Ablauf des Stornofensters möglich.');
    if (app.cancelRequestedBy) throw new Error('Es liegt ein offener Absage-Antrag vor. Bitte zuerst klären.');
    const patch = {};
    if (by === 'rider') patch.rider_completed = true;
    if (by === 'driver') patch.driver_completed = true;
    const bothDone = (by === 'rider' ? true : app.riderCompleted) && (by === 'driver' ? true : app.driverCompleted);
    if (bothDone) patch.completed_at = new Date().toISOString();
    await sb.from('empty_run_applications').update(patch).eq('id', applicationId);
    // Leerfahrt nur dann auf 'done', wenn ALLE angenommenen Fahrten dieser
    // Leerfahrt abgeschlossen sind und keine Bewerbung mehr offen ist.
    if (bothDone) {
      const { data: rest } = await sb.from('empty_run_applications')
        .select('id,status,completed_at').eq('empty_run_id', app.emptyRunId);
      const anyOpen = (rest || []).some((a) =>
        a.status === 'pending' || (a.status === 'accepted' && !a.completed_at && a.id !== applicationId));
      if (!anyOpen) await sb.from('empty_runs').update({ status: 'done' }).eq('id', app.emptyRunId);
    }
  },

  async rateAppTrip(applicationId, by, stars, comment) {
    const patch = {};
    if (by === 'rider') { patch.rating_by_rider_stars = stars; patch.rating_by_rider_comment = comment || null; patch.rating_by_rider_at = new Date().toISOString(); }
    else { patch.rating_by_driver_stars = stars; patch.rating_by_driver_comment = comment || null; patch.rating_by_driver_at = new Date().toISOString(); }
    const { error } = await sb.from('empty_run_applications').update(patch).eq('id', applicationId);
    if (error) throw new Error(error.message);
  },

  async listRequestsForRider(riderId) {
    const { data, error } = await sb.from('requests').select('*').eq('rider_id', riderId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data.map(rowToRequest);
  },
  async getRequest(id) {
    const { data, error } = await sb.from('requests').select('*').eq('id', id).single();
    if (error) return null;
    return rowToRequest(data);
  },

  /**
   * Prüft, ob ein Fahrer aktuell keine Angebote abgeben darf.
   * Gibt null zurück, wenn aktiv, sonst einen Grund-Text.
   */
  driverBlockReason(driver) {
    if (!driver) return null;
    if (driver.isBlocked) return 'Dein Konto wurde dauerhaft gesperrt. Bitte kontaktiere den Betreiber.';
    if (driver.blockedUntil && new Date(driver.blockedUntil).getTime() > Date.now()) {
      const bis = new Date(driver.blockedUntil).toLocaleDateString('de-DE');
      return `Dein Konto ist vorübergehend gesperrt (bis ${bis}).`;
    }
    if (driver.offersDisabled) return 'Deine Angebote wurden vom Betreiber vorübergehend deaktiviert.';
    return null;
  },

  async listRequestsForDriver(driverId) {
    const driver = await this.getDriver(driverId);
    if (!driver || driver.location.lat == null) return [];
    if (this.driverBlockReason(driver)) return []; // gesperrter/inaktiver Fahrer sieht keine Anfragen
    const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const { data: reqs, error } = await sb.from('requests').select('*').eq('status', 'open');
    if (error) throw new Error(error.message);
    const { data: myOffers } = await sb.from('offers').select('request_id').eq('driver_id', driverId);
    const offeredIds = new Set((myOffers || []).map((o) => o.request_id));
    return reqs.map((r) => rowToRequest(r)).map((req) => {
      const distToPickup = Geo.haversineKm(driver.location, req.pickup);
      const day = new Date(req.when).getDay();
      const timeStr = new Date(req.when).toTimeString().slice(0, 5);
      return {
        req, distToPickup: Math.round(distToPickup * 10) / 10,
        inRadius: distToPickup <= driver.maxRadiusKm,
        dayOk: driver.availability[dayKeys[day]],
        timeOk: timeStr >= driver.availability.from && timeStr <= driver.availability.to,
        capacityOk: (req.horseCount || 1) <= driver.vehicle.capacity,
        alreadyOffered: offeredIds.has(req.id),
      };
    }).filter((x) => x.inRadius && x.dayOk && x.timeOk && x.capacityOk && !x.alreadyOffered);
  },

  /* ==== ANGEBOTE ==== */
  async createOffer({ requestId, driverId, flatPrice = null }) {
    const driver = await this.getDriver(driverId);
    const reason = this.driverBlockReason(driver);
    if (reason) throw new Error(reason);
    const req = await this.getRequest(requestId);
    if (!req) throw new Error('Anfrage nicht gefunden');
    const calcPrice = Math.round((driver.basePrice + req.routeKm * driver.pricePerKm) * 100) / 100;
    const useFlat = flatPrice != null && Number(flatPrice) > 0;
    const price = useFlat ? Math.round(Number(flatPrice) * 100) / 100 : calcPrice;
    const missing = [];
    if (!driver.vehicle.make || !driver.vehicle.model || !driver.vehicle.trailer || !driver.vehicle.plate || !(Number(driver.vehicle.capacity) > 0)) missing.push('Fahrzeug- und Anhängerdaten');
    if (!driver.declarations?.license) missing.push('Bestätigung der Fahrerlaubnis');
    if (!driver.declarations?.vehicle) missing.push('Bestätigung der Verkehrssicherheit');
    if (!driver.location?.lat) missing.push('Standort');
    if (missing.length) throw new Error(`Dein Transporteur-Profil ist noch nicht vollständig: ${missing.join(', ')}.`);
    const row = {
      request_id: requestId, driver_id: driverId, price,
      price_per_km: driver.pricePerKm, base_price: driver.basePrice, route_km: req.routeKm,
      price_mode: useFlat ? 'flat' : 'per_km', flat_price: useFlat ? price : null,
      cancellation_policy: driver.cancellationPolicy || null,
      status: 'pending', cancel_window_ms: 600000,
    };
    const { data, error } = await sb.from('offers').insert(row).select().single();
    if (error) {
      if (error.code === '23505') throw new Error('Du hast auf diese Anfrage bereits ein Angebot abgegeben.');
      throw new Error(error.message);
    }
    return rowToOffer(data);
  },

  async listOffersForRequest(requestId) {
    const { data, error } = await sb.from('offers').select('*').eq('request_id', requestId).order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    const offers = data.map(rowToOffer);
    // Fahrer-Objekt + kompakte Zuverlässigkeitszahl
    for (const o of offers) {
      o.driver = await this.getDriver(o.driverId);
      o.reliability = await this.getReliability(o.driverId, 'driver');
      o.adjustedRating = this.computeAdjustedRating(o.driver?.rating, o.reliability);
    }
    return offers;
  },
  async listOffersForDriver(driverId) {
    const { data, error } = await sb.from('offers').select('*').eq('driver_id', driverId).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const offers = data.map(rowToOffer);
    for (const o of offers) {
      o.request = await this.getRequest(o.requestId);
      if (o.request) {
        o.rider = await this.getRider(o.request.riderId);
        o.reliability = await this.getReliability(o.request.riderId, 'rider');
        o.adjustedRating = this.computeAdjustedRating(o.rider?.rating, o.reliability);
      }
    }
    return offers;
  },

  async acceptOffer(offerId) {
    const { data: offerRow, error: e1 } = await sb.from('offers').select('*').eq('id', offerId).single();
    if (e1) throw new Error(e1.message);
    const offer = rowToOffer(offerRow);
    // angenommenes Angebot markieren
    const { error: e2 } = await sb.from('offers').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', offerId);
    if (e2) throw new Error(e2.message);
    // Mitbewerber zurückstellen (on_hold)
    await sb.from('offers').update({ status: 'on_hold' })
      .eq('request_id', offer.requestId).neq('id', offerId).eq('status', 'pending');
    // Anfrage auf assigned
    await sb.from('requests').update({ status: 'assigned', accepted_offer_id: offerId }).eq('id', offer.requestId);
    return { offer };
  },
  async rejectOffer(offerId) {
    const { error } = await sb.from('offers').update({ status: 'rejected' }).eq('id', offerId);
    if (error) throw new Error(error.message);
  },

  async getOffer(offerId) {
    const { data, error } = await sb.from('offers').select('*').eq('id', offerId).single();
    if (error) throw new Error(error.message);
    return rowToOffer(data);
  },
  cancelInfo(offer) {
    if (!offer.acceptedAt) return { open: false, remainingMs: 0 };
    const remainingMs = Math.max(0, offer.cancelWindowMs - (Date.now() - offer.acceptedAt));
    return { open: remainingMs > 0, remainingMs };
  },
  /**
   * Innerhalb der ersten 10 Minuten (Kulanzfenster): Absage ist sofort
   * wirksam, keine Zustimmung der Gegenseite noetig.
   * Nach den 10 Minuten leitet diese Funktion NICHT mehr sofort ab,
   * sondern verweist auf requestCancellation() (zweistufig).
   */
  async cancelTrip(offerId, by, category = null, reason = '', mutual = false) {
    const { data: offerRow, error } = await sb.from('offers').select('*').eq('id', offerId).single();
    if (error) throw new Error(error.message);
    const offer = rowToOffer(offerRow);
    if (offer.status !== 'accepted') throw new Error('Keine aktive Fahrt');
    const info = this.cancelInfo(offer);
    if (!info.open) {
      // Nach dem Kulanzfenster ist die Absage zweistufig.
      throw new Error('Nach den ersten 10 Minuten muss die Absage beantragt und von der anderen Seite bestätigt werden.');
    }
    // Kulanzfenster: sofortige Absage
    await this._finalizeCancellation(offer, {
      cancelledBy: by, category: 'grace_period', reason: '', mutual: false,
    });
  },

  /**
   * Interne Helferfunktion: fuehrt die eigentliche Absage aus
   * (Angebot ablehnen, Anfrage wieder oeffnen, zurueckgestellte
   * Mitbewerber reaktivieren). Wird vom Kulanzfenster UND von der
   * bestaetigten zweistufigen Absage genutzt.
   */
  async _finalizeCancellation(offer, { cancelledBy, category, reason, mutual, confirmComment }) {
    const patch = {
      status: 'rejected',
      cancelled_by: cancelledBy,
      cancelled_at: new Date().toISOString(),
      cancellation_category: category,
      cancellation_reason: String(reason || '').trim(),
      cancellation_mutual: !!mutual,
    };
    if (confirmComment != null) patch.cancel_confirm_comment = String(confirmComment).trim();
    await sb.from('offers').update(patch).eq('id', offer.id);
    await sb.from('requests').update({ status: 'open', accepted_offer_id: null }).eq('id', offer.requestId);
    await sb.from('offers').update({ status: 'pending' }).eq('request_id', offer.requestId).eq('status', 'on_hold');
  },

  /**
   * Schritt 1 der zweistufigen Absage: eine Seite BEANTRAGT die Absage.
   * Die Fahrt bleibt aktiv (status = 'accepted'), wird aber markiert.
   */
  async requestCancellation(offerId, by, category, reason) {
    if (!category || !String(reason).trim()) throw new Error('Bitte Grund und Begründung angeben.');
    const { data: offerRow, error } = await sb.from('offers').select('*').eq('id', offerId).single();
    if (error) throw new Error(error.message);
    const offer = rowToOffer(offerRow);
    if (offer.status !== 'accepted') throw new Error('Keine aktive Fahrt');
    if (this.cancelInfo(offer).open) throw new Error('Innerhalb der ersten 10 Minuten kann direkt abgesagt werden.');
    if (offer.cancelRequestedBy) throw new Error('Es liegt bereits ein Absage-Antrag vor.');
    const { error: e2 } = await sb.from('offers').update({
      cancel_requested_by: by,
      cancel_requested_at: new Date().toISOString(),
      cancel_request_category: category,
      cancel_request_reason: String(reason).trim(),
    }).eq('id', offerId);
    if (e2) throw new Error(e2.message);
  },

  /**
   * Der Antragsteller zieht seinen Absage-Antrag zurueck (solange die
   * Gegenseite noch nicht bestaetigt hat). Die Fahrt laeuft normal weiter.
   */
  async withdrawCancellation(offerId, by) {
    const { data: offerRow, error } = await sb.from('offers').select('*').eq('id', offerId).single();
    if (error) throw new Error(error.message);
    const offer = rowToOffer(offerRow);
    if (offer.cancelRequestedBy !== by) throw new Error('Nur die beantragende Seite kann den Antrag zurückziehen.');
    const { error: e2 } = await sb.from('offers').update({
      cancel_requested_by: null,
      cancel_requested_at: null,
      cancel_request_category: null,
      cancel_request_reason: null,
    }).eq('id', offerId);
    if (e2) throw new Error(e2.message);
  },

  /**
   * Schritt 2 der zweistufigen Absage: die GEGENSEITE bestaetigt die
   * beantragte Absage (optional mit Kommentar). Erst jetzt wird die
   * Fahrt endgueltig abgesagt und gilt als einvernehmlich.
   */
  async confirmCancellation(offerId, by, comment = '') {
    const { data: offerRow, error } = await sb.from('offers').select('*').eq('id', offerId).single();
    if (error) throw new Error(error.message);
    const offer = rowToOffer(offerRow);
    if (offer.status !== 'accepted') throw new Error('Keine aktive Fahrt');
    if (!offer.cancelRequestedBy) throw new Error('Es liegt kein Absage-Antrag vor.');
    if (offer.cancelRequestedBy === by) throw new Error('Die Absage muss von der anderen Seite bestätigt werden.');
    // Endgueltige Absage: Kategorie/Begruendung des Antragstellers uebernehmen,
    // als einvernehmlich markieren. cancelled_by bleibt der Antragsteller.
    await this._finalizeCancellation(offer, {
      cancelledBy: offer.cancelRequestedBy,
      category: offer.cancelRequestCategory,
      reason: offer.cancelRequestReason,
      mutual: true,
      confirmComment: comment,
    });
  },

  async confirmCompletion(offerId, by) {
    const { data: offerRow, error } = await sb.from('offers').select('*').eq('id', offerId).single();
    if (error) throw new Error(error.message);
    const offer = rowToOffer(offerRow);
    if (offer.status !== 'accepted') throw new Error('Keine aktive Fahrt');
    if (this.cancelInfo(offer).open) throw new Error('Abschluss erst nach Ablauf des Stornofensters möglich.');
    if (offer.cancelRequestedBy) throw new Error('Es liegt ein offener Absage-Antrag vor. Bitte zuerst klären.');
    // zurückgestellte Mitbewerber endgültig ablehnen
    await sb.from('offers').update({ status: 'rejected' }).eq('request_id', offer.requestId).eq('status', 'on_hold');
    const patch = {};
    if (by === 'rider') patch.rider_completed = true;
    if (by === 'driver') patch.driver_completed = true;
    const bothDone = (by === 'rider' ? true : offer.riderCompleted) && (by === 'driver' ? true : offer.driverCompleted);
    if (bothDone) patch.completed_at = new Date().toISOString();
    await sb.from('offers').update(patch).eq('id', offerId);
    if (bothDone) await sb.from('requests').update({ status: 'done' }).eq('id', offer.requestId);
  },

  async rateTrip(offerId, by, stars, comment) {
    const { data: offerRow, error } = await sb.from('offers').select('*').eq('id', offerId).single();
    if (error) throw new Error(error.message);
    const offer = rowToOffer(offerRow);
    if (!offer.completedAt) throw new Error('Bewertung erst nach Abschluss möglich');
    const s = Math.max(1, Math.min(5, stars));
    if (by === 'rider') {
      if (offer.ratingByRider) throw new Error('Bereits bewertet');
      await sb.from('offers').update({ rating_by_rider_stars: s, rating_by_rider_comment: comment || '', rating_by_rider_at: new Date().toISOString() }).eq('id', offerId);
      await this._recalcRating(offer.driverId, 'driver', s);
    } else {
      if (offer.ratingByDriver) throw new Error('Bereits bewertet');
      await sb.from('offers').update({ rating_by_driver_stars: s, rating_by_driver_comment: comment || '', rating_by_driver_at: new Date().toISOString() }).eq('id', offerId);
      const req = await this.getRequest(offer.requestId);
      if (req) await this._recalcRating(req.riderId, 'rider', s);
    }
  },
  async getReliability(profileId, role = 'driver') {
    let rows = [];
    if (role === 'driver') {
      const { data, error } = await sb.from('offers').select('accepted_at,completed_at,cancelled_at,cancellation_category,cancellation_mutual').eq('driver_id', profileId).not('accepted_at', 'is', null);
      if (error) throw new Error(error.message);
      rows = data || [];
    } else {
      const { data: reqs, error: re } = await sb.from('requests').select('id').eq('rider_id', profileId);
      if (re) throw new Error(re.message);
      const ids = (reqs || []).map(r => r.id);
      if (ids.length) {
        const { data, error } = await sb.from('offers').select('accepted_at,completed_at,cancelled_at,cancellation_category,cancellation_mutual').in('request_id', ids).not('accepted_at', 'is', null);
        if (error) throw new Error(error.message);
        rows = data || [];
      }
    }
    const out = { agreed: rows.length, completed: 0, early: 0, cancelled: 0, short: 0, veryShort: 0, mutual: 0, noShow: 0 };
    for (const r of rows) {
      if (r.completed_at) { out.completed++; continue; }
      if (r.cancellation_category === 'grace_period') continue;
      if (r.cancellation_mutual || r.cancellation_category === 'mutual') { out.mutual++; continue; }
      if (r.cancellation_category === 'not_arrived') { out.noShow++; continue; }
      if (!r.cancelled_at) continue;
      const hours = (new Date(r.cancelled_at).getTime() - new Date(r.accepted_at).getTime()) / 3600000;
      if (hours > 48) out.early++;
      else if (hours > 24) out.cancelled++;
      else if (hours > 6) out.short++;
      else out.veryShort++;
    }
    return out;
  },

  /**
   * Faire Zuverlässigkeits-Anpassung der Sterne-Bewertung.
   * Absagen im 10-Minuten-Fenster oder einvernehmliche/nicht-erschienen-Fälle
   * werden bereits in getReliability() gesondert behandelt bzw. ausgeschlossen.
   * Je kurzfristiger eine Absage, desto stärker fließt sie ein — eine einzelne
   * frühzeitige Absage wirkt sich kaum aus, wiederholtes kurzfristiges Absagen
   * senkt die Bewertung spürbar. Der Abzug ist auf maximal 1,0 Stern gedeckelt,
   * und ein Fahrer ohne Historie startet neutral (kein Abzug).
   */
  computeAdjustedRating(baseRating, rel) {
    const base = Number(baseRating) || 0;
    if (!rel) return base;
    const denom = (rel.completed || 0) + (rel.early || 0) + (rel.cancelled || 0) + (rel.short || 0) + (rel.veryShort || 0) + (rel.noShow || 0);
    if (!denom) return base; // keine Historie -> neutral, kein Abzug
    const weighted =
      (rel.early || 0) * 0.3 +      // > 48h vorher: kaum relevant
      (rel.cancelled || 0) * 0.6 +  // 24-48h vorher
      (rel.short || 0) * 1.2 +      // 6-24h vorher
      (rel.veryShort || 0) * 2.0 +  // < 6h vorher
      (rel.noShow || 0) * 2.5;      // nicht erschienen
    const penalty = Math.min(1.0, (weighted / denom) * 0.9);
    return Math.round(Math.max(1, base - penalty) * 10) / 10;
  },
  async getAdjustedRating(profileId, role = 'driver') {
    const p = role === 'driver' ? await this.getDriver(profileId) : await this.getRider(profileId);
    if (!p) return 0;
    const rel = await this.getReliability(profileId, role);
    return this.computeAdjustedRating(p.rating, rel);
  },

  async _recalcRating(profileId, role, newStars) {
    const { data: p } = await sb.from('profiles').select('*').eq('id', profileId).single();
    if (!p) return;
    const rCol = role === 'driver' ? 'driver_rating' : 'rider_rating';
    const tCol = role === 'driver' ? 'driver_trips' : 'rider_trips';
    const prevRating = Number(p[rCol]) || 0;
    const prevTrips = p[tCol] || 0;
    const newTrips = prevTrips + 1;
    const newRating = Math.round(((prevRating * prevTrips + newStars) / newTrips) * 10) / 10;
    await sb.from('profiles').update({ [rCol]: newRating, [tCol]: newTrips }).eq('id', profileId);
  },

  async listRatingsForDriver(driverId) {
    const { data, error } = await sb.from('offers').select('*').eq('driver_id', driverId).not('rating_by_rider_stars', 'is', null);
    if (error) throw new Error(error.message);
    const out = [];
    for (const o of data) {
      const req = await this.getRequest(o.request_id);
      const rider = req ? await this.getRider(req.riderId) : null;
      out.push({ stars: o.rating_by_rider_stars, comment: o.rating_by_rider_comment || '', at: new Date(o.rating_by_rider_at).getTime(), from: rider ? rider.name : 'Reiter' });
    }
    return out.sort((a, b) => b.at - a.at);
  },
  async listRatingsForRider(riderId) {
    const { data, error } = await sb.from('offers').select('*').not('rating_by_driver_stars', 'is', null);
    if (error) throw new Error(error.message);
    const out = [];
    for (const o of data) {
      const req = await this.getRequest(o.request_id);
      if (!req || req.riderId !== riderId) continue;
      const driver = await this.getDriver(o.driver_id);
      out.push({ stars: o.rating_by_driver_stars, comment: o.rating_by_driver_comment || '', at: new Date(o.rating_by_driver_at).getTime(), from: driver ? driver.name : 'Fahrer' });
    }
    return out.sort((a, b) => b.at - a.at);
  },

  /* ==== DOKUMENTE (Storage) ==== */
  async uploadDocument(driverId, kind, file) {
    // file ist ein echtes File-Objekt aus dem <input type=file>
    const ext = file.name.split('.').pop();
    const path = `${driverId}/${kind}_${Date.now()}.${ext}`;
    const { error: upErr } = await sb.storage.from('documents').upload(path, file, { upsert: true });
    if (upErr) throw new Error('Upload fehlgeschlagen: ' + upErr.message);
    const col = kind === 'license'
      ? { doc_license_path: path, doc_license_name: file.name }
      : { doc_permit_path: path, doc_permit_name: file.name };
    const { error } = await sb.from('profiles').update(col).eq('id', driverId);
    if (error) throw new Error(error.message);
    return { fileName: file.name, path };
  },
  /** Zeitlich begrenzten (signierten) Link zum Ansehen eines Dokuments. */
  async getDocumentUrl(path) {
    const { data, error } = await sb.storage.from('documents').createSignedUrl(path, 300); // 5 Min gültig
    if (error) throw new Error(error.message);
    return data.signedUrl;
  },

  /* ==== SELBSTBESTÄTIGUNG ==== */
  async saveSelfDeclaration(id) {
    const { error } = await sb.from('profiles').update({ self_declaration_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
  },

  /* ==== MELDUNGEN ==== */
  async createReport({ reportedId, category, message }) {
    const u = await this.currentUser();
    if (!u) throw new Error('Nicht angemeldet');
    const { error } = await sb.from('reports').insert({
      reporter_id: u.id, reported_id: reportedId,
      category: category || null, message,
    });
    if (error) throw new Error(error.message);
  },

  /* ==== ADMIN ==== */
  async amIAdmin() {
    const p = await this.getMyProfile();
    return !!(p && p.is_admin);
  },
  async listReports() {
    // Nur Admins bekommen dank RLS Daten zurueck.
    const { data, error } = await sb.from('reports').select('*').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    // Anzahl Meldungen je gemeldetem Nutzer vorberechnen
    const countByReported = {};
    for (const r of data) countByReported[r.reported_id] = (countByReported[r.reported_id] || 0) + 1;
    const out = [];
    for (const r of data) {
      const reported = await this.getDriver(r.reported_id);
      out.push({
        id: r.id, ticketNo: r.ticket_no || null,
        category: r.category, message: r.message, status: r.status || 'open',
        at: new Date(r.created_at).getTime(),
        reportedId: r.reported_id,
        reportedName: reported ? reported.name : '—',
        reportedStatus: reported ? {
          blocked: reported.isBlocked,
          blockedUntil: reported.blockedUntil,
          offersDisabled: reported.offersDisabled,
          warnings: reported.warnings,
        } : null,
        // Melder wird anonymisiert dargestellt (Datensparsamkeit)
        reporterRef: 'Nutzer #' + String(r.reporter_id).slice(0, 6),
        priorReports: countByReported[r.reported_id] || 1,
      });
    }
    return out;
  },
  async setReportStatus(reportId, status) {
    const { error } = await sb.from('reports').update({ status }).eq('id', reportId);
    if (error) throw new Error(error.message);
  },
  /** Zahl offener Meldungen (fuer das Admin-Badge). 0, wenn kein Admin. */
  async countOpenReports() {
    const { data, error } = await sb.from('reports').select('id').eq('status', 'open');
    if (error) return 0;
    return (data || []).length;
  },
  // Admin-Maßnahmen gegen einen Nutzer
  async warnUser(userId) {
    const { data: p } = await sb.from('profiles').select('warnings').eq('id', userId).maybeSingle();
    const next = ((p && p.warnings) || 0) + 1;
    const { error } = await sb.from('profiles').update({ warnings: next }).eq('id', userId);
    if (error) throw new Error(error.message);
    return next;
  },
  async setUserBlocked(userId, blocked) {
    // dauerhafte Sperre (hebt temporaere Sperre mit auf)
    const { error } = await sb.from('profiles').update({ is_blocked: blocked, blocked_until: null }).eq('id', userId);
    if (error) throw new Error(error.message);
  },
  async setUserBlockedUntil(userId, until) {
    // voruebergehende Sperre bis Datum (ISO-String) oder null zum Aufheben
    const { error } = await sb.from('profiles').update({ blocked_until: until }).eq('id', userId);
    if (error) throw new Error(error.message);
  },
  async setOffersDisabled(userId, disabled) {
    const { error } = await sb.from('profiles').update({ offers_disabled: disabled }).eq('id', userId);
    if (error) throw new Error(error.message);
  },

  /* ==== IN-APP-CHAT (messages) ==== */

  /** Nachrichten einer Fahrt laden (aufsteigend nach Zeit). */
  async listMessages(contextType, contextId) {
    const { data, error } = await sb.from('messages').select('*')
      .eq('context_type', contextType).eq('context_id', contextId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map((m) => ({
      id: m.id, senderId: m.sender_id, body: m.body,
      readAt: m.read_at ? new Date(m.read_at).getTime() : null,
      at: new Date(m.created_at).getTime(),
    }));
  },

  /** Nachricht senden. */
  async sendMessage(contextType, contextId, body) {
    const u = await this.currentUser();
    if (!u) throw new Error('Nicht angemeldet');
    const text = String(body || '').trim();
    if (!text) throw new Error('Leere Nachricht');
    const { data, error } = await sb.from('messages')
      .insert({ context_type: contextType, context_id: contextId, sender_id: u.id, body: text })
      .select().single();
    if (error) throw new Error(error.message);
    return { id: data.id, senderId: data.sender_id, body: data.body, at: new Date(data.created_at).getTime(), readAt: null };
  },

  /** Eingehende, ungelesene Nachrichten einer Fahrt als gelesen markieren. */
  async markMessagesRead(contextType, contextId) {
    const u = await this.currentUser();
    if (!u) return;
    await sb.from('messages').update({ read_at: new Date().toISOString() })
      .eq('context_type', contextType).eq('context_id', contextId)
      .neq('sender_id', u.id).is('read_at', null);
  },

  /** Anzahl ungelesener eingehender Nachrichten einer Fahrt (fuer Badge). */
  async countUnreadMessages(contextType, contextId) {
    const u = await this.currentUser();
    if (!u) return 0;
    const { data, error } = await sb.from('messages').select('id')
      .eq('context_type', contextType).eq('context_id', contextId)
      .neq('sender_id', u.id).is('read_at', null);
    if (error) return 0;
    return (data || []).length;
  },
};

/* Fehlermeldungen von Supabase-Auth ins Deutsche übersetzen */
function _authMsg(msg) {
  if (/already registered/i.test(msg)) return 'Diese E-Mail ist bereits registriert.';
  if (/Invalid login/i.test(msg)) return 'E-Mail oder Passwort ist falsch.';
  if (/Password should be at least/i.test(msg)) return 'Das Passwort muss mindestens 6 Zeichen haben.';
  if (/Email not confirmed/i.test(msg)) return 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in deinem Postfach).';
  return msg;
}

window.API = API;
window.supabaseClient = sb;
