# JawabDo

JawabDo contains an Expo / React Native demo app and a separate Node.js backend. The app screens still use on-device sample data and are not connected to the multi-tenant API. The backend now has a PostgreSQL schema and API foundation, durable signed webhook queue, worker, optional server-side AI, and reminder queue, but it is not a public-launch-ready service.

## Requirements

- Node.js 20.6 or newer.
- PostgreSQL 15 or newer with permission to install `btree_gist` for the multi-tenant backend.
- HTTPS public backend URL and Meta app approval before real WhatsApp onboarding.

## Local setup

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` locally. Do not commit it, send it in chat, or put server keys in Expo `EXPO_PUBLIC_*` variables. Use separate, generated secrets for `JWT_SECRET`, `ENCRYPTION_KEY`, and `WHATSAPP_VERIFY_TOKEN`.

After creating a PostgreSQL database, configuring `DATABASE_URL`, and setting independent local `JWT_SECRET` and `ENCRYPTION_KEY` values:

```powershell
npm run db:migrate
npm run server:dev
```

`server:dev` starts the database-backed API and durable webhook/reminder worker. It is separate from the legacy allowlist-only test service (`npm run whatsapp:dev`). The production registration endpoint intentionally remains disabled until email verification delivery is implemented; local development registration is not a production identity workflow.

Expo client:

```powershell
npm start
npm run web
```

The app now has backend sign-in. Android stores access tokens using Expo SecureStore; web uses tab-scoped `sessionStorage`. Existing dashboard/inbox/calendar screens remain local demo screens. A signed-in user can open Settings → Cloud business profile to load/update supported server business fields, services, FAQs, and WhatsApp status.

The backend listens on port `3000` unless `PORT` is changed. The centralized API URL uses:

- Web: `http://localhost:3000`.
- Android: the Expo development host's LAN address with port `3000`; without that host, emulator fallback is `http://10.0.2.2:3000`.
- Physical Android on the same Wi-Fi: set `EXPO_PUBLIC_API_URL=http://<computer-LAN-IP>:3000` if automatic Expo host detection is unavailable, then restart Expo. Allow Node through Windows Firewall on private networks.

`EXPO_PUBLIC_API_URL` is a public endpoint, **not a secret**. Never put database/JWT/Meta/Anthropic credentials in `EXPO_PUBLIC_*`. For web, configure `CORS_ORIGINS` to allow the Expo web origin, usually `http://localhost:8081`; production web origins must use HTTPS.

Backend tests:

```powershell
npm test
```

## WhatsApp and AI

See [WHATSAPP_SETUP.md](./WHATSAPP_SETUP.md) for Meta Embedded Signup, webhook and safe test instructions. The backend must be reachable over HTTPS for Meta callbacks. The React Native app cannot host webhooks or secrets.

The AI integration uses an optional server-side Anthropic API key; without it, inbound messages are handed off rather than answered with invented business facts. Approved reminder templates must be configured before reminders can be delivered. No provider credentials are included. The Expo client does not onboard Meta Embedded Signup or show server-backed conversations/bookings. Registration/email verification is not production-ready. Do not enable customer traffic until account verification, the app flow, account deletion policy, tenant authorization, Meta approval, consent evidence, booking confirmation, reminders, and operational controls have been reviewed and tested.

`WHATSAPP_SETUP.md` explains Meta prerequisites and the current backend boundary. `/webhook` is the callback path on the production backend, but Embedded Signup's mobile/web UI is not implemented yet.

## Android / Play Store

`app.json` contains the current Expo app identity but no production Android application ID, signing, privacy policy URL, or EAS build/submit configuration. Set those only after the product's Play Store identity, privacy disclosures, account deletion workflow, and production backend are ready. Do not ship sample customer data as live account data.
