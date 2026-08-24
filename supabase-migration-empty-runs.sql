-- =====================================================================
-- Migration: Leerfahrten (empty_runs) + Bewerbungen darauf.
-- Fuer eine bereits bestehende Supabase-Instanz ausfuehren.
-- Kann gefahrlos mehrfach laufen ("if not exists" / "drop policy if exists").
-- =====================================================================
--
-- Idee (spiegelbildlich zu Anfrage/Angebot):
--   * Ein TRANSPORTEUR stellt eine LEERFAHRT ein (Route A->B, Zeit, freie
--     Plaetze, optional Preis/Notiz). Anders als beim Umkreis regulaerer
--     Anfragen gibt es hier BEWUSST KEINE 65-km-Grenze -- Leerfahrten
--     werden meist von beruflichen Fahrern ueber laengere Strecken
--     angeboten.
--   * REITER BEWERBEN sich auf eine Leerfahrt und geben dabei ihre
--     eigene Teilstrecke an (von wo bis wo ihr Pferd soll), Anzahl Pferde
--     und ob Verladehilfe benoetigt wird.
--   * Der TRANSPORTEUR WAEHLT eine Bewerbung aus (wie der Reiter heute ein
--     Angebot annimmt). Ab Annahme laeuft der bekannte Fahrt-Lebenszyklus
--     inkl. zweistufiger Absage und Abschlussbestaetigung.
-- ---------------------------------------------------------------------

-- ---- LEERFAHRTEN ----
create table if not exists public.empty_runs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,

  -- Strecke der Leerfahrt (A -> B), KEINE km-Begrenzung
  from_label text not null,
  from_lat double precision not null,
  from_lng double precision not null,
  to_label text not null,
  to_lat double precision not null,
  to_lng double precision not null,

  when_ts timestamptz not null,           -- geplante Abfahrt
  seats integer not null default 1,       -- freie Plaetze (Pferde)
  price numeric(8,2),                     -- optionaler Preis (darf NULL sein)
  price_note text,                        -- z. B. "pro Pferd" / "Gesamt / VB"
  note text,                              -- Freitext des Fahrers

  -- gecachte Route der Leerfahrt (Polyline), spart Routing-Aufrufe
  route_km numeric(7,1),
  route_minutes integer,
  route_line jsonb,

  -- open -> assigned -> done | cancelled
  status text not null default 'open',
  accepted_application_id uuid,

  created_at timestamptz not null default now()
);
create index if not exists empty_runs_status_idx on public.empty_runs(status);
create index if not exists empty_runs_driver_idx on public.empty_runs(driver_id);
create index if not exists empty_runs_when_idx on public.empty_runs(when_ts);

-- ---- BEWERBUNGEN auf Leerfahrten ----
create table if not exists public.empty_run_applications (
  id uuid primary key default gen_random_uuid(),
  empty_run_id uuid not null references public.empty_runs(id) on delete cascade,
  rider_id uuid not null references public.profiles(id) on delete cascade,

  -- Teilstrecke des Reiters (von wo bis wo sein Pferd transportiert werden soll)
  pickup_label text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dropoff_label text not null,
  dropoff_lat double precision not null,
  dropoff_lng double precision not null,

  horse_count integer not null default 1,
  loading_help boolean not null default false,
  message text,                           -- kurze Nachricht an den Fahrer

  -- pending -> accepted | rejected
  status text not null default 'pending',

  -- Fahrt-Lebenszyklus (analog zu offers)
  accepted_at timestamptz,
  cancel_window_ms integer not null default 600000,
  cancelled_by text,
  cancelled_at timestamptz,
  cancellation_category text,
  cancellation_reason text,
  cancellation_mutual boolean not null default false,

  -- Zweistufige Absage
  cancel_requested_by text,
  cancel_requested_at timestamptz,
  cancel_request_category text,
  cancel_request_reason text,
  cancel_confirm_comment text,

  rider_completed boolean not null default false,
  driver_completed boolean not null default false,
  completed_at timestamptz,

  rating_by_rider_stars integer,
  rating_by_rider_comment text,
  rating_by_rider_at timestamptz,
  rating_by_driver_stars integer,
  rating_by_driver_comment text,
  rating_by_driver_at timestamptz,

  created_at timestamptz not null default now(),

  -- Ein Reiter kann sich pro Leerfahrt nur EINMAL bewerben.
  unique (empty_run_id, rider_id)
);
create index if not exists era_run_idx on public.empty_run_applications(empty_run_id);
create index if not exists era_rider_idx on public.empty_run_applications(rider_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.empty_runs enable row level security;
alter table public.empty_run_applications enable row level security;

-- LEERFAHRTEN: fuer alle eingeloggten lesbar (Reiter sollen stoebern koennen)
drop policy if exists "Leerfahrten lesbar" on public.empty_runs;
create policy "Leerfahrten lesbar"
  on public.empty_runs for select
  to authenticated using (true);

-- Anlegen nur durch den Fahrer selbst
drop policy if exists "Fahrer erstellt Leerfahrt" on public.empty_runs;
create policy "Fahrer erstellt Leerfahrt"
  on public.empty_runs for insert
  to authenticated with check (auth.uid() = driver_id);

-- Aendern: der Fahrer (Eigentuemer) ODER ein Reiter mit Bewerbung
-- (noetig fuer Statuswechsel bei Annahme/Storno/Abschluss).
drop policy if exists "Leerfahrt aenderbar durch Beteiligte" on public.empty_runs;
create policy "Leerfahrt aenderbar durch Beteiligte"
  on public.empty_runs for update
  to authenticated using (
    auth.uid() = driver_id
    or exists (select 1 from public.empty_run_applications a where a.empty_run_id = empty_runs.id and a.rider_id = auth.uid())
  );

-- Loeschen nur durch den Fahrer (solange sinnvoll; App schuetzt zusaetzlich)
drop policy if exists "Leerfahrt loeschbar durch Fahrer" on public.empty_runs;
create policy "Leerfahrt loeschbar durch Fahrer"
  on public.empty_runs for delete
  to authenticated using (auth.uid() = driver_id);

-- BEWERBUNGEN: sichtbar fuer den Fahrer der Leerfahrt UND den bewerbenden Reiter
drop policy if exists "Bewerbungen lesbar fuer Beteiligte" on public.empty_run_applications;
create policy "Bewerbungen lesbar fuer Beteiligte"
  on public.empty_run_applications for select
  to authenticated using (
    auth.uid() = rider_id
    or exists (select 1 from public.empty_runs e where e.id = empty_run_applications.empty_run_id and e.driver_id = auth.uid())
  );

-- Bewerben nur als man selbst (Reiter)
drop policy if exists "Reiter bewirbt sich" on public.empty_run_applications;
create policy "Reiter bewirbt sich"
  on public.empty_run_applications for insert
  to authenticated with check (auth.uid() = rider_id);

-- Aendern: der bewerbende Reiter UND der Fahrer der Leerfahrt
-- (Annahme, Storno, Abschluss, Bewertung).
drop policy if exists "Bewerbung aenderbar durch Beteiligte" on public.empty_run_applications;
create policy "Bewerbung aenderbar durch Beteiligte"
  on public.empty_run_applications for update
  to authenticated using (
    auth.uid() = rider_id
    or exists (select 1 from public.empty_runs e where e.id = empty_run_applications.empty_run_id and e.driver_id = auth.uid())
  );

-- Bewerbung zuruecknehmen (loeschen) darf der Reiter selbst
drop policy if exists "Bewerbung zuruecknehmbar durch Reiter" on public.empty_run_applications;
create policy "Bewerbung zuruecknehmbar durch Reiter"
  on public.empty_run_applications for delete
  to authenticated using (auth.uid() = rider_id);
