const { randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { signToken, verifyToken, hashPassword, verifyPassword } = require('./security');
const { withMysqlTransaction } = require('./mysql-db');

const BODY_LIMIT_BYTES = 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_REQUESTS = 8;

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
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

function requiredString(value, name, maxLength) {
  if (typeof value !== 'string') validation(`${name} is required.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    validation(`${name} must contain between 1 and ${maxLength} characters.`);
  }
  return normalized;
}

function phoneNumber(value, name) {
  const phone = requiredString(value, name, 20).replace(/[\s()+.-]/g, '');
  if (!/^\d{8,15}$/.test(phone)) validation(`${name} must use international format, digits only.`);
  return phone;
}

function objectJson(value, fallback, name) {
  if (value === undefined) return fallback;
  if (!value || typeof value !== 'object' || Array.isArray(value)) validation(`${name} must be an object.`);
  return value;
}

function jsonValue(value, fallback) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value);
  const date = new Date(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function localDayBounds(timezone, instant = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const partsFor = (date) => Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  const current = partsFor(instant);
  const toUtc = (year, month, day) => {
    const target = Date.UTC(year, month - 1, day);
    let result = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = partsFor(new Date(result));
      const represented = Date.UTC(
        Number(parts.year),
        Number(parts.month) - 1,
        Number(parts.day),
        Number(parts.hour),
        Number(parts.minute),
        Number(parts.second),
      );
      result += target - represented;
    }
    return new Date(result);
  };
  const start = toUtc(Number(current.year), Number(current.month), Number(current.day));
  const nextDate = new Date(Date.UTC(Number(current.year), Number(current.month) - 1, Number(current.day) + 1));
  const end = toUtc(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate());
  return {
    start: start.toISOString().slice(0, 23).replace('T', ' '),
    end: end.toISOString().slice(0, 23).replace('T', ' '),
  };
}

function parseHours(hours) {
  if (!Array.isArray(hours) || hours.length > 7) validation('Opening hours must contain up to seven days.');
  const seen = new Set();
  for (const day of hours) {
    if (!day || !Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      validation('Each opening-hours entry needs a dayOfWeek from 0 to 6.');
    }
    if (seen.has(day.dayOfWeek)) validation('Opening hours may include each day only once.');
    seen.add(day.dayOfWeek);
    if (day.closed !== true && (
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.open)
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(day.close)
      || day.close <= day.open
    )) validation('Open days need valid 24-hour open and close times, with closing after opening.');
  }
  return hours;
}

function fitsOpeningHours(start, end, timezone, hours) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (date) => Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]));
  const startParts = parts(start);
  const endParts = parts(end);
  if (startParts.year !== endParts.year || startParts.month !== endParts.month || startParts.day !== endParts.day) return false;
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = hours.find((entry) => entry.dayOfWeek === weekdays[startParts.weekday]);
  return Boolean(day && day.closed !== true
    && `${startParts.hour}:${startParts.minute}` >= day.open
    && `${endParts.hour}:${endParts.minute}` <= day.close);
}

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > BODY_LIMIT_BYTES) throw new HttpError(413, 'Request body is too large.', 'body_too_large');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) validation('JSON body must be an object.');
    return body;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    validation('Request body must contain valid JSON.');
  }
}

function getSession(request, config) {
  const match = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  const session = match && verifyToken(match[1], config.jwtSecret);
  if (!session) throw new HttpError(401, 'Sign in to continue.', 'unauthorized');
  return session;
}

function createRateLimiter() {
  const entries = new Map();
  return (key) => {
    const now = Date.now();
    const current = entries.get(key);
    if (!current || current.expiresAt <= now) {
      entries.set(key, { count: 1, expiresAt: now + AUTH_WINDOW_MS });
      if (entries.size > 10000) {
        for (const [entryKey, entry] of entries) if (entry.expiresAt <= now) entries.delete(entryKey);
      }
      return;
    }
    current.count += 1;
    if (current.count > AUTH_MAX_REQUESTS) throw new HttpError(429, 'Too many authentication attempts. Try again later.', 'rate_limited');
  };
}

async function withBusiness(pool, session, callback) {
  return withMysqlTransaction(pool, async (connection) => {
    const [memberships] = await connection.execute(
      'SELECT role FROM business_memberships WHERE business_id=? AND user_id=?',
      [session.businessId, session.sub],
    );
    const role = memberships[0]?.role;
    if (!role) throw new HttpError(403, 'You do not have access to this business.', 'business_access_denied');
    return callback(connection, role);
  });
}

function mapAppointment(row) {
  return {
    ...row,
    starts_at: isoDate(row.starts_at),
    ends_at: isoDate(row.ends_at),
    customer_confirmed_at: isoDate(row.customer_confirmed_at),
    reminder_opt_in_at: isoDate(row.reminder_opt_in_at),
  };
}

function createMysqlApiHandler(config, pool, options = {}) {
  const logger = options.logger || {
    error: (event) => console.error(JSON.stringify(event)),
  };
  const rateLimit = createRateLimiter();

  return async function handle(request, response, url) {
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
      response.setHeader('access-control-allow-methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return true;
    }

    try {
      if (pathname === '/api/health' && request.method === 'GET') {
        await pool.query('SELECT 1');
        send(response, 200, { status: 'ok', api: 'ok', database: 'ok' });
        return true;
      }

      if (pathname === '/api/config/public' && request.method === 'GET') {
        send(response, 200, {
          metaEmbeddedSignupReady: false,
          metaAppId: null,
          embeddedSignupConfigId: null,
          graphApiVersion: null,
          signupVersion: 'v4',
          databaseDriver: 'mysql',
        });
        return true;
      }

      if (pathname === '/api/auth/register' && request.method === 'POST') {
        rateLimit(`register:${request.socket.remoteAddress || 'unknown'}`);
        if (config.nodeEnv === 'production') {
          throw new HttpError(503, 'Account creation is disabled until email verification is configured.', 'email_verification_unavailable');
        }
        const body = await readBody(request);
        const email = requiredString(body.email, 'Email', 254).toLowerCase();
        if (!EMAIL_PATTERN.test(email)) validation('Enter a valid email address.');
        if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 128) {
          validation('Password must contain between 12 and 128 characters.');
        }
        const businessName = requiredString(body.businessName, 'Business name', 120);
        const category = typeof body.category === 'string' ? body.category.trim().slice(0, 100) : '';
        const userId = randomUUID();
        const businessId = randomUUID();
        const passwordHash = await hashPassword(body.password);
        await withMysqlTransaction(pool, async (connection) => {
          await connection.execute(
            'INSERT INTO app_users(id,email,password_hash,email_verified_at) VALUES(?,?,?,CURRENT_TIMESTAMP(3))',
            [userId, email, passwordHash],
          );
          await connection.execute(
            `INSERT INTO businesses(id,name,category,opening_hours,policies)
             VALUES(?,?,?,'[]','{}')`,
            [businessId, businessName, category],
          );
          await connection.execute(
            'INSERT INTO business_memberships(business_id,user_id,role) VALUES(?,?,?)',
            [businessId, userId, 'owner'],
          );
        });
        const accessToken = signToken({ sub: userId, businessId }, config.jwtSecret);
        send(response, 201, {
          accessToken,
          expiresIn: 3600,
          user: { id: userId, email },
          business: { id: businessId, name: businessName },
        });
        return true;
      }

      if (pathname === '/api/auth/login' && request.method === 'POST') {
        rateLimit(`login:${request.socket.remoteAddress || 'unknown'}`);
        const body = await readBody(request);
        const email = requiredString(body.email, 'Email', 254).toLowerCase();
        const [users] = await pool.execute(
          `SELECT id,email,password_hash FROM app_users
           WHERE email=? AND deleted_at IS NULL AND email_verified_at IS NOT NULL`,
          [email],
        );
        const user = users[0];
        if (!user || !await verifyPassword(typeof body.password === 'string' ? body.password : '', user.password_hash)) {
          throw new HttpError(401, 'Email or password is incorrect.', 'invalid_credentials');
        }
        const [memberships] = await pool.execute(
          `SELECT b.id,b.name FROM business_memberships m
           JOIN businesses b ON b.id=m.business_id WHERE m.user_id=?
           ORDER BY m.created_at LIMIT 1`,
          [user.id],
        );
        const business = memberships[0];
        if (!business) throw new HttpError(403, 'No active business is linked to this account.', 'business_missing');
        send(response, 200, {
          accessToken: signToken({ sub: user.id, businessId: business.id }, config.jwtSecret),
          expiresIn: 3600,
          user: { id: user.id, email: user.email },
          business: { id: business.id, name: business.name },
        });
        return true;
      }

      const session = getSession(request, config);

      if (pathname === '/api/me' && request.method === 'GET') {
        const result = await withBusiness(pool, session, async (connection) => {
          const [users] = await connection.execute(
            'SELECT id,email,email_verified_at FROM app_users WHERE id=? AND deleted_at IS NULL',
            [session.sub],
          );
          const [businesses] = await connection.execute(
            'SELECT id,name,category FROM businesses WHERE id=?',
            [session.businessId],
          );
          if (!users[0] || !businesses[0]) throw new HttpError(401, 'Account is no longer available.', 'account_deleted');
          return { user: users[0], business: businesses[0] };
        });
        send(response, 200, result);
        return true;
      }

      if (pathname === '/api/business' && request.method === 'GET') {
        const [rows] = await withBusiness(pool, session, (connection) => connection.execute(
          `SELECT id,name,category,address,timezone,language,owner_name,owner_phone,
           owner_whatsapp_opt_in,opening_hours,policies,human_handoff_enabled
           FROM businesses WHERE id=?`,
          [session.businessId],
        ));
        const business = rows[0];
        if (business) {
          business.opening_hours = jsonValue(business.opening_hours, []);
          business.policies = jsonValue(business.policies, {});
        }
        send(response, 200, { business: business || null });
        return true;
      }

      if (pathname === '/api/business' && request.method === 'PUT') {
        const body = await readBody(request);
        const name = requiredString(body.name, 'Business name', 120);
        const category = typeof body.category === 'string' ? body.category.trim().slice(0, 100) : '';
        const address = typeof body.address === 'string' ? body.address.trim().slice(0, 300) : '';
        const timezone = body.timezone === undefined ? 'Asia/Karachi' : requiredString(body.timezone, 'Timezone', 100);
        try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { validation('Timezone must be a valid IANA timezone.'); }
        if (body.language !== undefined && !['en', 'ur', 'roman'].includes(body.language)) validation('Language must be en, ur, or roman.');
        const hours = parseHours(body.openingHours === undefined ? [] : body.openingHours);
        const policies = objectJson(body.policies, {}, 'Policies');
        const ownerName = typeof body.ownerName === 'string' ? body.ownerName.trim().slice(0, 120) : '';
        const ownerPhone = body.ownerPhone ? phoneNumber(body.ownerPhone, 'Owner phone') : '';
        const language = body.language === undefined ? 'roman' : body.language;
        const result = await withBusiness(pool, session, async (connection, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may edit its profile.', 'insufficient_role');
          await connection.execute(
            `UPDATE businesses SET name=?,category=?,address=?,timezone=?,language=?,owner_name=?,
             owner_phone=?,owner_whatsapp_opt_in=?,opening_hours=?,policies=? WHERE id=?`,
            [name, category, address, timezone, language, ownerName, ownerPhone, body.ownerWhatsappOptIn === true, JSON.stringify(hours), JSON.stringify(policies), session.businessId],
          );
          await connection.execute('DELETE FROM business_hours WHERE business_id=?', [session.businessId]);
          for (const day of hours) {
            await connection.execute(
              `INSERT INTO business_hours(business_id,day_of_week,is_closed,opens_at,closes_at)
               VALUES(?,?,?,?,?)`,
              [session.businessId, day.dayOfWeek, day.closed === true, day.closed === true ? null : `${day.open}:00`, day.closed === true ? null : `${day.close}:00`],
            );
          }
          const [updated] = await connection.execute(
            `SELECT id,name,category,address,timezone,language,owner_name,owner_phone,
             owner_whatsapp_opt_in,opening_hours,policies,human_handoff_enabled
             FROM businesses WHERE id=?`,
            [session.businessId],
          );
          updated[0].opening_hours = hours;
          updated[0].policies = policies;
          return updated[0];
        });
        send(response, 200, { business: result });
        return true;
      }

      if (pathname === '/api/services' && request.method === 'GET') {
        const [services] = await withBusiness(pool, session, (connection) => connection.execute(
          `SELECT s.id,s.name,s.description,p.price_minor,s.currency,s.duration_minutes,s.active
           FROM services s LEFT JOIN service_prices p
           ON p.business_id=s.business_id AND p.service_id=s.id
           WHERE s.business_id=? ORDER BY s.name`,
          [session.businessId],
        ));
        send(response, 200, { services });
        return true;
      }

      if (pathname === '/api/services' && request.method === 'POST') {
        const body = await readBody(request);
        const name = requiredString(body.name, 'Service name', 120);
        const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '';
        const priceMinor = body.priceMinor === null || body.priceMinor === undefined ? null : Number(body.priceMinor);
        if (priceMinor !== null && (!Number.isSafeInteger(priceMinor) || priceMinor < 0)) validation('Service price must be a non-negative integer in minor currency units.');
        const duration = Number(body.durationMinutes);
        if (!Number.isInteger(duration) || duration < 5 || duration > 1440) validation('Service duration must be 5 to 1440 minutes.');
        const currency = body.currency === undefined ? 'PKR' : body.currency;
        if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) validation('Currency must be a three-letter uppercase ISO code.');
        const service = await withBusiness(pool, session, async (connection, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may edit services.', 'insufficient_role');
          const id = randomUUID();
          await connection.execute(
            'INSERT INTO services(id,business_id,name,description,currency,duration_minutes) VALUES(?,?,?,?,?,?)',
            [id, session.businessId, name, description, currency, duration],
          );
          await connection.execute(
            'INSERT INTO service_prices(id,business_id,service_id,price_minor) VALUES(?,?,?,?)',
            [randomUUID(), session.businessId, id, priceMinor],
          );
          return { id, name, description, price_minor: priceMinor, currency, duration_minutes: duration, active: 1 };
        });
        send(response, 201, { service });
        return true;
      }

      const serviceMatch = pathname.match(/^\/api\/services\/([0-9a-f-]{36})$/i);
      if (serviceMatch && request.method === 'DELETE') {
        const changed = await withBusiness(pool, session, async (connection, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may edit services.', 'insufficient_role');
          const [result] = await connection.execute(
            'UPDATE services SET active=FALSE WHERE id=? AND business_id=? AND active=TRUE',
            [serviceMatch[1], session.businessId],
          );
          return result.affectedRows;
        });
        if (!changed) throw new HttpError(404, 'Service was not found.', 'not_found');
        send(response, 200, { status: 'deactivated' });
        return true;
      }

      if (pathname === '/api/faqs' && request.method === 'GET') {
        const [faqs] = await withBusiness(pool, session, (connection) => connection.execute(
          'SELECT id,question,answer,verified_at FROM business_faqs WHERE business_id=? ORDER BY created_at',
          [session.businessId],
        ));
        send(response, 200, { faqs: faqs.map((faq) => ({ ...faq, verified_at: isoDate(faq.verified_at) })) });
        return true;
      }

      if (pathname === '/api/faqs' && request.method === 'POST') {
        const body = await readBody(request);
        const question = requiredString(body.question, 'FAQ question', 500);
        const answer = requiredString(body.answer, 'FAQ answer', 2000);
        const faq = await withBusiness(pool, session, async (connection, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may edit FAQs.', 'insufficient_role');
          const entry = { id: randomUUID(), question, answer, verified_at: new Date().toISOString() };
          await connection.execute(
            'INSERT INTO business_faqs(id,business_id,question,answer,verified_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP(3))',
            [entry.id, session.businessId, question, answer],
          );
          return entry;
        });
        send(response, 201, { faq });
        return true;
      }

      if (pathname === '/api/whatsapp/connection' && request.method === 'GET') {
        await withBusiness(pool, session, async () => null);
        send(response, 200, { connection: { status: 'not_connected', integrationConfigured: false } });
        return true;
      }

      if (pathname === '/api/dashboard' && request.method === 'GET') {
        const dashboard = await withBusiness(pool, session, async (connection) => {
          const [businesses] = await connection.execute('SELECT name,timezone FROM businesses WHERE id=?', [session.businessId]);
          if (!businesses[0]) throw new HttpError(404, 'Business not found.', 'business_not_found');
          const day = localDayBounds(businesses[0].timezone);
          const [counts] = await connection.execute(
            `SELECT
              (SELECT COUNT(*) FROM appointments a WHERE a.business_id=? AND a.starts_at>=? AND a.starts_at<? AND a.status='confirmed') AS confirmed_today,
              (SELECT COUNT(*) FROM appointments a WHERE a.business_id=? AND a.starts_at>=? AND a.starts_at<? AND a.status='pending_confirmation') AS pending_today,
              (SELECT COUNT(*) FROM customers c WHERE c.business_id=?) AS customer_count,
              (SELECT COUNT(*) FROM conversations c WHERE c.business_id=? AND c.state='needs_owner') AS needs_reply_count`,
            [session.businessId, day.start, day.end, session.businessId, day.start, day.end, session.businessId, session.businessId],
          );
          const [appointments] = await connection.execute(
            `SELECT a.id,a.customer_id,a.service_name,a.price_minor,a.starts_at,a.ends_at,a.status,
              a.staff_key,c.display_name AS customer_name
             FROM appointments a JOIN customers c ON c.business_id=a.business_id AND c.id=a.customer_id
             WHERE a.business_id=? AND a.starts_at>=? AND a.starts_at<?
             ORDER BY a.starts_at LIMIT 50`,
            [session.businessId, day.start, day.end],
          );
          return {
            ...(counts[0] || {}),
            appointments: appointments.map(mapAppointment),
            business: { name: businesses[0].name },
          };
        });
        send(response, 200, { dashboard });
        return true;
      }

      if (pathname === '/api/customers' && request.method === 'GET') {
        const [customers] = await withBusiness(pool, session, (connection) => connection.execute(
          `SELECT c.id,c.display_name,c.phone_number,c.notes,c.tags,c.created_at,
            COUNT(a.id) AS visits,COALESCE(SUM(CASE WHEN a.status IN ('confirmed','completed') THEN a.price_minor ELSE 0 END),0) AS spent_minor,
            MAX(a.starts_at) AS last_visit
           FROM customers c LEFT JOIN appointments a ON a.business_id=c.business_id AND a.customer_id=c.id
           WHERE c.business_id=? GROUP BY c.id ORDER BY c.display_name LIMIT 500`,
          [session.businessId],
        ));
        send(response, 200, { customers: customers.map((customer) => ({
          ...customer,
          tags: jsonValue(customer.tags, []),
          last_visit: isoDate(customer.last_visit),
          created_at: isoDate(customer.created_at),
        })) });
        return true;
      }

      const customerMatch = pathname.match(/^\/api\/customers\/([0-9a-f-]{36})$/i);
      if (customerMatch && request.method === 'GET') {
        const customer = await withBusiness(pool, session, async (connection) => {
          const [rows] = await connection.execute(
            `SELECT c.id,c.display_name,c.phone_number,c.notes,c.tags,c.created_at,
              COUNT(a.id) AS visits,COALESCE(SUM(CASE WHEN a.status IN ('confirmed','completed') THEN a.price_minor ELSE 0 END),0) AS spent_minor,
              MAX(a.starts_at) AS last_visit
             FROM customers c LEFT JOIN appointments a ON a.business_id=c.business_id AND a.customer_id=c.id
             WHERE c.business_id=? AND c.id=? GROUP BY c.id`,
            [session.businessId, customerMatch[1]],
          );
          if (!rows[0]) throw new HttpError(404, 'Customer not found.', 'customer_not_found');
          const [appointments] = await connection.execute(
            `SELECT id,service_name,price_minor,starts_at,ends_at,status FROM appointments
             WHERE business_id=? AND customer_id=? ORDER BY starts_at DESC LIMIT 100`,
            [session.businessId, customerMatch[1]],
          );
          const profile = rows[0];
          profile.tags = jsonValue(profile.tags, []);
          profile.last_visit = isoDate(profile.last_visit);
          return { customer: profile, bookings: appointments.map(mapAppointment) };
        });
        send(response, 200, customer);
        return true;
      }

      if (customerMatch && request.method === 'PUT') {
        const body = await readBody(request);
        const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 5000) : '';
        if (body.tags !== undefined && (!Array.isArray(body.tags) || body.tags.length > 20
          || body.tags.some((tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 32))) {
          validation('Customer tags must contain up to 20 labels of 1 to 32 characters.');
        }
        const tags = (body.tags || []).map((tag) => tag.trim());
        const changed = await withBusiness(pool, session, async (connection, role) => {
          if (!['owner', 'manager', 'staff'].includes(role)) throw new HttpError(403, 'You do not have permission to edit customers.', 'insufficient_role');
          const [result] = await connection.execute(
            'UPDATE customers SET notes=?,tags=?,updated_at=CURRENT_TIMESTAMP(3) WHERE business_id=? AND id=?',
            [notes, JSON.stringify(tags), session.businessId, customerMatch[1]],
          );
          return result.affectedRows;
        });
        if (!changed) throw new HttpError(404, 'Customer not found.', 'customer_not_found');
        send(response, 200, { customer: { id: customerMatch[1], notes, tags } });
        return true;
      }

      if (pathname === '/api/conversations' && request.method === 'GET') {
        const [conversations] = await withBusiness(pool, session, (connection) => connection.execute(
          `SELECT c.id,c.customer_id,c.state,c.last_message_at,cu.display_name,cu.phone_number,
            (SELECT m.body FROM messages m WHERE m.business_id=c.business_id AND m.conversation_id=c.id
             ORDER BY m.created_at DESC LIMIT 1) AS last_message
           FROM conversations c JOIN customers cu ON cu.business_id=c.business_id AND cu.id=c.customer_id
           WHERE c.business_id=? ORDER BY c.last_message_at DESC LIMIT 100`,
          [session.businessId],
        ));
        send(response, 200, { conversations: conversations.map((row) => ({ ...row, last_message_at: isoDate(row.last_message_at) })) });
        return true;
      }

      const conversationMatch = pathname.match(/^\/api\/conversations\/([0-9a-f-]{36})(?:\/messages)?$/i);
      if (conversationMatch && pathname.endsWith('/messages') && request.method === 'GET') {
        const [messages] = await withBusiness(pool, session, async (connection) => {
          const [owned] = await connection.execute(
            'SELECT id FROM conversations WHERE business_id=? AND id=?',
            [session.businessId, conversationMatch[1]],
          );
          if (!owned.length) throw new HttpError(404, 'Conversation not found.', 'conversation_not_found');
          return connection.execute(
            `SELECT id,direction,sender,body,delivery_status,error_code,created_at
             FROM messages WHERE business_id=? AND conversation_id=?
             ORDER BY created_at DESC LIMIT 200`,
            [session.businessId, conversationMatch[1]],
          );
        });
        send(response, 200, { messages: messages.reverse().map((message) => ({ ...message, created_at: isoDate(message.created_at) })) });
        return true;
      }

      if (conversationMatch && !pathname.endsWith('/messages') && request.method === 'PATCH') {
        const body = await readBody(request);
        if (!['ai', 'owner_handling', 'closed'].includes(body.state)) validation('Conversation state must be ai, owner_handling, or closed.');
        const conversation = await withBusiness(pool, session, async (connection, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may update conversations.', 'insufficient_role');
          const [result] = await connection.execute(
            'UPDATE conversations SET state=?,updated_at=CURRENT_TIMESTAMP(3) WHERE business_id=? AND id=?',
            [body.state, session.businessId, conversationMatch[1]],
          );
          if (!result.affectedRows) return null;
          return { id: conversationMatch[1], state: body.state };
        });
        if (!conversation) throw new HttpError(404, 'Conversation not found.', 'conversation_not_found');
        send(response, 200, { conversation });
        return true;
      }

      if (pathname === '/api/bookings' && request.method === 'GET') {
        const [bookings] = await withBusiness(pool, session, (connection) => connection.execute(
          `SELECT a.id,a.customer_id,a.service_id,a.service_name,a.price_minor,a.staff_key,a.starts_at,a.ends_at,
            a.timezone,a.status,a.customer_confirmed_at,c.display_name AS customer_name,c.phone_number
           FROM appointments a JOIN customers c ON c.business_id=a.business_id AND c.id=a.customer_id
           WHERE a.business_id=? ORDER BY a.starts_at LIMIT 500`,
          [session.businessId],
        ));
        send(response, 200, { bookings: bookings.map(mapAppointment) });
        return true;
      }

      if (pathname === '/api/bookings' && request.method === 'POST') {
        const body = await readBody(request);
        const customerPhone = phoneNumber(body.customerPhone, 'Customer phone');
        const customerName = requiredString(body.customerName, 'Customer name', 120);
        const serviceId = requiredString(body.serviceId, 'Service ID', 36);
        if (!UUID_PATTERN.test(serviceId)) validation('Service ID must be a valid UUID.');
        if (typeof body.startsAt !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(body.startsAt)) validation('Appointment time must include an explicit timezone offset.');
        const startsAt = new Date(body.startsAt);
        if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) validation('Appointment time must be a future ISO date/time.');
        if (body.customerConfirmed !== true) validation('The customer must confirm the selected appointment before it is saved.');
        const staffKey = typeof body.staffKey === 'string' && body.staffKey.trim() ? body.staffKey.trim().slice(0, 100) : 'default';
        const appointment = await withBusiness(pool, session, async (connection) => {
          await connection.execute('SELECT id FROM businesses WHERE id=? FOR UPDATE', [session.businessId]);
          const [services] = await connection.execute(
            `SELECT s.id,s.name,s.duration_minutes,p.price_minor FROM services s
             LEFT JOIN service_prices p ON p.business_id=s.business_id AND p.service_id=s.id
             WHERE s.business_id=? AND s.id=? AND s.active=TRUE`,
            [session.businessId, serviceId],
          );
          const service = services[0];
          if (!service) throw new HttpError(404, 'Service was not found for this business.', 'service_not_found');
          const [businessRows] = await connection.execute(
            'SELECT timezone,opening_hours FROM businesses WHERE id=?',
            [session.businessId],
          );
          const business = businessRows[0];
          const hours = jsonValue(business.opening_hours, []);
          const endsAt = new Date(startsAt.getTime() + Number(service.duration_minutes) * 60000);
          if (!fitsOpeningHours(startsAt, endsAt, business.timezone, hours)) {
            throw new HttpError(409, 'This service does not fit within the business opening hours.', 'outside_opening_hours');
          }
          const startsSql = startsAt.toISOString().slice(0, 23).replace('T', ' ');
          const endsSql = endsAt.toISOString().slice(0, 23).replace('T', ' ');
          const [conflicts] = await connection.execute(
            `SELECT id FROM appointments WHERE business_id=? AND staff_key=? AND status='confirmed'
             AND starts_at < ? AND ends_at > ? LIMIT 1`,
            [session.businessId, staffKey, endsSql, startsSql],
          );
          if (conflicts.length) throw new HttpError(409, 'This staff member is no longer available at that time.', 'booking_conflict');
          const [existingCustomers] = await connection.execute(
            'SELECT id FROM customers WHERE business_id=? AND whatsapp_user_id=?',
            [session.businessId, customerPhone],
          );
          const customerId = existingCustomers[0]?.id || randomUUID();
          if (existingCustomers.length) {
            await connection.execute(
              'UPDATE customers SET display_name=?,phone_number=? WHERE business_id=? AND id=?',
              [customerName, customerPhone, session.businessId, customerId],
            );
          } else {
            await connection.execute(
              `INSERT INTO customers(id,business_id,whatsapp_user_id,display_name,phone_number,notes,tags)
               VALUES(?,?,?,?,?,'','[]')`,
              [customerId, session.businessId, customerPhone, customerName, customerPhone],
            );
          }
          const id = randomUUID();
          const reminderOptIn = body.reminderOptIn === true;
          await connection.execute(
            `INSERT INTO appointments(id,business_id,customer_id,service_id,service_name,price_minor,staff_key,
             starts_at,ends_at,timezone,status,customer_confirmed_at,reminder_opt_in_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,'confirmed',CURRENT_TIMESTAMP(3),IF(?,CURRENT_TIMESTAMP(3),NULL))`,
            [id, session.businessId, customerId, service.id, service.name, service.price_minor, staffKey, startsSql, endsSql, business.timezone, reminderOptIn],
          );
          return {
            id, customer_id: customerId, customer_name: customerName, phone_number: customerPhone,
            service_id: service.id, service_name: service.name, price_minor: service.price_minor,
            staff_key: staffKey, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(),
            timezone: business.timezone, status: 'confirmed', customer_confirmed_at: new Date().toISOString(),
          };
        });
        send(response, 201, { booking: appointment });
        return true;
      }

      const bookingMatch = pathname.match(/^\/api\/bookings\/([0-9a-f-]{36})$/i);
      if (bookingMatch && request.method === 'PATCH') {
        const body = await readBody(request);
        if (!['confirmed', 'cancelled', 'completed'].includes(body.status)) validation('Booking status must be confirmed, cancelled, or completed.');
        const updated = await withBusiness(pool, session, async (connection, role) => {
          if (!['owner', 'manager'].includes(role)) throw new HttpError(403, 'Only a business owner or manager may update bookings.', 'insufficient_role');
          if (body.status === 'confirmed') {
            await connection.execute('SELECT id FROM businesses WHERE id=? FOR UPDATE', [session.businessId]);
            const [appointments] = await connection.execute(
              `SELECT staff_key,starts_at,ends_at FROM appointments
               WHERE business_id=? AND id=? AND status='pending_confirmation'`,
              [session.businessId, bookingMatch[1]],
            );
            if (!appointments.length) throw new HttpError(404, 'Pending booking not found.', 'booking_not_found');
            const [conflicts] = await connection.execute(
              `SELECT id FROM appointments WHERE business_id=? AND id<>? AND staff_key=?
               AND status='confirmed' AND starts_at < ? AND ends_at > ? LIMIT 1`,
              [session.businessId, bookingMatch[1], appointments[0].staff_key, appointments[0].ends_at, appointments[0].starts_at],
            );
            if (conflicts.length) throw new HttpError(409, 'This staff member is no longer available at that time.', 'booking_conflict');
          }
          const [result] = await connection.execute(
            `UPDATE appointments SET status=?,customer_confirmed_at=IF(?='confirmed',CURRENT_TIMESTAMP(3),customer_confirmed_at)
             WHERE business_id=? AND id=? AND status IN ('pending_confirmation','confirmed')`,
            [body.status, body.status, session.businessId, bookingMatch[1]],
          );
          if (body.status === 'cancelled') {
            await connection.execute(
              `UPDATE reminder_jobs SET status='cancelled'
               WHERE business_id=? AND appointment_id=? AND status IN ('pending','processing')`,
              [session.businessId, bookingMatch[1]],
            );
          }
          return result.affectedRows;
        });
        if (!updated) throw new HttpError(404, 'Confirmed booking not found.', 'booking_not_found');
        send(response, 200, { booking: { id: bookingMatch[1], status: body.status } });
        return true;
      }

      if (pathname === '/api/account' && request.method === 'DELETE') {
        const body = await readBody(request);
        if (body.confirmation !== 'DELETE MY ACCOUNT') validation('Type DELETE MY ACCOUNT to confirm account deletion.');
        const [users] = await pool.execute(
          'SELECT password_hash FROM app_users WHERE id=? AND deleted_at IS NULL',
          [session.sub],
        );
        if (!users[0] || !await verifyPassword(typeof body.password === 'string' ? body.password : '', users[0].password_hash)) {
          throw new HttpError(403, 'Password confirmation failed.', 'reauthentication_failed');
        }
        await withMysqlTransaction(pool, async (connection) => {
          const [owned] = await connection.execute(
            'SELECT business_id FROM business_memberships WHERE user_id=? AND role=?',
            [session.sub, 'owner'],
          );
          if (!owned.some((row) => row.business_id === session.businessId)) {
            throw new HttpError(403, 'Only a business owner can delete this account.', 'insufficient_role');
          }
          const [sharedBusinesses] = await connection.execute(
            `SELECT membership.business_id
             FROM business_memberships membership
             WHERE membership.user_id <> ?
               AND membership.business_id IN (
                 SELECT business_id FROM business_memberships WHERE user_id=?
               )
             LIMIT 1`,
            [session.sub, session.sub],
          );
          if (sharedBusinesses.length) {
            throw new HttpError(
              409,
              'This account still shares a business with other team members. Transfer ownership or remove team access before deleting it.',
              'business_has_members',
            );
          }
          await connection.execute(
            `DELETE FROM businesses WHERE id IN
             (SELECT business_id FROM business_memberships WHERE user_id=? AND role='owner')`,
            [session.sub],
          );
          await connection.execute('DELETE FROM business_memberships WHERE user_id=?', [session.sub]);
          await connection.execute(
            `UPDATE app_users SET deleted_at=CURRENT_TIMESTAMP(3),
             email=CONCAT(id,'@deleted.invalid'),password_hash='' WHERE id=?`,
            [session.sub],
          );
        });
        send(response, 200, { status: 'deleted' });
        return true;
      }

      send(response, 404, { error: 'API endpoint not found.' });
      return true;
    } catch (error) {
      if (pathname === '/api/health') {
        logger.error({ event: 'database_health_check_failed', errorCode: error?.code || null });
        send(response, 503, { status: 'unavailable', api: 'ok', database: 'unavailable' });
        return true;
      }
      const duplicateRegistration = error?.code === 'ER_DUP_ENTRY' && pathname === '/api/auth/register';
      const status = error instanceof HttpError ? error.status : duplicateRegistration ? 409 : 500;
      if (status >= 500) {
        logger.error({ event: 'mysql_api_request_failed', path: pathname, status, errorCode: error?.code || null });
      }
      send(response, status, {
        error: error instanceof HttpError
          ? error.message
          : duplicateRegistration
            ? 'An account with this email already exists.'
            : status === 409
              ? 'This staff member is no longer available at that time.'
              : 'The request could not be completed.',
        ...(error instanceof HttpError && error.code
          ? { code: error.code }
          : duplicateRegistration
            ? { code: 'account_exists' }
            : status === 409
              ? { code: 'booking_conflict' }
              : {}),
      });
      return true;
    }
  };
}

function createMysqlServer(config, pool, options = {}) {
  const logger = options.logger || { error: (event) => console.error(JSON.stringify(event)) };
  const handle = createMysqlApiHandler(config, pool, { logger });
  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname === '/api/health' && request.method === 'GET') {
      await handle(request, response, url);
      return;
    }
    const handled = await handle(request, response, url);
    if (!handled) send(response, 404, { error: 'Not found.' });
  });
}

module.exports = { HttpError, createMysqlApiHandler, createMysqlServer };
