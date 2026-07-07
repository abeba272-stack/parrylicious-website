# Parrylicious Studio Website

Produktionsstand der Website mit:
- statischem Frontend (GitHub Pages oder Vercel Static),
- Supabase Auth + Buchungsdaten,
- Stripe Checkout + Webhook,
- SMS/E-Mail-Benachrichtigungen via Twilio/Resend.

## Features
- Service-Katalog mit echten Style-Bildern
- Buchungs-Wizard mit Gastmodus oder Login
- Kundenprofil im Dashboard (Name, Telefon, Adresse, Profilbild)
- Slot-Schutz gegen Doppelbuchungen (`slot_is_available`)
- Rollenbasiertes Dashboard (`customer`, `staff`, `admin`)
- Zahlungsstatus pro Buchung (`unpaid`, `pending`, `paid`, `failed`, `refunded`)
- Admin-Aktionen mit Benachrichtigungsversand (Bestätigung/Storno)

## Supabase Setup
1. `supabase-config.js` ausfüllen:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
2. In Supabase SQL Editor `supabase-schema.sql` komplett ausführen.
3. Auth Redirects setzen (`Authentication -> URL Configuration`):
   - `Site URL`: deine Live-Domain
   - `Redirect URLs`: mindestens `<LIVE_URL>/login.html`
   - lokal optional: `http://localhost:3000/login.html`
4. OAuth Provider aktivieren (`Authentication -> Providers`):
   - Google
5. Rollen per E-Mail-Regel vergeben (automatisch bei Login/Registrierung):
   - im Dashboard als `admin` unter "Rollenverwaltung" E-Mail + Rolle setzen
   - oder SQL:
     - `insert into public.role_email_rules (email, role) values ('admin1@mail.de', 'admin') on conflict (email) do update set role = excluded.role;`
     - `insert into public.role_email_rules (email, role) values ('admin2@mail.de', 'admin') on conflict (email) do update set role = excluded.role;`
     - `insert into public.role_email_rules (email, role) values ('staff1@mail.de', 'staff') on conflict (email) do update set role = excluded.role;`
     - `insert into public.role_email_rules (email, role) values ('staff2@mail.de', 'staff') on conflict (email) do update set role = excluded.role;`

## Account-Typen
- `customer`: Eigene Buchungen/Warteliste, eigene Stornos, Anzahlung starten, eigenes Profil pflegen.
- `staff`: Alle Buchungen/Warteliste sehen, Buchungen bestätigen/stornieren.
- `admin`: Wie `staff` plus Rollenverwaltung im Dashboard.
- Ohne E-Mail-Regel ist der Default immer `customer`.

## Backend Environment Variables
Für `/api/*` (z. B. auf Vercel):
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGIN` (z. B. `https://parrylicious.store` oder mehrere per Komma: `https://parrylicious.store,http://localhost:3000`)
- `RESEND_API_KEY` (optional, für E-Mail)
- `RESEND_FROM_EMAIL` (optional, für E-Mail)
- `TWILIO_ACCOUNT_SID` (optional, für SMS)
- `TWILIO_AUTH_TOKEN` (optional, für SMS)
- `TWILIO_FROM_NUMBER` (optional, für SMS)

## Frontend API Ziel setzen
Wenn Frontend und API nicht auf derselben Domain laufen:
1. In `backend-config.js` `BACKEND_API_BASE_URL` setzen, z. B. `https://parrylicious-api.vercel.app`
2. Backend `ALLOWED_ORIGIN` auf deine Frontend-Domain setzen.

## Stripe Setup
1. In Stripe ein Produkt für die Anzahlung ist nicht zwingend nötig; Checkout wird dynamisch pro Buchung erzeugt.
2. Webhook Endpoint anlegen:
   - URL: `<API_BASE_URL>/api/stripe-webhook`
   - Events:
     - `checkout.session.completed`
     - `checkout.session.async_payment_succeeded`
     - `checkout.session.async_payment_failed`
     - `checkout.session.expired`
3. Signatur-Secret aus Stripe als `STRIPE_WEBHOOK_SECRET` setzen.
4. `ALLOWED_ORIGIN` muss auf die Frontend-Domain zeigen, sonst blockiert Checkout-Rückkehr (`successUrl`/`cancelUrl`).
5. Für stabile Webhook-Verifikation auf allen Hostern: `STRIPE_SECRET_KEY` auch im Webhook-Backend setzen (Fallback per Event-ID Abruf).

## Lokaler Start
Empfohlen mit Vercel CLI, damit Frontend und `/api/*` lokal zusammen laufen:
```bash
vercel dev
```
Dann öffnen: `http://localhost:3000`

## Deployment
- Nur Frontend (ohne `/api/*`): GitHub Pages möglich.
- Voller Produktivbetrieb mit Checkout/Webhook/Notifications: Vercel (oder anderes Hosting mit Node Functions) empfohlen.

## Rechtliches
- `impressum.html` und `privacy.html` sind auf produktive Inhalte umgestellt.
- Vor Livegang juristisch final prüfen lassen (insb. USt-/Steuerangaben, Auftragsverarbeiter, Formulierungen).

## QA-Checkliste vor Launch
- Login:
  - E-Mail/Passwort
  - Google OAuth
- Buchung:
  - Gastbuchung ohne Login
  - Konto-Buchung mit Stripe Checkout
  - Checkout startet nur für aktive (nicht stornierte) Buchungen
  - Offene Anzahlungen aus dem Dashboard erneut starten
  - Rückkehr nach erfolgreicher Zahlung (`payment=success`)
  - Rückkehr bei Abbruch (`payment=cancel`)
- Slotlogik:
  - Doppelbuchungsschutz aktiv
  - Kalenderhorizont: `maxDaysAhead = 60` und Anzeige ebenfalls 60 Tage
- Admin:
  - Rollenrechte (`customer` vs `staff/admin`)
  - Bestätigen/Stornieren aktualisiert DB
  - Benachrichtigungen werden versendet
- Mobile:
  - Header, Wizard, Dashboard auf iOS/Android prüfen
