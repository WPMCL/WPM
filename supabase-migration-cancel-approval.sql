-- =====================================================================
-- Migration: Zweistufige Absage (Absage beantragen -> Gegenseite
-- bestaetigt). Fuer eine bereits bestehende Supabase-Instanz ausfuehren.
-- Kann gefahrlos mehrfach laufen ("if not exists").
-- =====================================================================
--
-- Ablauf:
--   * Innerhalb der ersten 10 Minuten nach Annahme: Absage wie bisher
--     sofort wirksam (Kulanzfenster, keine Zustimmung noetig).
--   * Nach den 10 Minuten: Eine Seite BEANTRAGT die Absage mit Grund und
--     Begruendung. Die Fahrt bleibt zunaechst aktiv (status = 'accepted'),
--     ist aber durch cancel_requested_by markiert. Die andere Seite sieht
--     den Grund und BESTAETIGT die Absage (optional mit Kommentar, z. B.
--     "bitte rufen Sie mich an"). Erst dann wird die Fahrt endgueltig
--     abgesagt. Der Antragsteller kann seinen Antrag zurueckziehen,
--     solange er noch nicht bestaetigt wurde.
-- ---------------------------------------------------------------------

alter table public.offers
  -- Wer hat die Absage beantragt? 'rider' | 'driver' | null (kein Antrag offen)
  add column if not exists cancel_requested_by text,
  -- Wann wurde beantragt?
  add column if not exists cancel_requested_at timestamptz,
  -- Grund/Kategorie des Antragstellers (gleiche Kategorien wie bisher)
  add column if not exists cancel_request_category text,
  -- Freitext-Begruendung des Antragstellers
  add column if not exists cancel_request_reason text,
  -- Optionaler Kommentar der bestaetigenden Seite (z. B. "bitte anrufen")
  add column if not exists cancel_confirm_comment text;

comment on column public.offers.cancel_requested_by  is 'Zweistufige Absage: wer beantragt hat (rider|driver). NULL = kein offener Antrag.';
comment on column public.offers.cancel_requested_at  is 'Zeitpunkt des Absage-Antrags';
comment on column public.offers.cancel_request_category is 'Kategorie des Absage-Antrags';
comment on column public.offers.cancel_request_reason is 'Begruendung des Antragstellers';
comment on column public.offers.cancel_confirm_comment is 'Optionaler Kommentar der bestaetigenden Seite';
