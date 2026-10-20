const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { enqueueWebhookPayload } = require('./webhook');

function createFakePool() {
  const eventKeys = new Set();
  const businessId = '00000000-0000-4000-8000-000000000001';
  return {
    eventKeys,
    async connect() {
      return {
        async query(sql, values = []) {
          if (sql.includes('SELECT business_id FROM whatsapp_connections')) {
            return values[0] === '1234567890'
              ? { rowCount: 1, rows: [{ business_id: businessId }] }
              : { rowCount: 0, rows: [] };
          }
          if (sql.includes('INSERT INTO webhook_events')) {
            const wasInserted = !eventKeys.has(values[0]);
            eventKeys.add(values[0]);
            return { rowCount: Number(wasInserted), rows: [] };
          }
          return { rowCount: 1, rows: [] };
        },
        release() {},
      };
    },
  };
}

function payload() {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: '1234567890' },
          contacts: [{ wa_id: '923001234567', profile: { name: 'Test Customer' } }],
          messages: [{ id: 'wamid.test-incoming', from: '923001234567', type: 'text', text: { body: 'Hello' } }],
          statuses: [{ id: 'wamid.previous-message', status: 'delivered', timestamp: '1760000000' }],
        },
      }],
    }],
  };
}

describe('durable webhook event intake', () => {
  it('creates tenant-keyed message and delivery events and suppresses duplicate IDs', async () => {
    const pool = createFakePool();
    const logs = [];
    const logger = { info: (entry) => logs.push(entry) };
    await enqueueWebhookPayload(pool, payload(), logger);
    await enqueueWebhookPayload(pool, payload(), logger);
    assert.deepEqual([...pool.eventKeys].sort(), [
      'message:wamid.test-incoming',
      'status:wamid.previous-message:delivered:1760000000',
    ]);
    assert.equal(logs[0].count, 2);
    assert.equal(logs[1].count, 0);
  });

  it('rejects invalid webhook envelopes without writing events', async () => {
    const pool = createFakePool();
    await assert.rejects(() => enqueueWebhookPayload(pool, { object: 'other', entry: [] }, { info() {} }), /Invalid WhatsApp webhook payload/);
    assert.equal(pool.eventKeys.size, 0);
  });
});
