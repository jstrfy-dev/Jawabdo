const { createHmac, timingSafeEqual } = require('node:crypto');
const { createServer } = require('node:http');

const BODY_LIMIT_BYTES = 1024 * 1024;
const DEDUPE_RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_DEDUPE_ENTRIES = 10000;
const GRAPH_TIMEOUT_MS = 10000;

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

function matchesSecret(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
  const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function isValidSignature(rawBody, signature, appSecret) {
  if (typeof signature !== 'string' || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  const actualBuffer = Buffer.from(signature, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    request.once('end', () => {
      if (tooLarge) {
        const error = new Error('Request body is too large.');
        error.statusCode = 413;
        reject(error);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    request.once('error', reject);
    request.once('aborted', () => {
      const error = new Error('Request body was interrupted.');
      error.statusCode = 400;
      reject(error);
    });
  });
}

function normalizePhone(value) {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function createWhatsAppServer(config, options = {}) {
  const logger = options.logger || {
    info: (event) => console.info(JSON.stringify(event)),
    error: (event) => console.error(JSON.stringify(event)),
  };
  const fetchImpl = options.fetch || globalThis.fetch;
  const processedMessages = new Map();
  const apiHandler = options.apiHandler;

  if (typeof fetchImpl !== 'function') {
    throw new Error('A Fetch API implementation is required.');
  }

  const log = (level, event) => {
    logger[level]({ event, time: new Date().toISOString() });
  };

  async function sendTextMessage(recipient, text) {
    const endpoint = `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`;
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: recipient,
          type: 'text',
          text: { preview_url: false, body: text },
        }),
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      });
    } catch {
      log('error', 'graph_api_request_failed');
      throw new Error('WhatsApp message could not be sent.');
    }

    if (!response.ok) {
      log('error', 'graph_api_rejected_message');
      throw new Error('WhatsApp message could not be sent.');
    }
  }

  function pruneProcessedMessages() {
    const expiry = Date.now() - DEDUPE_RETENTION_MS;
    for (const [id, entry] of processedMessages) {
      if (entry.completed && entry.createdAt < expiry) processedMessages.delete(id);
    }
    while (processedMessages.size > MAX_DEDUPE_ENTRIES) {
      const completedId = Array.from(processedMessages).find(([, entry]) => entry.completed)?.[0];
      if (!completedId) break;
      processedMessages.delete(completedId);
    }
  }

  async function processMessage(message) {
    if (!message || typeof message.id !== 'string' || !message.id) {
      log('info', 'invalid_incoming_message_ignored');
      return;
    }

    const existing = processedMessages.get(message.id);
    if (existing) {
      log('info', 'duplicate_message_ignored');
      await existing.promise;
      return;
    }

    const entry = { createdAt: Date.now(), completed: false, promise: null };
    entry.promise = (async () => {
      const recipient = normalizePhone(message.from);
      if (!config.allowedRecipients.has(recipient)) {
        log('info', 'non_allowlisted_message_ignored');
        return;
      }
      if (message.type !== 'text' || typeof message.text?.body !== 'string' || !message.text.body.trim()) {
        log('info', 'unsupported_message_type_ignored');
        return;
      }

      log('info', 'inbound_test_message_received');
      await sendTextMessage(recipient, config.autoReplyText);
      log('info', 'test_reply_sent');
    })();
    processedMessages.set(message.id, entry);

    try {
      await entry.promise;
      entry.completed = true;
      pruneProcessedMessages();
    } catch (error) {
      processedMessages.delete(message.id);
      throw error;
    }
  }

  async function handleWebhookPayload(payload) {
    if (payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
      throw new Error('Invalid WhatsApp webhook payload.');
    }

    for (const entry of payload.entry) {
      if (!Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        if (change.field !== 'messages' || !change.value || typeof change.value !== 'object') continue;
        const value = change.value;
        const receivedPhoneNumberId = value.metadata?.phone_number_id;
        if (receivedPhoneNumberId && receivedPhoneNumberId !== config.phoneNumberId) {
          throw new Error('Webhook phone number does not match configured phone number.');
        }

        if (Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            if (typeof status.status === 'string') log('info', `message_status_${status.status}`);
          }
        }
        if (Array.isArray(value.messages)) {
          for (const message of value.messages) await processMessage(message);
        }
      }
    }
  }

  return createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (pathname === '/health' && request.method === 'GET') {
      try {
        const details = options.health ? await options.health() : {};
        sendJson(response, 200, { status: 'ok', ...details });
      } catch {
        sendJson(response, 503, { status: 'unavailable' });
      }
      return;
    }

    if (apiHandler) {
      const handled = await apiHandler(request, response, new URL(request.url || '/', 'http://localhost'));
      if (handled) return;
    }

    if (pathname !== '/webhook') {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    if (request.method === 'GET') {
      if (!config.verifyToken) {
        sendJson(response, 503, { error: 'Webhook verification is not configured.' });
        return;
      }
      const query = new URL(request.url || '/', 'http://localhost').searchParams;
      const mode = query.get('hub.mode');
      const token = query.get('hub.verify_token');
      const challenge = query.get('hub.challenge');
      if (mode !== 'subscribe' || !challenge || !matchesSecret(token, config.verifyToken)) {
        sendJson(response, 403, { error: 'Webhook verification failed.' });
        return;
      }
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end(challenge);
      return;
    }

    if (request.method !== 'POST') {
      response.setHeader('allow', 'GET, POST');
      sendJson(response, 405, { error: 'Method not allowed.' });
      return;
    }

    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      sendJson(response, 415, { error: 'Content-Type must be application/json.' });
      return;
    }
    if (!config.appSecret) {
      sendJson(response, 503, { error: 'Webhook signature validation is not configured.' });
      return;
    }

    const contentLength = Number(request.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > BODY_LIMIT_BYTES) {
      request.resume();
      sendJson(response, 413, { error: 'Request body is too large.' });
      return;
    }

    let rawBody;
    try {
      rawBody = await readRawBody(request);
    } catch (error) {
      sendJson(response, error.statusCode || 400, { error: error.statusCode === 413 ? error.message : 'Invalid request body.' });
      return;
    }

    if (!isValidSignature(rawBody, request.headers['x-hub-signature-256'], config.appSecret)) {
      log('info', 'webhook_signature_rejected');
      sendJson(response, 401, { error: 'Invalid webhook signature.' });
      return;
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      sendJson(response, 400, { error: 'Invalid JSON body.' });
      return;
    }

    try {
      if (options.processWebhook) await options.processWebhook(payload);
      else await handleWebhookPayload(payload);
      sendJson(response, 200, { status: 'accepted' });
    } catch {
      log('error', 'webhook_event_processing_failed');
      sendJson(response, 502, { error: 'Webhook event could not be processed.' });
    }
  });
}

module.exports = { createWhatsAppServer };
