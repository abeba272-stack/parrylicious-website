# Parrylicious Studio — Website

Buchungs-Website für den Afro-Hair-Salon **Parrylicious** (Düsseldorf), live unter
**[parrylicious.store](https://parrylicious.store)**.

Statisches Frontend (Vanilla JS, ES-Module) + Serverless-Backend (Vercel Functions)
mit **Neon Postgres**, eigenem **JWT-Auth**, **Stripe**-Anzahlung und **Resend**-E-Mails.

---

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Frontend | Vanilla JS (ES-Module), kein Framework · `styles-v2.css` (dunkles Editorial-Theme) |
| Hosting | **Vercel** (statische Seiten + Serverless-Funktionen unter `/api`) |
| Datenbank | **Neon** (Serverless Postgres) — Schema/Funktionen in `neon-schema.sql` |
| Auth | Eigenes **JWT** (HS256), Passwörter mit **bcryptjs** (cost 10) — kein externes SDK |
| Zahlung | **Stripe** Checkout (50 % Anzahlung) + Webhook als Quelle der Wahrheit |
| E-Mail | **Resend** (Buchungsbestätigung, Passwort-Reset, E-Mail-Verifizierung) |
| SMS (optional) | **Twilio** (nur wenn konfiguriert) |
| DNS | **Cloudflare** (Domain bei Strato registriert, NS auf Cloudflare delegiert) |

> Der frühere Supabase-/GitHub-Pages-Stand wurde vollständig abgelöst.

## Features

- **Oberkategorien → Styles**: Startseite zeigt Kategorien; Klick führt in die Buchung zu den Styles.
- **Buchungs-Wizard**: Style → Stylist → Datum/Slot → Daten → Stripe-Anzahlung. Slot-Schutz gegen Doppelbuchungen (Advisory-Lock / `slot_is_available`).
- **Gast- oder Kontobuchung**: Gäste buchen mit Anzahlung; Konten bekommen Zusatzfunktionen.
- **Kundenkonten** (`konto.html`): eigene Termine, Profil, Stornieren/Verschieben (bis 48 h vorher), Treuepunkte, Bewertung schreiben.
- **Neukundenrabatt** 10 % (nur angemeldet + E-Mail bestätigt, erste Buchung).
- **Treuepunkte**: 1 Punkt/€ nach abgeschlossenem Termin; Einlösen 100 = 5 € auf die Anzahlung (min. 1 € Restanzahlung).
- **Bewertungen**: verifizierte Konten schreiben Reviews (1–5 Sterne) → Moderation im Dashboard → Anzeige auf der Startseite.
- **Mitarbeiter-Dashboard** (`admin.html`, Rollen `staff`/`admin`): Termine bestätigen/stornieren, Terminkalender, Warteliste, Reviews-Moderation, Team-Accounts & Rollen (nur admin).

## Projektstruktur

```
index.html                 Startseite (dunkles Editorial-Theme, inline CSS/JS)
booking.html / booking.js  Buchungs-Wizard
konto.html  / konto.js     „Mein Konto" (Kunde)
login.html  / login.js     Login/Registrierung (Kunde) + Team-Login
admin.html  / admin.js     Mitarbeiter-Dashboard
verify.html                E-Mail-Bestätigung (?token=…)
impressum.html / privacy.html   Impressum · Datenschutz & Bedingungen
styles-v2.css              gemeinsames Theme
data/services.js           Service-/Preis-Katalog (Frontend-Anzeige)
data-client.js             /api-Client (Buchungen, Kunde, Reviews, Admin)
auth-client.js             JWT-Session (localStorage), Login/Logout/Refresh
backend-client.js          Checkout/Waitlist/Notification-Aufrufe
nav.js                     mobile Navigation + rollenabhängiger Konto-Link
api/                       Vercel Serverless-Funktionen (siehe unten)
neon-schema.sql            Datenbank-Schema + Funktionen (Neon)
```

### API (`/api`) — 12 Funktionen (Vercel Hobby-Limit!)
Dateien mit `_` sind gemeinsame Module und zählen **nicht** als Funktion.
Zusammengefasste Endpunkte nutzen dynamische `[action].js`-Dispatcher, um unter 12 zu bleiben.

```
api/auth/[action].js       signup, verify-email, login, refresh, me, logout, reset-password, change-password
api/customer/[action].js   bookings (cancel/reschedule), eligibility, points, profile
api/admin/[action].js      roles, staff, reviews (Moderation)
api/bookings.js            Team-Buchungsliste
api/bookings/checkout.js   Gast-/Kunden-Checkout (Stripe-Session, Rabatt, Punkte)
api/reviews.js             Reviews lesen/summary + schreiben (buchungsbezogen & allgemein)
api/slots.js               Slot-Verfügbarkeit (öffentlich)
api/waitlist.js            Warteliste
api/profile.js             Profil
api/stripe-webhook.js      Stripe-Webhook (Signaturprüfung!) — bestätigt Buchung
api/verify-checkout-session.js  Rückkehr-Verifikation
api/send-booking-notification.js  Benachrichtigung (Resend / optional Twilio)
api/_lib.js  api/_email.js  api/_services.js   gemeinsame Module (keine Funktionen)
```

## Environment-Variablen (Vercel-Projekt → Settings → Environment Variables)

| Variable | Zweck |
|---|---|
| `DATABASE_URL` | Neon-Connection-String |
| `JWT_SECRET` | Signatur der Access-Tokens (HS256) |
| `STRIPE_SECRET_KEY` | Stripe (Live: `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Verifikation des Stripe-Webhooks (`whsec_…`) |
| `RESEND_API_KEY` | Resend (⚠️ aus dem Konto, in dem die Domain verifiziert ist) |
| `RESEND_FROM_EMAIL` | Absender, z. B. `buchung@parrylicious.store` |
| `RESEND_REPLY_TO` | optionale Antwortadresse |
| `RESEND_BCC` | optionale BCC-Kopie |
| `FRONTEND_URL` | Basis-URL für Links in E-Mails (z. B. `https://parrylicious.store`) |
| `ALLOWED_ORIGIN` | CORS-Origin(s), Komma-getrennt möglich |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | optional (SMS) |

`.env` / `.env.local` sind **gitignored** und werden per `.vercelignore` **nicht** mitdeployt.
Secrets werden ausschließlich im Vercel-Dashboard gesetzt.

## Lokale Entwicklung

```bash
npm install
node dev-server.cjs   # lokaler Dev-Server (nicht im Deploy enthalten)
```

Für Zahlungen im Testmodus Stripe-Testkarte `4242 4242 4242 4242` und
`stripe listen --forward-to localhost:3000/api/stripe-webhook` verwenden.

## Deployment (Vercel)

```bash
npx vercel@latest deploy --prod
npx vercel@latest alias set <deployment-url> parrylicious.store
```

Die Domain muss nach jedem Prod-Deploy neu aliasiert werden.
Der Stripe-Webhook zeigt im Stripe-Dashboard auf `https://parrylicious.store/api/stripe-webhook`
(Events: `checkout.session.completed`, `async_payment_succeeded`, `async_payment_failed`, `expired`).

## Datenbank

Schema und alle Postgres-Funktionen liegen in `neon-schema.sql` und wurden gegen die
Live-Neon-Instanz migriert. Bei Katalog-Änderungen müssen `data/services.js` (Frontend)
und `api/_services.js` (serverseitige Preisquelle für Stripe) **synchron** bleiben.

## Rollen
- `customer` (Default): eigene Termine, Profil, Stornieren/Verschieben, Punkte, Bewertung.
- `staff`: alle Termine/Warteliste, bestätigen/stornieren, Kalender, Reviews moderieren.
- `admin`: wie `staff` + Team-Accounts anlegen und Rollen verwalten.

## Vor der Übergabe
Siehe **`ABGABE-CHECKLISTE.md`** (Secrets rotieren, echte Fotos/Namen, Stripe-Live prüfen,
Konten-Übergabe, anwaltliche Prüfung der Rechtstexte).
