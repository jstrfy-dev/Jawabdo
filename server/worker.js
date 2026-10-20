const { randomUUID } = require('node:crypto');
const { decryptSecret } = require('./security');
const { withTransaction } = require('./db');

const FALLBACK_HANDOFF = 'Thank you for your message. The business owner will reply shortly.';
const REQUEST_TIMEOUT_MS = 20000;
const PRICE_INTENT = /\b(price|cost|rate|how much|kitna|kitne|kitni|qeemat|charges|fee)\b|قیمت|کتنے/i;
const BOOKING_INTENT = /\b(book(?:ing)?|appointment|reserve|schedule|available slot|time slot|book kar)\b|بکنگ|اپائنٹمنٹ/i;
const FAQ_STOPWORDS = new Set(['what', 'when', 'where', 'which', 'that', 'this', 'with', 'from', 'your', 'have', 'does', 'can', 'the', 'for', 'are', 'you', 'our', 'and', 'hai', 'hain', 'kya', 'ka', 'ki', 'ke', 'ko', 'mein']);

function normalized(value) {
  return String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function handoffText(language) {
  if (language === 'roman') return 'Shukriya. Business owner jald aapko jawab dein ge.';
  if (language === 'ur') return 'شکریہ۔ کاروبار کا مالک جلد آپ کو جواب دے گا۔';
  return FALLBACK_HANDOFF;
}

function safePrice(service, language) {
  const amount = Number(service.price_minor) / 100;
  if (!Number.isFinite(amount)) return null;
  const formatted = amount.toFixed(2).replace(/\.00$/, '');
  if (language === 'roman') return `${service.name} ki list price ${service.currency} ${formatted} hai.`;
  if (language === 'ur') return `${service.name} کی درج شدہ قیمت ${service.currency} ${formatted} ہے۔`;
  return `The listed price for ${service.name} is ${service.currency} ${formatted}.`;
}

async function generateReply(config, business, services, faqs, message, fetchImpl) {
  const handoff = { reply: handoffText(business.language), handoff: true };
  if (!config.anthropicApiKey || !config.anthropicModel) {
    return handoff;
  }

  const customerQuestion = normalized(message);
  if (BOOKING_INTENT.test(message)) return handoff;
  if (PRICE_INTENT.test(message)) {
    const service = services.find((entry) => {
      const name = normalized(entry.name);
      return name && customerQuestion.includes(name);
    });
    const priceReply = service && service.price_minor !== null ? safePrice(service, business.language) : null;
    return priceReply
      ? { reply: priceReply, handoff: false }
      : handoff;
  }

  const questionWords = new Set(
    customerQuestion.split(' ').filter((word) => word.length >= 3 && !FAQ_STOPWORDS.has(word)),
  );
  const candidateFaqs = faqs.filter((faq) => {
    const faqWords = normalized(faq.question).split(' ').filter((word) => word.length >= 3 && !FAQ_STOPWORDS.has(word));
    if (!faqWords.length) return false;
    const overlap = faqWords.filter((word) => questionWords.has(word)).length;
    return overlap >= Math.max(1, Math.ceil(faqWords.length / 2));
  });
  if (!candidateFaqs.length) return handoff;

  let response;
  try {
    response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: 400,
        system: `Classify the customer's question against this one business's verified FAQs. Do not draft an answer. Return only JSON {\"action\":\"faq\"|\"handoff\",\"faqIndex\":integer|null,\"confidence\":number}. Choose a FAQ index only when it directly answers the question; otherwise handoff. The backend will send the exact stored FAQ answer, not generated text. Do not answer prices, bookings, availability, exceptions, or facts that are not in an exact FAQ. VERIFIED FAQS: ${JSON.stringify(candidateFaqs.map((faq) => faq.question))}`,
        messages: [{ role: 'user', content: message }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return handoff;
  }
  if (!response.ok) return handoff;

  let body;
  try { body = await response.json(); } catch { return handoff; }
  const text = body?.content?.find((item) => item.type === 'text')?.text;
  if (typeof text !== 'string') return handoff;
  try {
    const result = JSON.parse(text);
    const faq = Number.isInteger(result.faqIndex) ? candidateFaqs[result.faqIndex] : null;
    const confidence = Number(result.confidence);
    if (result.action !== 'faq' || !faq || !Number.isFinite(confidence) || confidence < 0.85) {
      return handoff;
    }
    if (typeof faq.answer !== 'string' || !faq.answer.trim() || faq.answer.length > 1000) {
      return handoff;
    }
    return { reply: faq.answer.trim(), handoff: false };
  } catch {
    return handoff;
  }
}

async function sendWhatsAppText(config, phoneNumberId, token, recipient, text, fetchImpl) {
  const endpoint = `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipient,
        type: 'text',
        text: { preview_url: false, body: text },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('whatsapp_transport_failed');
  }
  let body;
  try { body = await response.json(); } catch { body = null; }
  const messageId = body?.messages?.[0]?.id;
  if (!response.ok || typeof messageId !== 'string') throw new Error('whatsapp_provider_rejected');
  return messageId;
}

async function processIncoming(pool, event, config, fetchImpl, logger) {
  const payload = event.payload;
  const message = payload?.message;
  if (typeof message?.from !== 'string' || !/^\d{8,15}$/.test(message.from) || message.type !== 'text' || typeof message.text?.body !== 'string' || !message.text.body.trim()) {
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE webhook_events SET status='processed',processed_at=now() WHERE id=$1`,
        [event.id],
      );
    }, { worker: true });
    return;
  }

  const inbound = await withTransaction(pool, async (client) => {
    const connection = await client.query(
      `SELECT c.business_id,c.phone_number_id,c.encrypted_access_token,c.status,
        b.name,b.category,b.address,b.timezone,b.language,b.opening_hours,b.policies,b.human_handoff_enabled
       FROM whatsapp_connections c JOIN businesses b ON b.id=c.business_id
       WHERE c.business_id=$1 AND c.phone_number_id=$2`,
      [event.business_id, event.phone_number_id],
    );
    if (!connection.rowCount || connection.rows[0].status !== 'connected') return null;
    const row = connection.rows[0];
    const customerResult = await client.query(
      `INSERT INTO customers(business_id,whatsapp_user_id,display_name,phone_number)
       VALUES($1,$2,$3,$2)
       ON CONFLICT(business_id,whatsapp_user_id) DO UPDATE SET
        display_name=CASE WHEN EXCLUDED.display_name='' THEN customers.display_name ELSE EXCLUDED.display_name END,
        updated_at=now()
       RETURNING id,opted_out_at`,
      [row.business_id, message.from, String(payload.customerName || '').slice(0, 120)],
    );
    const customerId = customerResult.rows[0].id;
    const incomingText = message.text.body.trim();
    const stopWords = new Set(['STOP', 'STOP ALL', 'UNSUBSCRIBE', 'OPT OUT']);
    const startWords = new Set(['START', 'UNSTOP']);
    const isStop = stopWords.has(incomingText.toUpperCase());
    const isStart = startWords.has(incomingText.toUpperCase());
    if (isStop) {
      await client.query(
        `UPDATE customers SET opted_out_at=now(),reminder_opt_in_at=NULL,updated_at=now() WHERE business_id=$1 AND id=$2`,
        [row.business_id, customerId],
      );
      await client.query(
        `UPDATE reminder_jobs SET status='cancelled',error_code='customer_opted_out',updated_at=now()
         WHERE business_id=$1 AND recipient_type='customer' AND recipient_phone=$2 AND status IN ('pending','processing')`,
        [row.business_id, message.from],
      );
    } else if (isStart) {
      await client.query(
        `UPDATE customers SET opted_out_at=NULL,service_message_opt_in_at=now(),updated_at=now()
         WHERE business_id=$1 AND id=$2`,
        [row.business_id, customerId],
      );
    }
    const conversationResult = await client.query(
      `INSERT INTO conversations(business_id,customer_id,last_message_at)
       VALUES($1,$2,now())
       ON CONFLICT(business_id,customer_id) DO UPDATE SET last_message_at=now(),updated_at=now()
       RETURNING id,state`,
      [row.business_id, customerId],
    );
    const conversation = conversationResult.rows[0];
    const stored = await client.query(
      `INSERT INTO messages(business_id,conversation_id,direction,sender,body,whatsapp_message_id,delivery_status)
       VALUES($1,$2,'inbound','customer',$3,$4,'received')
       ON CONFLICT(whatsapp_message_id) WHERE whatsapp_message_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [row.business_id, conversation.id, message.text.body.slice(0, 4000), message.id],
    );
    if (!stored.rowCount) return null;
    if (isStop || (customerResult.rows[0].opted_out_at && !isStart)) {
      await client.query(
        `UPDATE webhook_events SET status='processed',processed_at=now() WHERE id=$1`,
        [event.id],
      );
      return { suppressed: true };
    }
    const services = await client.query(
      `SELECT name,description,price_minor,currency,duration_minutes FROM services
       WHERE business_id=$1 AND active=true ORDER BY name LIMIT 100`,
      [row.business_id],
    );
    const faqs = await client.query(
      `SELECT question,answer FROM business_faqs
       WHERE business_id=$1 AND verified_at IS NOT NULL ORDER BY created_at LIMIT 100`,
      [row.business_id],
    );
    await client.query(
      `UPDATE webhook_events SET status='processing',attempts=attempts+1 WHERE id=$1`,
      [event.id],
    );
    return { row, conversation, services: services.rows, faqs: faqs.rows, resumed: isStart };
  }, { worker: true, businessId: event.business_id });

  if (!inbound || inbound.suppressed) {
    await withTransaction(pool, async (client) => {
      await client.query(`UPDATE webhook_events SET status='processed',processed_at=now() WHERE id=$1`, [event.id]);
    }, { worker: true });
    return;
  }

  if (['needs_owner', 'owner_handling', 'closed'].includes(inbound.conversation.state)) {
    await withTransaction(pool, async (client) => {
      await client.query(`UPDATE webhook_events SET status='processed',processed_at=now() WHERE id=$1`, [event.id]);
    }, { worker: true });
    return;
  }

  let result = { reply: FALLBACK_HANDOFF, handoff: true };
  if (inbound.resumed) {
    result = { reply: 'Messages are active again. Appointment reminders still need your separate consent.', handoff: false };
  } else if (!inbound.row.human_handoff_enabled) {
    result = { reply: 'I cannot confirm this automatically. Please contact the business directly.', handoff: false };
  } else {
    result = await generateReply(config, inbound.row, inbound.services, inbound.faqs, message.text.body.slice(0, 4000), fetchImpl);
  }
  const token = decryptSecret(inbound.row.encrypted_access_token, config.encryptionKey);
  const messageRowId = randomUUID();
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO messages(id,business_id,conversation_id,direction,sender,body,delivery_status)
       VALUES($1,$2,$3,'outbound','assistant',$4,'queued')`,
      [messageRowId, event.business_id, inbound.conversation.id, result.reply],
    );
    if (result.handoff) {
      await client.query(`UPDATE conversations SET state='needs_owner',updated_at=now() WHERE id=$1`, [inbound.conversation.id]);
    }
  }, { worker: true, businessId: event.business_id });

  try {
    const whatsappMessageId = await sendWhatsAppText(config, event.phone_number_id, token, message.from, result.reply, fetchImpl);
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE messages SET whatsapp_message_id=$2,
          delivery_status=COALESCE((SELECT status FROM whatsapp_delivery_statuses WHERE business_id=$3 AND whatsapp_message_id=$2),'sent'),
          error_code=(SELECT error_code FROM whatsapp_delivery_statuses WHERE business_id=$3 AND whatsapp_message_id=$2)
         WHERE id=$1`,
        [messageRowId, whatsappMessageId, event.business_id],
      );
      await client.query(
        `UPDATE webhook_events SET status='processed',processed_at=now(),error_code=NULL WHERE id=$1`,
        [event.id],
      );
      await client.query(
        `UPDATE whatsapp_connections SET status='connected',last_error_code=NULL,updated_at=now() WHERE business_id=$1`,
        [event.business_id],
      );
    }, { worker: true, businessId: event.business_id });
  } catch (error) {
    await withTransaction(pool, async (client) => {
      await client.query(`UPDATE messages SET delivery_status='failed',error_code='provider_error' WHERE id=$1`, [messageRowId]);
      await client.query(`UPDATE webhook_events SET status='failed',error_code='reply_delivery_failed' WHERE id=$1`, [event.id]);
      await client.query(
        `UPDATE whatsapp_connections SET status='needs_attention',last_error_code='reply_delivery_failed',updated_at=now() WHERE business_id=$1`,
        [event.business_id],
      );
    }, { worker: true, businessId: event.business_id });
    logger.error({ event: 'whatsapp_reply_delivery_failed', businessId: event.business_id });
  }
}

async function processStatus(pool, event) {
  const status = event.payload?.status;
  const allowed = new Set(['sent', 'delivered', 'read', 'failed']);
  if (!status || !allowed.has(status.status) || typeof status.id !== 'string') {
    await withTransaction(pool, async (client) => {
      await client.query(`UPDATE webhook_events SET status='processed',processed_at=now() WHERE id=$1`, [event.id]);
    }, { worker: true });
    return;
  }
  const errorCode = Array.isArray(status.errors) && status.errors[0]?.code
    ? String(status.errors[0].code).slice(0, 50)
    : null;
  await withTransaction(pool, async (client) => {
    const eventTimestamp = Number.parseInt(String(status.timestamp || '0'), 10);
    await client.query(
      `INSERT INTO whatsapp_delivery_statuses(business_id,whatsapp_message_id,status,error_code,event_timestamp)
       VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(business_id,whatsapp_message_id) DO UPDATE SET
        status=EXCLUDED.status,error_code=EXCLUDED.error_code,
        event_timestamp=EXCLUDED.event_timestamp,updated_at=now()
       WHERE EXCLUDED.event_timestamp >= whatsapp_delivery_statuses.event_timestamp`,
      [event.business_id, status.id, status.status, errorCode, Number.isSafeInteger(eventTimestamp) ? eventTimestamp : 0],
    );
    await client.query(
      `UPDATE messages SET
        delivery_status=(SELECT s.status FROM whatsapp_delivery_statuses s WHERE s.business_id=$1 AND s.whatsapp_message_id=$2),
        error_code=(SELECT s.error_code FROM whatsapp_delivery_statuses s WHERE s.business_id=$1 AND s.whatsapp_message_id=$2)
       WHERE business_id=$1 AND whatsapp_message_id=$2`,
      [event.business_id, status.id],
    );
    const latestStatus = await client.query(
      `SELECT status,error_code FROM whatsapp_delivery_statuses WHERE business_id=$1 AND whatsapp_message_id=$2`,
      [event.business_id, status.id],
    );
    if (latestStatus.rows[0]?.status === 'failed') {
      await client.query(
        `UPDATE whatsapp_connections SET last_error_code=$2,status='needs_attention',updated_at=now()
         WHERE business_id=$1`,
        [event.business_id, latestStatus.rows[0].error_code || 'message_delivery_failed'],
      );
    }
    if (latestStatus.rows[0]) {
      await client.query(
        `UPDATE reminder_jobs SET status=$3,error_code=$4,
          sent_at=CASE WHEN $3 IN ('sent','delivered','read') THEN COALESCE(sent_at,now()) ELSE sent_at END,
          updated_at=now()
         WHERE business_id=$1 AND whatsapp_message_id=$2 AND status IN ('sent','delivered','read')`,
        [event.business_id, status.id, latestStatus.rows[0].status, latestStatus.rows[0].error_code],
      );
    }
    await client.query(`UPDATE webhook_events SET status='processed',processed_at=now() WHERE id=$1`, [event.id]);
  }, { worker: true, businessId: event.business_id });
}

async function sendWhatsAppTemplate(config, job, fetchImpl) {
  const endpoint = `https://graph.facebook.com/${config.apiVersion}/${encodeURIComponent(job.phone_number_id)}/messages`;
  const templateName = job.recipient_type === 'customer'
    ? config.customerReminderTemplate
    : config.ownerReminderTemplate;
  if (!templateName) throw new Error('reminder_template_not_configured');

  const appointmentTime = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: job.timezone,
  }).format(new Date(job.starts_at));
  const parameters = [
    job.customer_name || 'Customer',
    job.service_name,
    appointmentTime,
    job.business_name,
  ].map((text) => ({ type: 'text', text: String(text).slice(0, 256) }));
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${decryptSecret(job.encrypted_access_token, config.encryptionKey)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: job.recipient_phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: config.reminderTemplateLanguage || 'en' },
          components: [{ type: 'body', parameters }],
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error('reminder_transport_failed');
  }
  let body;
  try { body = await response.json(); } catch { body = null; }
  const messageId = body?.messages?.[0]?.id;
  if (!response.ok || typeof messageId !== 'string') throw new Error('reminder_provider_rejected');
  return messageId;
}

async function processOneReminder(pool, config, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const logger = options.logger || { info: () => {}, error: () => {} };
  const job = await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE reminder_jobs SET status='failed',error_code='worker_interrupted',updated_at=now()
       WHERE status='processing' AND updated_at < now()-interval '5 minutes'`,
    );
    const due = await client.query(
      `SELECT r.id,r.business_id,r.booking_id,r.recipient_type,r.recipient_phone,
        b.status AS booking_status,b.service_name,b.starts_at,b.timezone,b.reminder_opt_in_at,
        c.display_name AS customer_name,c.reminder_opt_in_at AS customer_reminder_opt_in_at,c.opted_out_at,
        biz.name AS business_name,biz.owner_phone,biz.owner_whatsapp_opt_in,
        wc.phone_number_id,wc.encrypted_access_token,wc.status AS connection_status
       FROM reminder_jobs r
       JOIN bookings b ON b.business_id=r.business_id AND b.id=r.booking_id
       JOIN businesses biz ON biz.id=r.business_id
       LEFT JOIN customers c ON c.business_id=b.business_id AND c.id=b.customer_id
       LEFT JOIN whatsapp_connections wc ON wc.business_id=r.business_id
       WHERE r.status='pending' AND r.scheduled_at<=now()
       ORDER BY r.scheduled_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`,
    );
    if (!due.rowCount) return null;
    await client.query(
      `UPDATE reminder_jobs SET status='processing',attempts=attempts+1,updated_at=now() WHERE id=$1`,
      [due.rows[0].id],
    );
    return due.rows[0];
  }, { worker: true });
  if (!job) return false;

  let failureCode = null;
  if (job.booking_status !== 'confirmed') failureCode = 'booking_not_confirmed';
  else if (job.recipient_type === 'customer' && (!job.reminder_opt_in_at || !job.customer_reminder_opt_in_at || job.opted_out_at)) failureCode = 'customer_consent_missing';
  else if (job.recipient_type === 'owner' && !job.owner_whatsapp_opt_in) failureCode = 'owner_consent_missing';
  else if (job.recipient_type === 'owner' && job.recipient_phone !== job.owner_phone) failureCode = 'owner_phone_changed';
  else if (job.connection_status !== 'connected' || !job.phone_number_id || !job.encrypted_access_token) failureCode = 'whatsapp_not_connected';
  else if (!(job.recipient_type === 'customer' ? config.customerReminderTemplate : config.ownerReminderTemplate)) failureCode = 'template_not_configured';

  if (failureCode) {
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE reminder_jobs SET status=$2,error_code=$3,updated_at=now() WHERE id=$1`,
        [job.id, failureCode === 'booking_not_confirmed' || failureCode.endsWith('_consent_missing') ? 'cancelled' : 'failed', failureCode],
      );
    }, { worker: true, businessId: job.business_id });
    logger.info({ event: 'reminder_not_sent', businessId: job.business_id, reason: failureCode });
    return true;
  }

  const consentStillValid = await withTransaction(pool, async (client) => {
    const current = await client.query(
      `SELECT r.status,b.status AS booking_status,b.reminder_opt_in_at,
        c.reminder_opt_in_at AS customer_reminder_opt_in_at,c.opted_out_at,
        biz.owner_whatsapp_opt_in,biz.owner_phone
       FROM reminder_jobs r
       JOIN bookings b ON b.business_id=r.business_id AND b.id=r.booking_id
       JOIN businesses biz ON biz.id=r.business_id
       LEFT JOIN customers c ON c.business_id=b.business_id AND c.id=b.customer_id
       WHERE r.business_id=$1 AND r.id=$2 FOR UPDATE OF r`,
      [job.business_id, job.id],
    );
    const currentJob = current.rows[0];
    if (!currentJob || currentJob.status !== 'processing' || currentJob.booking_status !== 'confirmed') return false;
    if (job.recipient_type === 'customer') {
      return Boolean(currentJob.reminder_opt_in_at && currentJob.customer_reminder_opt_in_at && !currentJob.opted_out_at);
    }
    return Boolean(currentJob.owner_whatsapp_opt_in && currentJob.owner_phone === job.recipient_phone);
  }, { worker: true, businessId: job.business_id });
  if (!consentStillValid) {
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE reminder_jobs SET status='cancelled',error_code='consent_or_booking_changed',updated_at=now()
         WHERE business_id=$1 AND id=$2 AND status='processing'`,
        [job.business_id, job.id],
      );
    }, { worker: true, businessId: job.business_id });
    return true;
  }

  try {
    const messageId = await sendWhatsAppTemplate(config, job, fetchImpl);
    await withTransaction(pool, async (client) => {
      const latestStatus = await client.query(
        `SELECT status,error_code FROM whatsapp_delivery_statuses WHERE business_id=$1 AND whatsapp_message_id=$2`,
        [job.business_id, messageId],
      );
      await client.query(
        `UPDATE reminder_jobs SET
          status=COALESCE($3,'sent'),whatsapp_message_id=$2,sent_at=now(),error_code=$4,updated_at=now()
         WHERE id=$1`,
        [job.id, messageId, latestStatus.rows[0]?.status || null, latestStatus.rows[0]?.error_code || null],
      );
    }, { worker: true, businessId: job.business_id });
  } catch {
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE reminder_jobs SET status='failed',error_code='provider_error',updated_at=now() WHERE id=$1`,
        [job.id],
      );
    }, { worker: true, businessId: job.business_id });
    logger.error({ event: 'reminder_delivery_failed', businessId: job.business_id });
  }
  return true;
}

async function processOneEvent(pool, config, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  const logger = options.logger || { info: () => {}, error: () => {} };
  const event = await withTransaction(pool, async (client) => {
    await client.query(
      `UPDATE webhook_events SET status='failed',error_code='worker_interrupted'
       WHERE status='processing' AND received_at < now()-interval '5 minutes'`,
    );
    const claimed = await client.query(
      `SELECT id,business_id,phone_number_id,event_type,payload
       FROM webhook_events WHERE status='queued'
       ORDER BY received_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    if (!claimed.rowCount) return null;
    await client.query(
      `UPDATE webhook_events SET status='processing',attempts=attempts+1 WHERE id=$1`,
      [claimed.rows[0].id],
    );
    return claimed.rows[0];
  }, { worker: true });
  if (!event) return false;
  try {
    if (event.event_type === 'incoming_message') await processIncoming(pool, event, config, fetchImpl, logger);
    else if (event.event_type === 'message_status') await processStatus(pool, event);
    else {
      await withTransaction(pool, async (client) => {
        await client.query(`UPDATE webhook_events SET status='processed',processed_at=now() WHERE id=$1`, [event.id]);
      }, { worker: true });
    }
  } catch {
    await withTransaction(pool, async (client) => {
      await client.query(
        `UPDATE webhook_events SET status='failed',error_code='worker_processing_failed' WHERE id=$1`,
        [event.id],
      );
    }, { worker: true });
    logger.error({ event: 'webhook_worker_event_failed', businessId: event.business_id });
  }
  return true;
}

function startWorker(pool, config, options = {}) {
  let running = false;
  const logger = options.logger || { info: () => {}, error: () => {} };
  const interval = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      while (await processOneEvent(pool, config, options)) {}
      while (await processOneReminder(pool, config, options)) {}
    } catch {
      logger.error({ event: 'webhook_worker_poll_failed' });
    } finally {
      running = false;
    }
  }, options.intervalMs || 1000);
  interval.unref();
  return () => clearInterval(interval);
}

module.exports = { generateReply, processOneEvent, processOneReminder, startWorker };
