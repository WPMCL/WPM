-- =====================================================================
-- Migration: Konto-Loeschung durch den Nutzer selbst.
-- Fuer eine bereits bestehende Supabase-Instanz ausfuehren.
-- Kann gefahrlos mehrfach laufen (create or replace).
-- =====================================================================
--
-- Warum eine Datenbank-Funktion (RPC)?
--   Das Loeschen eines Auth-Kontos (auth.users) ist eine Admin-Aktion
--   und darf NICHT mit dem oeffentlichen anon-Key aus dem Browser
--   ausgefuehrt werden. Diese Funktion laeuft mit erhoehten Rechten
--   (security definer), prueft aber streng, dass der Aufrufer nur sein
--   EIGENES Konto loescht -- und nur, wenn keine laufende Fahrt besteht.
--
--   Dank "on delete cascade" (profiles.id -> auth.users.id, und alle
--   requests/offers -> profiles) werden mit dem Auth-User automatisch
--   Profil, Anfragen und Angebote mitgeloescht.
-- ---------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  active_count integer;
begin
  if uid is null then
    raise exception 'Nicht angemeldet';
  end if;

  -- Laufende Fahrten des Nutzers zaehlen:
  -- ein angenommenes Angebot (status = 'accepted'), das noch nicht
  -- abgeschlossen ist (completed_at is null) -- egal ob als Fahrer
  -- (offers.driver_id) oder als Reiter (ueber die eigene Anfrage).
  select count(*) into active_count
  from public.offers o
  join public.requests r on r.id = o.request_id
  where o.status = 'accepted'
    and o.completed_at is null
    and (o.driver_id = uid or r.rider_id = uid);

  if active_count > 0 then
    raise exception 'Es bestehen noch % laufende Fahrt(en). Bitte zuerst beenden oder absagen.', active_count;
  end if;

  -- Auth-User loeschen -> alles Weitere cascadet automatisch.
  delete from auth.users where id = uid;
end;
$$;

-- Nur eingeloggte Nutzer duerfen die Funktion aufrufen (sie wirkt
-- ausschliesslich auf das eigene Konto).
revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
