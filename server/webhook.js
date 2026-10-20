const { withTransaction } = require('./db');

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function enqueueWebhookPayload(pool, payload, logger) {
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    throw new Error('Invalid WhatsApp webhook payload.');
  }

  let accepted = 0;
  for (const entry of payload.entry) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes) {
      if (change?.field !== 'messages' || !isRecord(change.value)) continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (typeof phoneNumberId !== 'string' || !/^\d+$/.test(phoneNumberId)) continue;

      await withTransaction(pool, async (client) => {
        const connection = await client.query(
          `SELECT business_id FROM whatsapp_connections
           WHERE phone_number_id=$1 AND status='connected'`,
          [phoneNumberId],
        );
        if (!connection.rowCount) return;
        const businessId = connection.rows[0].business_id;
        await client.query(
          `UPDATE whatsapp_connections SET last_webhook_at=now(),updated_at=now()
           WHERE business_id=$1`,
          [businessId],
        );

        for (const message of Array.isArray(value.messages) ? value.messages : []) {
          if (typeof message?.id !== 'string' || !message.id) continue;
          const customer = Array.isArray(value.contacts)
            ? value.contacts.find((contact) => contact?.wa_id === message.from)
            : null;
          const inserted = await client.query(
            `INSERT INTO webhook_events(event_key,phone_number_id,business_id,event_type,payload)
             VALUES($1,$2,$3,'incoming_message',$4::jsonb)
             ON CONFLICT(event_key) DO NOTHING`,
            [
              `message:${message.id}`,
              phoneNumberId,
              businessId,
              JSON.stringify({ message, customerName: customer?.profile?.name || '' }),
            ],
          );
          accepted += inserted.rowCount;
        }

        for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
          if (typeof status?.id !== 'string' || typeof status?.status !== 'string') continue;
          const eventKey = `status:${status.id}:${status.status}:${String(status.timestamp || '')}`;
          const inserted = await client.query(
            `INSERT INTO webhook_events(event_key,phone_number_id,business_id,event_type,payload)
             VALUES($1,$2,$3,'message_status',$4::jsonb)
             ON CONFLICT(event_key) DO NOTHING`,
            [eventKey, phoneNumberId, businessId, JSON.stringify(status)],
          );
          accepted += inserted.rowCount;
        }
      }, { worker: true });
    }
  }

  logger.info({ event: 'webhook_events_queued', count: accepted });
}

module.exports = { enqueueWebhookPayload };
