const REQUIRED_VARIABLES = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_BUSINESS_ACCOUNT_ID',
  'WHATSAPP_VERIFY_TOKEN',
  'META_APP_SECRET',
  'WHATSAPP_API_VERSION',
  'WHATSAPP_TEST_RECIPIENTS',
];

const PRODUCTION_REQUIRED_VARIABLES = ['DATABASE_URL', 'JWT_SECRET', 'ENCRYPTION_KEY'];

function readConfig(env = process.env) {
  const missing = REQUIRED_VARIABLES.filter((name) => !String(env[name] || '').trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const recipients = String(env.WHATSAPP_TEST_RECIPIENTS)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (recipients.some((value) => !/^\d{8,15}$/.test(value))) {
    throw new Error('WHATSAPP_TEST_RECIPIENTS must contain comma-separated phone numbers in digits-only international format.');
  }
  if (!/^\d+$/.test(String(env.WHATSAPP_PHONE_NUMBER_ID).trim())) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID must contain digits only.');
  }
  if (!/^\d+$/.test(String(env.WHATSAPP_BUSINESS_ACCOUNT_ID).trim())) {
    throw new Error('WHATSAPP_BUSINESS_ACCOUNT_ID must contain digits only.');
  }
  if (!/^v\d+\.\d+$/.test(String(env.WHATSAPP_API_VERSION).trim())) {
    throw new Error('WHATSAPP_API_VERSION must use Meta version format, for example vXX.X.');
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }

  const verifyToken = String(env.WHATSAPP_VERIFY_TOKEN).trim();
  if (Buffer.byteLength(verifyToken, 'utf8') < 32) {
    throw new Error('WHATSAPP_VERIFY_TOKEN must be at least 32 bytes; generate a random token locally.');
  }

  const autoReplyText = String(env.WHATSAPP_AUTO_REPLY_TEXT || 'Thanks for your message. A business owner will reply soon.').trim();
  if (!autoReplyText || autoReplyText.length > 1000) {
    throw new Error('WHATSAPP_AUTO_REPLY_TEXT must contain between 1 and 1000 characters.');
  }

  return Object.freeze({
    accessToken: String(env.WHATSAPP_ACCESS_TOKEN).trim(),
    phoneNumberId: String(env.WHATSAPP_PHONE_NUMBER_ID).trim(),
    businessAccountId: String(env.WHATSAPP_BUSINESS_ACCOUNT_ID).trim(),
    verifyToken,
    appSecret: String(env.META_APP_SECRET).trim(),
    apiVersion: String(env.WHATSAPP_API_VERSION).trim(),
    allowedRecipients: new Set(recipients),
    autoReplyText,
    port,
  });
}

function readProductionConfig(env = process.env) {
  const missing = PRODUCTION_REQUIRED_VARIABLES.filter((name) => !String(env[name] || '').trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`);

  const jwtSecret = String(env.JWT_SECRET).trim();
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be at least 32 bytes. Generate a random secret locally.');
  }

  let encryptionKey;
  try {
    encryptionKey = Buffer.from(String(env.ENCRYPTION_KEY).trim(), 'base64');
  } catch {
    encryptionKey = Buffer.alloc(0);
  }
  if (encryptionKey.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte value.');
  }

  let databaseUrl;
  try {
    databaseUrl = new URL(String(env.DATABASE_URL).trim());
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
    throw new Error('DATABASE_URL must use PostgreSQL.');
  }

  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be a valid TCP port.');
  }

  const metaAppId = String(env.META_APP_ID || '').trim();
  const metaAppSecret = String(env.META_APP_SECRET || '').trim();
  const embeddedSignupConfigId = String(env.META_EMBEDDED_SIGNUP_CONFIG_ID || '').trim();
  const verifyToken = String(env.WHATSAPP_VERIFY_TOKEN || '').trim();
  const apiVersion = String(env.WHATSAPP_API_VERSION || '').trim();
  const metaValues = [metaAppId, metaAppSecret, embeddedSignupConfigId, verifyToken, apiVersion];
  if (metaValues.some(Boolean) && !metaValues.every(Boolean)) {
    throw new Error('Configure META_APP_ID, META_APP_SECRET, META_EMBEDDED_SIGNUP_CONFIG_ID, WHATSAPP_VERIFY_TOKEN, and WHATSAPP_API_VERSION together.');
  }
  if (apiVersion && !/^v\d+\.\d+$/.test(apiVersion)) {
    throw new Error('WHATSAPP_API_VERSION must use Meta version format, for example vXX.X.');
  }
  if (verifyToken && Buffer.byteLength(verifyToken, 'utf8') < 32) {
    throw new Error('WHATSAPP_VERIFY_TOKEN must be at least 32 bytes.');
  }

  const anthropicApiKey = String(env.ANTHROPIC_API_KEY || '').trim();
  const anthropicModel = String(env.ANTHROPIC_MODEL || '').trim();
  if (anthropicApiKey && !anthropicModel) {
    throw new Error('Set ANTHROPIC_MODEL to a currently supported model when ANTHROPIC_API_KEY is configured.');
  }

  const customerReminderTemplate = String(env.WHATSAPP_CUSTOMER_REMINDER_TEMPLATE || '').trim();
  const ownerReminderTemplate = String(env.WHATSAPP_OWNER_REMINDER_TEMPLATE || '').trim();
  const reminderTemplateLanguage = String(env.WHATSAPP_TEMPLATE_LANGUAGE || 'en').trim();
  if ((customerReminderTemplate || ownerReminderTemplate) && !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(reminderTemplateLanguage)) {
    throw new Error('WHATSAPP_TEMPLATE_LANGUAGE must be a locale such as en or en_US.');
  }

  const publicBaseUrl = String(env.PUBLIC_BASE_URL || '').trim();
  if (publicBaseUrl) {
    let publicUrl;
    try { publicUrl = new URL(publicBaseUrl); } catch { throw new Error('PUBLIC_BASE_URL must be a valid HTTPS URL.'); }
    if (env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:') {
      throw new Error('PUBLIC_BASE_URL must use HTTPS in production.');
    }
  }

  const origins = String(env.CORS_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of origins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('Every CORS_ORIGINS entry must be an origin URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('CORS_ORIGINS entries must be plain HTTP(S) origins without a path.');
    }
    if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
      throw new Error('CORS_ORIGINS must use HTTPS in production.');
    }
  }

  return Object.freeze({
    databaseUrl: String(env.DATABASE_URL).trim(),
    databaseSsl: String(env.DATABASE_SSL || '').trim().toLowerCase() === 'true',
    jwtSecret,
    encryptionKey,
    port,
    nodeEnv: String(env.NODE_ENV || 'production'),
    publicBaseUrl,
    corsOrigins: origins,
    metaAppId,
    metaAppSecret,
    appSecret: metaAppSecret,
    embeddedSignupConfigId,
    verifyToken,
    apiVersion,
    anthropicApiKey,
    anthropicModel,
    customerReminderTemplate,
    ownerReminderTemplate,
    reminderTemplateLanguage,
    emailVerificationConfigured: false,
  });
}

module.exports = { readConfig, readProductionConfig };
