const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { after, before, describe, it } = require('node:test');

const { createWhatsAppServer } = require('./app');
const { readConfig } = require('./config');

const TEST_ACCESS_TOKEN = 'unit-test-access-token-not-a-real-credential';
const TEST_APP_SECRET = 'unit-test-meta-app-secret';
const TEST_VERIFY_TOKEN = 'unit-test-verify-token-0123456789abcdef';
const PHONE_NUMBER_ID = '1234567890';
const AUTHORIZED_RECIPIENT = '923001234567';

function testConfig(overrides = {}) {
  return {
    accessToken: TEST_ACCESS_TOKEN,
    phoneNumberId: PHONE_NUMBER_ID,
    businessAccountId: '9876543210',
    verifyToken: TEST_VERIFY_TOKEN,
    appSecret: TEST_APP_SECRET,
    apiVersion: 'v99.0',
    allowedRecipients: new Set([AUTHORIZED_RECIPIENT]),
    autoReplyText: 'A test acknowledgement.',
    port: 0,
    ...overrides,
  };
}

function signedRequest(body, secret = TEST_APP_SECRET) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function messagePayload({ id = 'wamid.test-1', from = AUTHORIZED_RECIPIENT, type = 'text', text = 'Hello' } = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: PHONE_NUMBER_ID },
          messages: [{ id, from, type, text: type === 'text' ? { body: text } : undefined }],
        },
      }],
    }],
  };
}

describe('WhatsApp webhook server', () => {
  let server;
  let baseUrl;
  let outboundRequests;
  let logs;

  before(async () => {
    outboundRequests = [];
    logs = [];
    server = createWhatsAppServer(testConfig(), {
      fetch: async (url, options) => {
        outboundRequests.push({ url, options });
        return { ok: true, status: 200 };
      },
      logger: {
        info: (event) => logs.push(event),
        error: (event) => logs.push(event),
      },
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('reports health without exposing configuration', async () => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  });

  it('verifies the Meta callback token and echoes the challenge', async () => {
    const query = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': TEST_VERIFY_TOKEN,
      'hub.challenge': 'verification-challenge',
    });
    const response = await fetch(`${baseUrl}/webhook?${query}`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'verification-challenge');
  });

  it('rejects incorrect callback tokens', async () => {
    const query = new URLSearchParams({
      'hub.mode': 'subscribe',
      'hub.verify_token': 'incorrect',
      'hub.challenge': 'challenge',
    });
    const response = await fetch(`${baseUrl}/webhook?${query}`);
    assert.equal(response.status, 403);
  });

  it('sends an official Graph API acknowledgement only to an allowlisted sender', async () => {
    const rawBody = JSON.stringify(messagePayload());
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': signedRequest(rawBody),
      },
      body: rawBody,
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'accepted' });
    assert.equal(outboundRequests.length, 1);
    assert.equal(outboundRequests[0].url, `https://graph.facebook.com/v99.0/${PHONE_NUMBER_ID}/messages`);
    assert.equal(outboundRequests[0].options.method, 'POST');
    assert.equal(outboundRequests[0].options.headers.authorization, `Bearer ${TEST_ACCESS_TOKEN}`);
    assert.deepEqual(JSON.parse(outboundRequests[0].options.body), {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: AUTHORIZED_RECIPIENT,
      type: 'text',
      text: { preview_url: false, body: 'A test acknowledgement.' },
    });
  });

  it('returns a safe retry response when the Graph API rejects a reply', async (context) => {
    let attempt = 0;
    const failureLogs = [];
    const failureServer = createWhatsAppServer(testConfig(), {
      fetch: async () => {
        attempt += 1;
        return attempt === 1
          ? { ok: false, status: 401, text: async () => 'sensitive upstream response' }
          : { ok: true, status: 200 };
      },
      logger: {
        info: (event) => failureLogs.push(event),
        error: (event) => failureLogs.push(event),
      },
    });
    await new Promise((resolve) => failureServer.listen(0, '127.0.0.1', resolve));
    context.after(async () => new Promise((resolve, reject) => failureServer.close((error) => error ? reject(error) : resolve())));
    const failureUrl = `http://127.0.0.1:${failureServer.address().port}/webhook`;
    const rawBody = JSON.stringify(messagePayload({ id: 'wamid.graph-retry' }));
    const send = () => fetch(failureUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signedRequest(rawBody) },
      body: rawBody,
    });

    const failed = await send();
    assert.equal(failed.status, 502);
    assert.equal((await failed.text()).includes('sensitive upstream response'), false);
    const retried = await send();
    assert.equal(retried.status, 200);
    assert.equal(attempt, 2);
    assert.equal(JSON.stringify(failureLogs).includes(TEST_ACCESS_TOKEN), false);
  });

  it('does not send a duplicate reply for a redelivered message ID', async () => {
    const rawBody = JSON.stringify(messagePayload());
    const request = () => fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signedRequest(rawBody) },
      body: rawBody,
    });
    const first = await request();
    const duplicate = await request();
    assert.equal(first.status, 200);
    assert.equal(duplicate.status, 200);
    assert.equal(outboundRequests.length, 1);
    assert.ok(logs.some((event) => event.event === 'duplicate_message_ignored'));
  });

  it('rejects unsigned or incorrectly signed webhook payloads', async () => {
    const rawBody = JSON.stringify(messagePayload({ id: 'wamid.bad-signature' }));
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signedRequest(rawBody, 'wrong-secret') },
      body: rawBody,
    });
    assert.equal(response.status, 401);
    assert.equal(outboundRequests.length, 1);
  });

  it('rejects webhook payloads above the request size limit', async () => {
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ large: 'x'.repeat(1024 * 1024) }),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'Request body is too large.' });
  });

  it('does not reply to a sender outside the configured test allowlist', async () => {
    const rawBody = JSON.stringify(messagePayload({ id: 'wamid.not-allowlisted', from: '923009998877' }));
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signedRequest(rawBody) },
      body: rawBody,
    });
    assert.equal(response.status, 200);
    assert.equal(outboundRequests.length, 1);
  });

  it('accepts status notifications without sending a customer message', async () => {
    const rawBody = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ status: 'delivered' }] } }] }],
    });
    const response = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signedRequest(rawBody) },
      body: rawBody,
    });
    assert.equal(response.status, 200);
    assert.equal(outboundRequests.length, 1);
    assert.ok(logs.some((event) => event.event === 'message_status_delivered'));
  });

  it('does not log message text, sender, or access-token values', async () => {
    const rawBody = JSON.stringify(messagePayload({ id: 'wamid.log-check', text: 'private-message-body' }));
    await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': signedRequest(rawBody) },
      body: rawBody,
    });
    const serializedLogs = JSON.stringify(logs);
    assert.equal(serializedLogs.includes('private-message-body'), false);
    assert.equal(serializedLogs.includes(AUTHORIZED_RECIPIENT), false);
    assert.equal(serializedLogs.includes(TEST_ACCESS_TOKEN), false);
  });
});

describe('server environment configuration', () => {
  it('requires all secrets, API version, and an explicit test-recipient allowlist', () => {
    assert.throws(() => readConfig({}), /WHATSAPP_ACCESS_TOKEN.*META_APP_SECRET.*WHATSAPP_TEST_RECIPIENTS/);
  });

  it('validates test-recipient phone numbers', () => {
    assert.throws(() => readConfig({
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
      WHATSAPP_BUSINESS_ACCOUNT_ID: '9876543210',
      WHATSAPP_VERIFY_TOKEN: TEST_VERIFY_TOKEN,
      META_APP_SECRET: TEST_APP_SECRET,
      WHATSAPP_API_VERSION: 'v99.0',
      WHATSAPP_TEST_RECIPIENTS: '+bad-number',
    }), /WHATSAPP_TEST_RECIPIENTS/);
  });

  it('does not include configured secret values in validation errors', () => {
    assert.throws(() => readConfig({
      WHATSAPP_ACCESS_TOKEN: TEST_ACCESS_TOKEN,
      WHATSAPP_PHONE_NUMBER_ID: 'not-an-id',
      WHATSAPP_BUSINESS_ACCOUNT_ID: '9876543210',
      WHATSAPP_VERIFY_TOKEN: TEST_VERIFY_TOKEN,
      META_APP_SECRET: TEST_APP_SECRET,
      WHATSAPP_API_VERSION: 'v99.0',
      WHATSAPP_TEST_RECIPIENTS: AUTHORIZED_RECIPIENT,
    }), (error) => !error.message.includes(TEST_ACCESS_TOKEN) && !error.message.includes(TEST_APP_SECRET));
  });
});
