const {
  createHash,
  randomBytes,
} = require('node:crypto');
const { hashPassword, signToken, verifyPassword, verifyToken, encryptSecret } = require('./security');
const { withTransaction } = require('./db');

const BODY_LIMIT_BYTES = 1024 * 1024;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_REQUESTS = 8;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function validateOpeningHours(hours) {
  if (!Array.isArray(hours) || hours.length > 7) validation('Opening hours must contain up to seven days.');
  const seenDays = new Set();
  for (const day of hours) {
    if (!day || typeof day !== 'object' || Array.isArray(day) || !Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      validation('Each opening-hours entry needs a dayOfWeek from 0 to 6.');
    }
    if (seenDays.has(day.dayOfWeek)) validation('Opening hours may include each day only once.');
    seenDays.add(day.dayOfWeek);
    if (day.closed === true) continue;
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.open) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.close) || day.close <= day.open) {
      validation('Open days need valid 24-hour open and close times, with closing after opening.');
    }
  }
}

function bookingFitsOpeningHours(start, end, timezone, hours) {
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (date) => Object.fromEntries(dateFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  const startParts = parts(start);
  const endParts = parts(end);
  if (startParts.year !== endParts.year || startParts.month !== endParts.month || startParts.day !== endParts.day) return false;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const hoursForDay = hours.find((day) => day.dayOfWeek === weekdays[startParts.weekday]);
  if (!hoursForDay || hoursForDay.closed === true) return false;
  const localStart = `${startParts.hour}:${startParts.minute}`;
  const localEnd = `${endParts.hour}:${endParts.minute}`;
  return localStart >= hoursForDay.open && localEnd <= hoursForDay.close;
}

function send(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  response.end(JSON.stringify(body));
}

function validation(message) {
  throw new HttpError(400, message, 'invalid_input');
}

function parseRequiredString(value, name, maxLength) {
  if (typeof value !== 'string') validation(`${name} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) validation(`${name} must contain between 1 and ${maxLength} characters.`);
  return normalized;
}

function parsePhone(value, name) {
  const phone = parseRequiredString(value, name, 20).replace(/[\s()+.-]/g, '');
  if (!/^\d{8,15}$/.test(phone)) validation(`${name} must use international format, digits only.`);
  return phone;
}

function validTimezone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function parseJsonBody(raw) {
  try {
    const value = JSON.parse(raw.toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) validation('JSON body must be an object.');
    return value;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    validation('Request body must contain valid JSON.');
  }
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > BODY_LIMIT_BYTES) throw new HttpError(413, 'Request body is too large.', 'body_too_large');
    chunks.push(chunk);
  }
  return parseJsonBody(Buffer.concat(chunks));
}

function createRateLimiter() {
  const attempts = new Map();
  return (key) => {
    const now = Date.now();
    const current = attempts.get(key);
    if (!current || current.expiresAt <= now) {
      attempts.set(key, { count: 1, expiresAt: now + AUTH_WINDOW_MS });
      if (attempts.size > 10000) {
        for (const [entryKey, value] of attempts) if (value.expiresAt <= now) attempts.delete(entryKey);
      }
      return;
    }
    current.count += 1;
    if (current.count > AUTH_MAX_REQUESTS) throw new HttpError(429, 'Too many authentication attempts. Try again later.', 'rate_limited');
  };
}

function authorization(request, config) {
  const header = String(request.headers.authorization || '');
  const match = header.match(/^Bearer ([A-Za-z0-9._-]+)$/);
  const payload = match && verifyToken(match[1], config.jwtSecret);
  if (!payload) throw new HttpError(401, 'Sign in to continue.', 'unauthorized');
  return payload;
}

async function withAuthorizedBusiness(pool, userId, businessId, callback) {
  return withTransaction(pool, async (client) => {
    const membership = await client.query(
      'SELECT role FROM business_memberships WHERE business_id = $1 AND user_id = $2',
      [businessId, userId],
    );
    const role = membership.rows[0]?.role;
    if (!role) throw new HttpError(403, 'You do not have access to this business.', 'business_access_denied');
    return callback(client, role);
  }, { userId, businessId });
}

async function graphRequest(fetchImpl, url, options) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(12000) });
  } catch {
    throw new HttpError(502, 'Meta could not complete the WhatsApp connection request. Try again.', 'meta_unavailable');
  }
  let payload;
  try { payload = await response.json(); } catch { payload = null; }
  if (!response.ok || !payload) {
    throw new HttpError(502, 'Meta rejected the WhatsApp connection. Check the app permissions and business assets.', 'meta_rejected_request');
  }
  return payload;
}

function createApiHandler(config, pool, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const logger = options.logger || { info: (event) => console.info(JSON.stringify(event)), error: (event) => console.error(JSON.stringify(event)) };
  const rateLimit = createRateLimiter();

  return async function handleApi(request, response, url) {
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) return false;

    const origin = String(request.headers.origin || '');
    if (origin) {
      if (!config.corsOrigins.includes(origin)) {
        send(response, 403, { error: 'Origin is not allowed.' });
        return true;
      }
      response.setHeader('access-control-allow-origin', origin);
      response.setHeader('vary', 'Origin');
      response.setHeader('access-control-allow-headers', 'authorization, content-type');
      response.setHeader('access-control-allow-methods', 'GET, POST, PUT, DELETE, OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return true;
    }

    try {
      if (pathname === '/api/config/public' && request.method === 'GET') {
        send(response, 200, {
          metaEmbeddedSignupReady: Boolean(config.metaAppId && config.embeddedSignupConfigId && config.apiVersion && config.metaAppSecret),
          metaAppId: config.metaAppId || null,
          embeddedSignupConfigId: config.embeddedSignupConfigId || null,
          graphApiVersion: config.apiVersion || null,
          signupVersion: 'v4',
          databaseDriver: 'postgres',
        });
        return true;
      }

      if (pathname === '/api/auth/register' && request.method === 'POST') {
        rateLimit(`register:${request.socket.remoteAddress || 'unknown'}`);
        const body = await readBody(request);
        const email = parseRequiredString(body.email, 'Email', 254).toLowerCase();
        if (!emailPattern.test(email)) validation('Enter a valid email address.');
        if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
          validation('Password must contain between 12 and 128 characters.');
        }
        const businessName = parseRequiredString(body.businessName, 'Business name', 120);
        const category = typeof body.category === 'string' ? body.category.trim().slice(0, 100) : '';
        if (config.nodeEnv === 'production' && !config.emailVerificationConfigured) {
          throw new HttpError(503, 'Account creation is disabled until email verification is configured.', 'email_verification_unavailable');
        }

        const userId = require('node:crypto').randomUUID();
        const businessId = require('node:crypto').randomUUID();
        const passwordHash = await hashPassword(body.password);
        await withTransaction(pool, async (client) => {
          await client.query(
            'INSERT INTO app_users (id, email, password_hash, email_verified_at) VALUES ($1, $2, $3, now())',
            [userId, email, passwordHash],
          );
          await client.query(
            'INSERT INTO businesses (id, name, category) VALUES ($1, $2, $3)',
            [businessId, businessName, category],
          );
          await client.query(
            'INSERT INTO business_memberships (business_id, user_id, role) VALUES ($1, $2, $3)',
            [businessId, userId, 'owner'],
          );
        }, { userId, businessId });
        const token = signToken({ sub: userId, businessId }, config.jwtSecret);
        send(response, 201, { accessToken: token, expiresIn: 3600, user: { id: userId, email }, business: { id: businessId, name: businessName } });
        return true;
      }

      if (pathname === '/api/auth/login' && request.method === 'POST') {
        rateLimit(`login:${request.socket.remoteAddress || 'unknown'}`);
        const body = await readBody(request);
        const email = parseRequiredString(body.email, 'Email', 254).toLowerCase();
        const password = typeof body.password === 'string' ? body.password : '';
        const user = await pool.query(
          `SELECT id, email, password_hash FROM app_users
           WHERE lower(email) = $1 AND deleted_at IS NULL AND email_verified_at IS NOT NULL`,
          [email],
        );
        const found = user.rows[0];
        const passwordMatches = await verifyPassword(password, found?.password_hash);
        if (!found || !passwordMatches) throw new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials');

        const membership = await withTransaction(pool, async (client) => {
          const rows = await client.query(
            `SELECT b.id, b.name FROM business_memberships m
             JOIN businesses b ON b.id = m.business_id
             WHERE m.user_id = $1 ORDER BY m.created_at LIMIT 1`,
            [found.id],
          );
          return rows.rows[0] || null;
        }, { userId: found.id });
        if (!membership) throw new HttpError(403, 'No active business is linked to this account.', 'business_missing');
        const token = signToken({ sub: found.id, businessId: membership.id }, config.jwtSecret);
        send(response, 200, { accessToken: token, expiresIn: 3600, user: { id: found.id, email: found.email }, business: { id: membership.id, name: membership.name } });
        return true;
      }

      if (pathname === '/api/me' && request.method === 'GET') {
        const session = authorization(request, config);
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => {
          const user = await client.query('SELECT id, email, email_verified_at FROM app_users WHERE id = $1 AND deleted_at IS NULL', [session.sub]);
          const business = await client.query('SELECT id, name, category FROM businesses WHERE id = $1', [session.businessId]);
          if (!user.rows[0] || !business.rows[0]) throw new HttpError(401, 'Account is no longer available.', 'account_deleted');
          return { user: user.rows[0], business: business.rows[0] };
        });
        send(response, 200, result);
        return true;
      }

      const session = authorization(request, config);
      const conversationPath = pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})(?:\/messages)?$/i);

      if (conversationPath && pathname.endsWith('/messages') && request.method === 'GET') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => (
          client.query(
            `SELECT id,direction,sender,body,delivery_status,error_code,created_at
             FROM messages WHERE business_id=$1 AND conversation_id=$2
             ORDER BY created_at DESC LIMIT 200`,
            [session.businessId, conversationPath[1]],
          )
        ));
        send(response, 200, { messages: result.rows.reverse() });
        return true;
      }

      if (conversationPath && !pathname.endsWith('/messages') && request.method === 'PATCH') {
        const body = await readBody(request);
        if (!['ai', 'owner_handling', 'closed'].includes(body.state)) validation('Conversation state must be ai, owner_handling, or closed.');
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may update conversations.', 'insufficient_role');
          return client.query(
            `UPDATE conversations SET state=$3,updated_at=now()
             WHERE business_id=$1 AND id=$2 RETURNING id,state`,
            [session.businessId, conversationPath[1], body.state],
          );
        });
        if (!result.rowCount) throw new HttpError(404, 'Conversation not found.', 'conversation_not_found');
        send(response, 200, { conversation: result.rows[0] });
        return true;
      }

      if (pathname === '/api/business' && request.method === 'GET') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => (
          client.query(
            `SELECT id, name, category, address, timezone, language, owner_name,
              owner_phone, owner_whatsapp_opt_in, opening_hours, policies, human_handoff_enabled
             FROM businesses WHERE id = $1`,
            [session.businessId],
          )
        ));
        send(response, 200, { business: result.rows[0] });
        return true;
      }

      if (pathname === '/api/business' && request.method === 'PUT') {
        const body = await readBody(request);
        const name = parseRequiredString(body.name, 'Business name', 120);
        const category = typeof body.category === 'string' ? body.category.trim().slice(0, 100) : '';
        const address = typeof body.address === 'string' ? body.address.trim().slice(0, 300) : '';
        const timezone = body.timezone === undefined ? 'Asia/Karachi' : parseRequiredString(body.timezone, 'Timezone', 100);
        if (!validTimezone(timezone)) validation('Timezone must be a valid IANA timezone.');
        const languages = new Set(['en', 'ur', 'roman']);
        if (body.language !== undefined && !languages.has(body.language)) validation('Language must be en, ur, or roman.');
        const language = body.language === undefined ? 'roman' : body.language;
        const openingHours = body.openingHours === undefined ? [] : body.openingHours;
        const policies = body.policies === undefined ? {} : body.policies;
        validateOpeningHours(openingHours);
        if (!policies || typeof policies !== 'object' || Array.isArray(policies)) validation('Policies must be an object.');
        const ownerName = typeof body.ownerName === 'string' ? body.ownerName.trim().slice(0, 120) : '';
        const ownerPhone = body.ownerPhone ? parsePhone(body.ownerPhone, 'Owner phone') : '';
        const ownerWhatsappOptIn = body.ownerWhatsappOptIn === true;
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may edit its profile.', 'insufficient_role');
          return client.query(
            `UPDATE businesses SET name=$2, category=$3, address=$4, timezone=$5,
             language=$6, owner_name=$7, owner_phone=$8, owner_whatsapp_opt_in=$9,
             opening_hours=$10::jsonb, policies=$11::jsonb, updated_at=now()
             WHERE id=$1 RETURNING id, name, category, address, timezone, language,
             owner_name, owner_phone, owner_whatsapp_opt_in, opening_hours, policies`,
            [session.businessId, name, category, address, timezone, language, ownerName, ownerPhone, ownerWhatsappOptIn, JSON.stringify(openingHours), JSON.stringify(policies)],
          );
        });
        send(response, 200, { business: result.rows[0] });
        return true;
      }

      if (pathname === '/api/services' && request.method === 'GET') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => (
          client.query(
            `SELECT id, name, description, price_minor, currency, duration_minutes, active
             FROM services WHERE business_id = $1 ORDER BY name`,
            [session.businessId],
          )
        ));
        send(response, 200, { services: result.rows });
        return true;
      }

      if (pathname === '/api/services' && request.method === 'POST') {
        const body = await readBody(request);
        const name = parseRequiredString(body.name, 'Service name', 120);
        const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '';
        const priceMinor = body.priceMinor === null || body.priceMinor === undefined ? null : Number(body.priceMinor);
        if (priceMinor !== null && (!Number.isSafeInteger(priceMinor) || priceMinor < 0)) validation('Service price must be a non-negative integer in minor currency units.');
        const durationMinutes = Number(body.durationMinutes);
        if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) validation('Service duration must be 5 to 1440 minutes.');
        if (body.currency !== undefined && (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency))) {
          validation('Currency must be a three-letter uppercase ISO code.');
        }
        const currency = body.currency === undefined ? 'PKR' : body.currency;
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may edit services.', 'insufficient_role');
          return client.query(
            `INSERT INTO services(business_id,name,description,price_minor,currency,duration_minutes)
             VALUES($1,$2,$3,$4,$5,$6)
             RETURNING id,name,description,price_minor,currency,duration_minutes,active`,
            [session.businessId, name, description, priceMinor, currency, durationMinutes],
          );
        });
        send(response, 201, { service: result.rows[0] });
        return true;
      }

      const serviceIdMatch = pathname.match(/^\/api\/services\/([0-9a-f-]{36})$/i);
      if (serviceIdMatch && request.method === 'DELETE') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may edit services.', 'insufficient_role');
          return client.query(
            'UPDATE services SET active=false, updated_at=now() WHERE id=$1 AND business_id=$2 AND active=true RETURNING id',
            [serviceIdMatch[1], session.businessId],
          );
        });
        if (!result.rowCount) throw new HttpError(404, 'Service was not found.', 'not_found');
        send(response, 200, { status: 'deactivated' });
        return true;
      }

      if (pathname === '/api/faqs' && request.method === 'GET') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => (
          client.query(
            `SELECT id, question, answer, verified_at
             FROM business_faqs WHERE business_id=$1 ORDER BY created_at`,
            [session.businessId],
          )
        ));
        send(response, 200, { faqs: result.rows });
        return true;
      }

      if (pathname === '/api/faqs' && request.method === 'POST') {
        const body = await readBody(request);
        const question = parseRequiredString(body.question, 'FAQ question', 500);
        const answer = parseRequiredString(body.answer, 'FAQ answer', 2000);
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may edit FAQs.', 'insufficient_role');
          return client.query(
            `INSERT INTO business_faqs(business_id,question,answer,verified_at)
             VALUES($1,$2,$3,now()) RETURNING id,question,answer,verified_at`,
            [session.businessId, question, answer],
          );
        });
        send(response, 201, { faq: result.rows[0] });
        return true;
      }

      if (pathname === '/api/whatsapp/connection' && request.method === 'GET') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => (
          client.query(
            `SELECT status, display_phone_number, last_webhook_at, last_error_code, connected_at
             FROM whatsapp_connections WHERE business_id=$1`,
            [session.businessId],
          )
        ));
        send(response, 200, { connection: result.rows[0] || { status: 'not_connected' } });
        return true;
      }

      if (pathname === '/api/whatsapp/embedded-signup/session' && request.method === 'POST') {
        if (!config.metaAppId || !config.embeddedSignupConfigId || !config.metaAppSecret || !config.apiVersion) {
          throw new HttpError(503, 'Meta Embedded Signup v4 is not configured for this server.', 'meta_signup_not_configured');
        }
        const state = randomBytes(32).toString('base64url');
        const stateHash = createHash('sha256').update(state).digest('hex');
        await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (role !== 'owner') throw new HttpError(403, 'Only the business owner can connect WhatsApp.', 'insufficient_role');
          await client.query(
            `DELETE FROM signup_sessions WHERE user_id=$1 AND business_id=$2 AND (expires_at < now() OR used_at IS NOT NULL)`,
            [session.sub, session.businessId],
          );
          await client.query(
            `INSERT INTO signup_sessions(user_id,business_id,state_hash,expires_at)
             VALUES($1,$2,$3,now()+interval '10 minutes')`,
            [session.sub, session.businessId, stateHash],
          );
        });
        send(response, 201, { state, appId: config.metaAppId, configId: config.embeddedSignupConfigId, apiVersion: config.apiVersion });
        return true;
      }

      if (pathname === '/api/whatsapp/embedded-signup/complete' && request.method === 'POST') {
        const body = await readBody(request);
        const code = parseRequiredString(body.code, 'Meta authorization code', 4096);
        const state = parseRequiredString(body.state, 'Signup state', 200);
        const wabaId = parseRequiredString(body.wabaId, 'WhatsApp Business Account ID', 40);
        const phoneNumberId = parseRequiredString(body.phoneNumberId, 'Phone Number ID', 40);
        const metaBusinessId = parseRequiredString(body.metaBusinessId, 'Meta Business ID', 40);
        if (![wabaId, phoneNumberId, metaBusinessId].every((value) => /^\d+$/.test(value))) validation('Meta business/account/phone IDs must contain digits only.');
        const stateHash = createHash('sha256').update(state).digest('hex');
        const sessionResult = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (role !== 'owner') throw new HttpError(403, 'Only the business owner can connect WhatsApp.', 'insufficient_role');
          const found = await client.query(
            `UPDATE signup_sessions SET used_at=now()
             WHERE user_id=$1 AND business_id=$2 AND state_hash=$3
             AND used_at IS NULL AND expires_at > now()
             RETURNING id`,
            [session.sub, session.businessId, stateHash],
          );
          if (!found.rowCount) throw new HttpError(400, 'This signup session has expired or was already used. Start again.', 'invalid_signup_state');
          return found.rows[0];
        });
        void sessionResult;

        const tokenUrl = new URL(`https://graph.facebook.com/${config.apiVersion}/oauth/access_token`);
        tokenUrl.searchParams.set('client_id', config.metaAppId);
        tokenUrl.searchParams.set('client_secret', config.metaAppSecret);
        tokenUrl.searchParams.set('code', code);
        const tokenPayload = await graphRequest(fetchImpl, tokenUrl, { method: 'GET' });
        if (typeof tokenPayload.access_token !== 'string' || !tokenPayload.access_token) {
          throw new HttpError(502, 'Meta did not return an access token. Restart Embedded Signup.', 'meta_token_missing');
        }

        const phoneUrl = new URL(`https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(wabaId)}/phone_numbers`);
        phoneUrl.searchParams.set('fields', 'id,display_phone_number');
        const phonePayload = await graphRequest(fetchImpl, phoneUrl, {
          method: 'GET',
          headers: { authorization: `Bearer ${tokenPayload.access_token}` },
        });
        const phone = Array.isArray(phonePayload.data)
          ? phonePayload.data.find((entry) => String(entry.id) === phoneNumberId)
          : null;
        if (!phone) throw new HttpError(403, 'The selected phone number was not returned for this WhatsApp Business Account.', 'meta_asset_mismatch');

        const subscribeUrl = new URL(`https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`);
        await graphRequest(fetchImpl, subscribeUrl, {
          method: 'POST',
          headers: { authorization: `Bearer ${tokenPayload.access_token}` },
        });

        const encryptedToken = encryptSecret(tokenPayload.access_token, config.encryptionKey);
        const expiresIn = Number(tokenPayload.expires_in);
        const expiresAt = Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
        const connection = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (role !== 'owner') throw new HttpError(403, 'Only the business owner can connect WhatsApp.', 'insufficient_role');
          return client.query(
            `INSERT INTO whatsapp_connections
             (business_id,meta_business_id,waba_id,phone_number_id,display_phone_number,
              encrypted_access_token,token_expires_at,status,last_error_code,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,'connected',NULL,now())
             ON CONFLICT (business_id) DO UPDATE SET
              meta_business_id=EXCLUDED.meta_business_id,waba_id=EXCLUDED.waba_id,
              phone_number_id=EXCLUDED.phone_number_id,display_phone_number=EXCLUDED.display_phone_number,
              encrypted_access_token=EXCLUDED.encrypted_access_token,token_expires_at=EXCLUDED.token_expires_at,
              status='connected',last_error_code=NULL,connected_at=now(),updated_at=now()
             RETURNING status,display_phone_number,connected_at`,
            [session.businessId, metaBusinessId, wabaId, phoneNumberId, String(phone.display_phone_number || ''), encryptedToken, expiresAt],
          );
        });
        send(response, 200, { connection: connection.rows[0] });
        return true;
      }

      if (pathname === '/api/dashboard' && request.method === 'GET') {
        const dashboard = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => {
          const result = await client.query(
            `SELECT b.name,b.address,
              (SELECT count(*)::int FROM bookings a
               WHERE a.business_id=b.id AND date(a.starts_at AT TIME ZONE b.timezone)=date(now() AT TIME ZONE b.timezone)
                 AND a.status='confirmed') AS confirmed_today,
              (SELECT count(*)::int FROM bookings a
               WHERE a.business_id=b.id AND date(a.starts_at AT TIME ZONE b.timezone)=date(now() AT TIME ZONE b.timezone)
                 AND a.status='pending_confirmation') AS pending_today,
              (SELECT count(*)::int FROM customers c WHERE c.business_id=b.id) AS customer_count,
              (SELECT count(*)::int FROM conversations c WHERE c.business_id=b.id AND c.state='needs_owner') AS needs_reply_count
             FROM businesses b WHERE b.id=$1`,
            [session.businessId],
          );
          return result.rows[0] || null;
        });
        send(response, 200, { dashboard });
        return true;
      }

      if (pathname === '/api/customers' && request.method === 'GET') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => (
          client.query(
            `SELECT c.id,c.display_name,c.phone_number,c.notes,c.tags,c.created_at,
              count(a.id)::int AS visits,
              COALESCE(sum(CASE WHEN a.status IN ('confirmed','completed') THEN s.price_minor ELSE 0 END),0)::bigint AS spent_minor,
              max(a.starts_at) AS last_visit
             FROM customers c
             LEFT JOIN bookings a ON a.business_id=c.business_id AND a.customer_id=c.id
             LEFT JOIN services s ON s.business_id=a.business_id AND s.id=a.service_id
             WHERE c.business_id=$1 GROUP BY c.id ORDER BY c.display_name LIMIT 500`,
            [session.businessId],
          )
        ));
        send(response, 200, { customers: result.rows });
        return true;
      }

      const customerPath = pathname.match(/^\/api\/customers\/([0-9a-f-]{36})$/i);
      if (customerPath && request.method === 'GET') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => {
          const customer = await client.query(
            `SELECT c.id,c.display_name,c.phone_number,c.notes,c.tags,c.created_at,
              count(a.id)::int AS visits,
              COALESCE(sum(CASE WHEN a.status IN ('confirmed','completed') THEN s.price_minor ELSE 0 END),0)::bigint AS spent_minor,
              max(a.starts_at) AS last_visit
             FROM customers c
             LEFT JOIN bookings a ON a.business_id=c.business_id AND a.customer_id=c.id
             LEFT JOIN services s ON s.business_id=a.business_id AND s.id=a.service_id
             WHERE c.business_id=$1 AND c.id=$2 GROUP BY c.id`,
            [session.businessId, customerPath[1]],
          );
          if (!customer.rows[0]) throw new HttpError(404, 'Customer not found.', 'customer_not_found');
          const bookings = await client.query(
            `SELECT a.id,a.customer_id,a.service_name,a.starts_at,a.status,s.price_minor
             FROM bookings a LEFT JOIN services s ON s.business_id=a.business_id AND s.id=a.service_id
             WHERE a.business_id=$1 AND a.customer_id=$2 ORDER BY a.starts_at DESC LIMIT 100`,
            [session.businessId, customerPath[1]],
          );
          return { customer: customer.rows[0], bookings: bookings.rows };
        });
        send(response, 200, result);
        return true;
      }

      if (customerPath && request.method === 'PUT') {
        const body = await readBody(request);
        const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : '';
        if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 20
          || body.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 32))) {
          validation('Customer tags must contain up to 20 labels of 1 to 32 characters.');
        }
        const tags = (body.tags || []).map((tag) => tag.trim());
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (!['owner', 'manager', 'staff'].includes(role)) throw new HttpError(403, 'You do not have permission to edit customers.', 'insufficient_role');
          return client.query(
            'UPDATE customers SET notes=$3,tags=$4::jsonb,updated_at=now() WHERE business_id=$1 AND id=$2 RETURNING id,notes,tags',
            [session.businessId, customerPath[1], notes, JSON.stringify(tags)],
          );
        });
        if (!result.rowCount) throw new HttpError(404, 'Customer not found.', 'customer_not_found');
        send(response, 200, { customer: result.rows[0] });
        return true;
      }

      if (pathname === '/api/conversations' && request.method === 'GET') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => (
          client.query(
            `SELECT c.id, c.state, c.last_message_at, cu.display_name, cu.phone_number,
              (SELECT body FROM messages m WHERE m.business_id=c.business_id AND m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message
             FROM conversations c JOIN customers cu ON cu.business_id=c.business_id AND cu.id=c.customer_id
             WHERE c.business_id=$1 ORDER BY c.last_message_at DESC LIMIT 100`,
            [session.businessId],
          )
        ));
        send(response, 200, { conversations: result.rows });
        return true;
      }

      if (pathname === '/api/bookings' && request.method === 'GET') {
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => (
          client.query(
            `SELECT b.id,b.customer_id,b.service_id,b.service_name,b.staff_key,b.starts_at,b.ends_at,
              b.timezone,b.status,b.customer_confirmed_at,b.reminder_opt_in_at,
              cu.display_name AS customer_name,cu.phone_number,s.price_minor,
              COALESCE(json_agg(json_build_object('recipientType',r.recipient_type,'status',r.status,'scheduledAt',r.scheduled_at,'sentAt',r.sent_at,'errorCode',r.error_code))
                FILTER (WHERE r.id IS NOT NULL),'[]') AS reminders
             FROM bookings b
             JOIN customers cu ON cu.business_id=b.business_id AND cu.id=b.customer_id
             LEFT JOIN services s ON s.business_id=b.business_id AND s.id=b.service_id
             LEFT JOIN reminder_jobs r ON r.business_id=b.business_id AND r.booking_id=b.id
             WHERE b.business_id=$1 GROUP BY b.id,cu.id,s.id ORDER BY b.starts_at LIMIT 200`,
            [session.businessId],
          )
        ));
        send(response, 200, { bookings: result.rows });
        return true;
      }

      if (pathname === '/api/bookings' && request.method === 'POST') {
        const body = await readBody(request);
        const customerPhone = parsePhone(body.customerPhone, 'Customer phone');
        const customerName = parseRequiredString(body.customerName, 'Customer name', 120);
        const serviceId = parseRequiredString(body.serviceId, 'Service ID', 36);
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(serviceId)) {
          validation('Service ID must be a valid UUID.');
        }
        if (typeof body.startsAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(body.startsAt)) {
          validation('Appointment time must include an explicit timezone offset.');
        }
        const startsAt = new Date(body.startsAt);
        if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) validation('Appointment time must be a future ISO date/time.');
        if (body.customerConfirmed !== true) validation('The customer must confirm the selected appointment before it is saved.');
        const reminderOptIn = body.reminderOptIn === true;
        const staffKey = typeof body.staffKey === 'string' && body.staffKey.trim() ? body.staffKey.trim().slice(0, 100) : 'default';
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client) => {
          const serviceResult = await client.query(
            `SELECT id,name,duration_minutes FROM services
             WHERE business_id=$1 AND id=$2 AND active=true`,
            [session.businessId, serviceId],
          );
          const service = serviceResult.rows[0];
          if (!service) throw new HttpError(404, 'Service was not found for this business.', 'service_not_found');
          const businessResult = await client.query('SELECT timezone,owner_phone,owner_whatsapp_opt_in,opening_hours FROM businesses WHERE id=$1', [session.businessId]);
          const business = businessResult.rows[0];
          const customerResult = await client.query(
            `INSERT INTO customers(business_id,whatsapp_user_id,display_name,phone_number,reminder_opt_in_at)
             VALUES($1,$2,$3,$2,CASE WHEN $4 THEN now() ELSE NULL END)
             ON CONFLICT(business_id,whatsapp_user_id) DO UPDATE SET display_name=EXCLUDED.display_name,
             reminder_opt_in_at=CASE WHEN $4 THEN now() ELSE customers.reminder_opt_in_at END,
             opted_out_at=NULL,updated_at=now()
             RETURNING id`,
            [session.businessId, customerPhone, customerName, reminderOptIn],
          );
          const customerId = customerResult.rows[0].id;
          const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60000);
          if (!bookingFitsOpeningHours(startsAt, endsAt, business.timezone, business.opening_hours)) {
            throw new HttpError(409, 'This service does not fit within the business opening hours.', 'outside_opening_hours');
          }
          await client.query(
            `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`,
            [`${session.businessId}:${staffKey}`],
          );
          const conflict = await client.query(
            `SELECT id FROM bookings
             WHERE business_id=$1 AND staff_key=$2 AND status='confirmed'
             AND starts_at < $4 AND ends_at > $3 LIMIT 1`,
            [session.businessId, staffKey, startsAt.toISOString(), endsAt.toISOString()],
          );
          if (conflict.rowCount) throw new HttpError(409, 'This staff member is no longer available at that time.', 'booking_conflict');
          const booking = await client.query(
            `INSERT INTO bookings
             (business_id,customer_id,service_id,service_name,staff_key,starts_at,ends_at,timezone,status,customer_confirmed_at,reminder_opt_in_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,'confirmed',now(),CASE WHEN $9 THEN now() ELSE NULL END)
             RETURNING id,customer_id,service_id,service_name,staff_key,starts_at,ends_at,timezone,status,customer_confirmed_at`,
            [session.businessId, customerId, service.id, service.name, staffKey, startsAt.toISOString(), endsAt.toISOString(), business.timezone, reminderOptIn],
          );
          const scheduledAt = new Date(startsAt.getTime() - 15 * 60000);
          const reminderRecipients = [];
          if (reminderOptIn) reminderRecipients.push(['customer', customerPhone]);
          if (business.owner_phone && business.owner_whatsapp_opt_in) reminderRecipients.push(['owner', business.owner_phone]);
          for (const [recipientType, recipientPhone] of reminderRecipients) {
            await client.query(
              `INSERT INTO reminder_jobs(business_id,booking_id,recipient_type,recipient_phone,scheduled_at)
               VALUES($1,$2,$3,$4,$5) ON CONFLICT (business_id,booking_id,recipient_type) DO NOTHING`,
              [session.businessId, booking.rows[0].id, recipientType, recipientPhone, scheduledAt.toISOString()],
            );
          }
          return booking.rows[0];
        });
        send(response, 201, { booking: result });
        return true;
      }

      const bookingPath = pathname.match(/^\/api\/bookings\/([0-9a-f-]{36})$/i);
      if (bookingPath && request.method === 'PATCH') {
        const body = await readBody(request);
        if (!['cancelled', 'completed'].includes(body.status)) validation('Booking status must be cancelled or completed.');
        const result = await withAuthorizedBusiness(pool, session.sub, session.businessId, async (client, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may update bookings.', 'insufficient_role');
          const updated = await client.query(
            `UPDATE bookings SET status=$3,updated_at=now()
             WHERE business_id=$1 AND id=$2 AND status='confirmed'
             RETURNING id,status`,
            [session.businessId, bookingPath[1], body.status],
          );
          if (updated.rowCount && body.status === 'cancelled') {
            await client.query(
              `UPDATE reminder_jobs SET status='cancelled',updated_at=now()
               WHERE business_id=$1 AND booking_id=$2 AND status IN ('pending','processing')`,
              [session.businessId, bookingPath[1]],
            );
          }
          return updated;
        });
        if (!result.rowCount) throw new HttpError(404, 'Confirmed booking not found.', 'booking_not_found');
        send(response, 200, { booking: result.rows[0] });
        return true;
      }

      if (pathname === '/api/account' && request.method === 'DELETE') {
        const body = await readBody(request);
        if (body.confirmation !== 'DELETE MY ACCOUNT') validation('Type DELETE MY ACCOUNT to confirm account deletion.');
        const password = typeof body.password === 'string' ? body.password : '';
        const userResult = await pool.query('SELECT password_hash FROM app_users WHERE id=$1 AND deleted_at IS NULL', [session.sub]);
        if (!userResult.rows[0] || !await verifyPassword(password, userResult.rows[0].password_hash)) {
          throw new HttpError(403, 'Password confirmation failed.', 'reauthentication_failed');
        }
        await withTransaction(pool, async (client) => {
          const ownerMembership = await client.query(
            `SELECT business_id FROM business_memberships WHERE user_id=$1 AND role='owner'`,
            [session.sub],
          );
          if (!ownerMembership.rows.some((row) => row.business_id === session.businessId)) {
            throw new HttpError(403, 'Only a business owner can delete this account.', 'insufficient_role');
          }
          await client.query(
            `DELETE FROM businesses WHERE id IN (
               SELECT business_id FROM business_memberships WHERE user_id=$1 AND role='owner'
             )`,
            [session.sub],
          );
          await client.query('DELETE FROM business_memberships WHERE user_id=$1', [session.sub]);
          await client.query(
            `UPDATE app_users SET deleted_at=now(),email=concat(id::text,'@deleted.invalid'),password_hash='' WHERE id=$1`,
            [session.sub],
          );
        }, { userId: session.sub, worker: true });
        send(response, 200, { status: 'deleted' });
        return true;
      }

      if (pathname.startsWith('/api/')) {
        send(response, 404, { error: 'API endpoint not found.' });
        return true;
      }
      return false;
    } catch (error) {
      const status = error instanceof HttpError
        ? error.status
        : error?.code === '23P01' || (error?.code === '23505' && pathname === '/api/auth/register')
          ? 409
          : 500;
      if (status >= 500) logger.error({
        event: 'api_request_failed',
        path: pathname,
        status,
        errorName: error?.name || 'UnknownError',
        errorCode: error?.code || null,
      });
      send(response, status, {
        error: error instanceof HttpError
          ? error.message
          : error?.code === '23P01'
            ? 'This staff member is no longer available at that time.'
            : error?.code === '23505' && pathname === '/api/auth/register'
              ? 'An account with this email already exists.'
              : 'The request could not be completed.',
        ...(error instanceof HttpError && error.code
          ? { code: error.code }
          : error?.code === '23P01'
            ? { code: 'booking_conflict' }
            : status === 409
              ? { code: 'conflict' }
              : {}),
      });
      return true;
    }
  };
}

module.exports = { createApiHandler, HttpError };
