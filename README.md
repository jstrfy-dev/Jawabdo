# JawabDo

JawabDo is an Expo / React Native app with a separate Node.js backend. The app keeps its explicitly labeled demo mode; signed-in business screens use the backend API and never connect directly to the database.

## Windows and XAMPP (MySQL/MariaDB)

### Requirements

- Node.js 22.13.x or later (recommended: Node.js 24 LTS). The current Node.js 24.14.1 environment meets this requirement.
- XAMPP for Windows with its bundled MySQL/MariaDB server.
- npm dependencies (`npm install`).

### Start XAMPP and import the schema

1. Open **XAMPP Control Panel** and click **Start** next to **MySQL**. Apache is optional for this Node/Expo application.
2. Import the schema once:
   - **phpMyAdmin:** open `http://localhost/phpmyadmin`, select **Import**, choose `database\jawabdo.sql`, then click **Import**. The script creates and selects the `jawabdo` database.
   - **MySQL command line (PowerShell):**

     ```powershell
     Get-Content .\database\jawabdo.sql | & 'C:\xampp\mysql\bin\mysql.exe' --protocol=tcp -h 127.0.0.1 -P 3306 -u root
     ```

     If your MySQL root account has a password, add `-p` to the command; the client will prompt for it. Do not put the password in the command itself.

`database\jawabdo.sql` uses MariaDB/MySQL-compatible `CREATE ... IF NOT EXISTS` statements and does not drop or truncate tables. It contains no business/customer seed data, passwords, or provider tokens. It is safe to re-import for initial schema setup, but it does not migrate records from an existing PostgreSQL database.

### Configure and run the backend

The default local connection is `127.0.0.1:3306`, database `jawabdo`, user `root`. The XAMPP instance detected during setup accepts root without a password. If your local credentials differ, add/update `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` in `.env`.

Never replace an existing `.env`. If there is no `.env` yet, the Windows startup script creates one from `.env.example`; review it and set a private `JWT_SECRET` (at least 32 bytes) before using the API. Database credentials stay in the Node backend and are not Expo `EXPO_PUBLIC_*` settings.

```powershell
npm install
npm run mysql:check
npm run mysql:start
```

Or double-click `start-backend.bat`. It checks Node.js, dependencies, and database connectivity before starting; it never imports, resets, or deletes the database. The API listens on port `3000` by default. Its database health endpoint is `http://localhost:3000/api/health`; it reports API/database status only, not credentials.

The MySQL API provides authentication, business profile/hours, services and prices, FAQs, customers, conversations/messages, appointments, and dashboard endpoints. Every signed-in data route checks the account's business membership and scopes its queries to that business. Registration is development-only until email verification is configured.

In development, the backend allows the Expo web origins `http://localhost:8081` and `http://127.0.0.1:8081` in addition to any configured `CORS_ORIGINS`; production continues to require its explicitly configured HTTPS origins. Choose exactly one API runtime on port 3000: `npm run mysql:start` (or `start-backend.bat`) uses the MySQL database, while `npm run server:dev` uses the PostgreSQL database. The app connects to whichever API is running at its configured URL; it does not switch databases or fall back when that server is unavailable.

Web defaults to `http://localhost:3000`. Android uses the Expo development host address when available and falls back to `http://10.0.2.2:3000` for the emulator. For a physical phone, set `EXPO_PUBLIC_API_URL=http://<computer-LAN-IP>:3000` in the Expo environment and restart Expo; do not use `localhost` or `10.0.2.2` on the phone. The computer's firewall must allow the API port on its private network.

The MySQL API does not currently configure or send WhatsApp messages/reminders. It reports WhatsApp as not connected; do not treat a saved connection row as a live integration. The existing PostgreSQL production backend and its webhook/worker implementation remain available through `npm run db:migrate` and `npm run server:dev` / `npm run server:start` when using its configured PostgreSQL database. These are separate database runtimes; MySQL startup does not migrate or modify PostgreSQL data.

Signed-in accounts can request deletion from **Settings → Privacy and data** by confirming the action and re-entering their password. The API blocks deletion while other team members share any of the account's businesses; business ownership/data must be handled before retrying. Deletion removes the owned JawabDo database records and does not unsubscribe the WhatsApp app in Meta. Email verification and password reset are not implemented, so production account registration remains disabled.

### Run the Expo application

JawabDo uses Expo SDK 57.0.31 with React Native 0.86.3 and React 19.2.3. Expo-managed native dependencies are aligned with SDK 57. SDK 55 and later require React Native's New Architecture; the project does not opt out of it.

This project uses Expo's managed/prebuild workflow: it has no checked-in `android` or `ios` directories and does not currently include `expo-dev-client`. The SDK 57 Expo Go app is not currently available in the app stores; Expo documents `eas go` for iOS devices and Expo CLI distribution for Android devices/emulators and iOS simulators. Otherwise, use an SDK 57-compatible development build. On Windows with Android Studio installed, `npx expo run:android` builds and runs Android and generates the native `android` directory. iOS builds require macOS and Xcode (`npx expo run:ios`). If adopting an EAS development-client workflow, install `expo-dev-client` and create a new development build after the SDK upgrade; an existing native binary must be rebuilt for SDK 57.

Start the Expo development server in a separate terminal:

```powershell
npm start
```

Run the web app with `npm run web`. The Expo app is independent of Apache and the Node backend. Apache serves PHP projects; starting Apache alone does not start the Node API or the Expo app.

The app uses `http://localhost:3000` for web/iOS, the Expo development host on Android, and `http://10.0.2.2:3000` as the Android emulator fallback. For a physical phone, set `EXPO_PUBLIC_API_URL=http://<computer-LAN-IP>:3000` in the Expo environment and allow Node through Windows Firewall on a private network. This variable is a public API origin, never a secret.

## Existing PostgreSQL backend

PostgreSQL is the sole intended production source of truth for all cloud business data. Both web and mobile builds must set the same deployed API origin in build-time `EXPO_PUBLIC_API_URL`; production builds reject local/HTTP API URLs, require the API to report `databaseDriver=postgres`, and do not offer demo mode. The production API uses only PostgreSQL; startup refuses a superuser/`BYPASSRLS` database role, missing migrations, incomplete forced tenant RLS, or a missing confirmed-booking overlap constraint.

The original backend and durable Meta webhook/reminder worker use PostgreSQL. For local development, configure `DATABASE_URL`, `JWT_SECRET`, and `ENCRYPTION_KEY` in `.env`, then run:

```powershell
npm run db:migrate
npm run server:dev
```

For production, set `NODE_ENV=production`, `DATABASE_SSL=true`, the non-local PostgreSQL runtime connection in `DATABASE_URL`, and at least one HTTPS web origin in `CORS_ORIGINS`. The Node API validates the runtime role/schema at startup. Run migrations with a separate `MIGRATION_DATABASE_URL` role; never use that elevated credential for the running API. Set the deployed HTTPS API origin as `EXPO_PUBLIC_API_URL` in both the web and mobile build environments. See [DATABASE_OPERATIONS.md](./DATABASE_OPERATIONS.md) for role, migration, backup/restore, and MySQL retirement/migration guidance.

`npm run whatsapp:dev` is a separate allowlist-only test webhook service. It is not the MySQL API. See [WHATSAPP_SETUP.md](./WHATSAPP_SETUP.md) for existing Meta integration requirements and limitations.

## Tests

```powershell
npm test
```

## Android / Play Store

`app.json` still resolves to the placeholder application ID `com.placeholder.appid` and has no app icon/splash assets, signing, privacy policy URL, or EAS build/submit configuration. Google Play requires new apps and updates submitted from August 31, 2026 to target Android 16 (API 36) or later; the project does not explicitly set `targetSdkVersion`, so verify the generated native project target before building. Supply the actual package ID, brand assets, public privacy policy URL, support contact, Data safety declarations, and Play Console account details before release. Do not ship sample customer data as live account data.
