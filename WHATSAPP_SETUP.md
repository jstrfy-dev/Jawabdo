# JawabDo WhatsApp Cloud API Setup

Yeh guide current JawabDo code ke mutabiq hai. WhatsApp webhook aur backend server-side hain; Expo mobile app webhook host nahi kar sakti aur us mein Meta tokens nahi rakhne chahiye.

## Current status — pehle yeh samajh lein

- `server/production-index.js` database-backed multi-business API start karta hai. Meta se signed webhook `POST /webhook` leta hai, event ko PostgreSQL queue mein deduplicate karta hai aur worker ko deta hai.
- Worker connected WABA ke encrypted token se customer text ka jawab bhejta hai. Anthropic server key na ho, ya model jawab na de sake, to generic owner-handoff reply hota hai. Unknown business facts / appointment availability AI se confirm nahi ki jati.
- Appointment reminder rows persistent database mein schedule hoti hain. Delivery ke liye Meta mein approved template banane ke baad customer aur owner template names configure karne hote hain. Template missing ho to job failed dikhegi; bhejne ka jhoota daawa nahi hota.
- Official Embedded Signup v4 ka **server-side code exchange endpoint** aur status API maujood hain, lekin Expo app mein Meta SDK / Facebook Login for Business onboarding screen abhi wired nahi. Is liye business account ko app UI se connect karna abhi mumkin nahi; successful connection show ya simulate nahi ki jati.
- Expo app mein backend sign-in, native SecureStore session, cloud business profile, services, FAQs aur WhatsApp status page ab hai. Dashboard/inbox/calendar abhi local demo data hain; cloud conversations/bookings screens abhi wired nahi.
- `npm run whatsapp:dev` alag legacy test-only server hai. Isay production ya multiple businesses ke inbound traffic ke liye use na karein.
- Real Meta account, customer message, template, token ya deployment is workspace mein verify nahi hua.

## Kya chahiye

1. [Meta for Developers](https://developers.facebook.com/) account aur Meta developer app.
2. WhatsApp product, WhatsApp Business Account (WABA), business phone number aur **Phone Number ID**.
3. Facebook Login for Business ke saath Embedded Signup **v4** configuration; app review / access permissions jo Meta aapke use case ke liye maange.
4. Public HTTPS backend host aur PostgreSQL 15+ database; database host ko `btree_gist` PostgreSQL extension allow karni hogi.
5. Production secrets host par set karein. Secret values chat mein paste/share na karein; kisi personal WhatsApp password, OTP ya QR session ki zaroorat nahi.

Test number aur real number alag hain: Meta ka test sender sirf API Setup ke allowed recipients ko test message bhejta hai. Apna business number production mein use karne ke liye Meta ki eligibility, business verification, number registration/onboarding aur display-name approval ka amal mukammal karein. Number type karna connection nahi hota. Existing WhatsApp Business app number ko migrate, deregister ya disconnect na karein. Coexistence sirf tab use karein jab Meta aapke account/region ke liye compatible Embedded Signup flow explicitly offer kare.

## Local backend setup

VS Code terminal mein project root par:

```powershell
npm install
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

`.env` pehle se ho to usay overwrite na karein; missing names manually add karein. `.env` Git-ignored hai, magar phir bhi isay share/commit na karein.

`DATABASE_URL`, `JWT_SECRET`, aur `ENCRYPTION_KEY` production server ke liye lazmi hain. JWT aur encryption secrets alag random values hon:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Pehli value `JWT_SECRET`; doosri `ENCRYPTION_KEY`. Inhe secure password manager ya host secret store mein save karein. `WHATSAPP_VERIFY_TOKEN` bhi aap khud random banate hain:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Server `.env` values:

| Variable | Kahan se / kis liye |
|---|---|
| `DATABASE_URL` | Managed PostgreSQL connection URL. Provider se TLS URL lein. |
| `DATABASE_SSL` | TLS-required provider ho to `true`; local DB par `false`. |
| `JWT_SECRET` | Aap generate karte hain; client se share nahi hota. |
| `ENCRYPTION_KEY` | Aap generate karte hain; 32 random bytes, base64. Meta access tokens database mein isi se encrypted hote hain. |
| `META_APP_ID` | Meta app dashboard ka App ID; public identifier hai, secret nahi. |
| `META_APP_SECRET` | Meta app → Settings → Basic → App Secret; server-only. Webhook signature validation mein bhi use hota hai. |
| `META_EMBEDDED_SIGNUP_CONFIG_ID` | Aapke Facebook Login for Business / Embedded Signup v4 configuration ka ID. |
| `WHATSAPP_VERIFY_TOKEN` | Aapka random callback verification token. |
| `WHATSAPP_API_VERSION` | Meta ke current supported Graph API version ka exact `vNN.N` format. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Optional server-only AI. API key ho to model name bhi dena zaroori hai. AI API customer message text ko provider tak bhejti hai; privacy notice/consent aur vendor review ke baghair enable na karein. |
| `WHATSAPP_CUSTOMER_REMINDER_TEMPLATE` | Meta mein approved customer reminder template ka exact name. |
| `WHATSAPP_OWNER_REMINDER_TEMPLATE` | Meta mein approved owner reminder template ka exact name. |
| `WHATSAPP_TEMPLATE_LANGUAGE` | Approved template ka locale, misal `en` ya `en_US`. |
| `PUBLIC_BASE_URL` | Backend ka public HTTPS origin. |
| `CORS_ORIGINS` | Agar web client use ho, sirf approved web origins. Native Expo requests ke liye aam tor par zaroori nahi. |

`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, aur `WHATSAPP_TEST_RECIPIENTS` sirf purane single-number `whatsapp:dev` test service ke liye hain. Production multi-business backend per-business access token Embedded Signup ke zariye leta hai aur DB mein encrypted rakhta hai. In credentials ko `EXPO_PUBLIC_*` variable mein na rakhein.

Local database par migrations aur API:

```powershell
npm run db:migrate
npm run server:dev
```

Production server API `http://localhost:3000` par chalegi; health check:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

Expo API URL web par default `http://localhost:3000` hai. Android Expo host ka LAN address port `3000` ke saath use karta hai. Detection na chale to emulator ke liye `EXPO_PUBLIC_API_URL=http://10.0.2.2:3000`, aur physical phone ke liye `EXPO_PUBLIC_API_URL=http://<computer-LAN-IP>:3000` set karein. Expo bundler restart karein. Phone/computer same Wi-Fi par hon aur Windows Firewall port 3000 allow kare. Web origin ko `.env` ke `CORS_ORIGINS` mein allow karein; default Expo web origin `http://localhost:8081` hai.

Production webhook callback URL:

```text
https://<aapka-public-backend-host>/webhook
```

Meta dashboard mein exact URL `https://<host>/webhook` set karein, `WHATSAPP_VERIFY_TOKEN` wahi dalein, aur app ke WhatsApp webhook subscription mein `messages` field select karein. Meta App Secret se har POST ka `X-Hub-Signature-256` verify hota hai. Connected WABA ko app subscribe karne ki koshish server signup completion par karta hai.

Local testing ke liye pehle database/backend configure karein, phir apna public HTTPS tunnel (jaise ngrok) `localhost:3000` par point karein aur tunnel URL Meta callback mein lagayein. Tunnel URL badalne par Meta dashboard update karna hota hai. Tunnel public endpoint hai; test ke baad tunnel band karein.

## Meta Embedded Signup v4 — manual setup

1. [Meta for Developers](https://developers.facebook.com/) par app create/open karein, business portfolio associate karein, aur WhatsApp product add karein.
2. App mein **Facebook Login for Business** configure karke current Meta docs ke mutabiq **Embedded Signup v4** flow banayein. Configuration ID aur App ID server secret store mein rakhein.
3. WhatsApp Business Management aur messaging ke liye Meta jo permissions maange unki app review/advanced access complete karein. Business verification, payment/account status, display name aur phone eligibility ko dashboard mein resolve karein.
4. App dashboard Webhooks mein WhatsApp Business Account object / `messages` field subscribe karein. Callback path `/webhook`, verify token `.env` wala random token.
5. Development mein Meta ka supplied test sender aur authorized test recipient use karein, jab tak Meta configuration test traffic allow karti hai.
6. Production mein aapka eligible business phone number Embedded Signup ke through select hoga. Meta authorization code server endpoint par exchange hoga; JawabDo isay mobile bundle mein access token ke roop mein nahi rakhta.
7. Existing WhatsApp Business app coexistence ko sirf Meta ke eligible flow offer karne par use karein. Sirf number enter karke ya normal phone-number registration karke coexistence hasil nahi hoti. Current app mein onboarding UI incomplete hai, is liye yeh step abhi manually “connected” set nahi kar sakte.

Backend session/code exchange endpoints (`Authorization: Bearer <JawabDo session>` lazmi):

- `POST /api/whatsapp/embedded-signup/session` — short-lived, one-time anti-CSRF state aur public app/config IDs deta hai.
- `POST /api/whatsapp/embedded-signup/complete` — `code`, `state`, `wabaId`, `phoneNumberId`, `metaBusinessId` leta hai; code exchange, phone/WABA check, app subscription aur token encryption karta hai.
- `GET /api/whatsapp/connection` — business ke liye status deta hai. Meta approval/config incomplete ho to disconnected rahega.

Yeh endpoints mobile UI ka substitute nahi hain. App ko official Meta JS SDK / Facebook Login for Business authorization-code flow implement karna hai aur Meta se returned WABA/phone asset session details backend ko submit karni hain. Fake IDs, manually typed phone number, permanent token in app storage, ya success status force na karein.

## Safe end-to-end test — production flow abhi incomplete

1. Pehle local PostgreSQL mein `npm run db:migrate` chalayein aur `npm test` pass hona verify karein.
2. `META_APP_ID`, `META_APP_SECRET`, Embedded Signup config ID, verify token, supported Graph version, HTTPS backend URL aur webhook subscription ko configure/approve karein.
3. Test app se authorized Meta test recipient par manually `Hello JawabDo` bhejein. Test number allowlist-only legacy flow aur multi-tenant production flow alag hain—`npm run whatsapp:dev` se actual multi-tenant app integration test nahi hoti.
4. Backend logs mein sirf event codes/count dekhein; message bodies, phone numbers, access tokens ya app secrets log nahi hone chahiye.
5. PostgreSQL mein conversation/message save, duplicate webhook suppression, replies, status callbacks, opt-out aur reminder status ko verify karein.
6. Reminder ke liye approved templates ke exact names/language configure karein aur sirf apne authorized test number par test booking banayein. Template approval aur delivery status confirm hone se pehle reminder sent na samjhein.
7. Pehle Meta test number par validate karein. Production number/real customers ko tab tak use na karein jab tak auth, mobile onboarding, consent, tenant isolation, migration/backup, template delivery, privacy and deletion review aur Android release checks pass na hon.

### Troubleshooting

- Callback verification fail: HTTPS URL `/webhook` ke saath, tunnel up, token exact match aur backend health check verify karein.
- `401` webhook: Meta App Secret sahi ho aur request body mutate karne wala reverse proxy na ho.
- `meta_rejected_request`: App Review/permissions, WABA asset access, phone ID, API version aur token expiry check karein; server generic error deta hai taake secrets leak na hon.
- Connection `needs_attention`: Meta status/delivery webhook aur provider settings manually check karein. Error code dashboard/API mein dikh sakta hai, token nahi.
- Reminder `failed`: approved template name/language, recipient consent, connected status aur Meta delivery status check karein. Template missing ho to message send nahi hota.

## Deployment / launch gates

Expo app akeli webhook serve nahi kar sakti. Backend ko HTTPS Node host par alag deploy karein; PostgreSQL ko managed encrypted service par, backups aur restore test ke saath rakhein. `npm run db:migrate` release step mein chalayein, uske baad `npm run server:start`. Host secrets sirf server environment mein rakhein. Webhook reverse proxy ko raw request body preserve karni hogi.

Mobile backend sign-in aur business profile/services/FAQs setup implemented hain. Native session Expo SecureStore mein aur web session tab-scoped `sessionStorage` mein hoti hai. Email verification backend par abhi implement nahi; production registration intentionally disabled, password reset/email delivery missing. Official Embedded Signup client, server-backed inbox/calendar, UI account deletion, and production Meta approval/deployment remaining work hain. Real connection, messages, bookings, reminder delivery, or Play Store readiness ko verified na samjhein.

Account deletion ke backend endpoint se JawabDo database data delete hota hai, lekin yeh Meta WABA se app subscription khud remove nahi karta. Jab tak disconnect screen/API add nahi hoti, account delete karne se pehle Meta Business/WhatsApp settings mein JawabDo app subscription manually hataein. Is se number deregister ya WhatsApp Business app coexistence migrate nahi hoti.
