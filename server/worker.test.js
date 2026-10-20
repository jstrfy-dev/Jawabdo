const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { generateReply } = require('./worker');

const business = {
  name: 'Test Salon',
  category: 'Salon',
  address: 'Lahore',
  timezone: 'Asia/Karachi',
  language: 'roman',
  opening_hours: [],
  policies: {},
};

describe('business-specific AI response guardrails', () => {
  it('hands off when the server-side AI provider is not configured', async () => {
    const response = await generateReply({}, business, [], [], 'What is the price?', async () => {
      throw new Error('Provider must not be called.');
    });
    assert.equal(response.handoff, true);
    assert.match(response.reply, /owner/);
  });

  it('uses model intent only to select a verified FAQ and sends the stored answer', async () => {
    const response = await generateReply(
      { anthropicApiKey: 'test-key', anthropicModel: 'test-model' },
      business,
      [{ name: 'Haircut', price_minor: '250000', currency: 'PKR', duration_minutes: 30 }],
      [{ question: 'Do you have parking?', answer: 'Street parking is available.' }],
      'Do you have parking?',
      async (_url, options) => {
        const requestBody = JSON.parse(options.body);
        assert.match(requestBody.system, /Do you have parking/);
        assert.doesNotMatch(requestBody.system, /2500/);
        return {
          ok: true,
          json: async () => ({ content: [{ type: 'text', text: '{"action":"faq","faqIndex":0,"confidence":0.95}' }] }),
        };
      },
    );
    assert.deepEqual(response, { reply: 'Street parking is available.', handoff: false });
  });

  it('falls back to owner handoff for malformed or failed provider responses', async () => {
    const config = { anthropicApiKey: 'test-key', anthropicModel: 'test-model' };
    const malformed = await generateReply(config, business, [], [], 'Question?', async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'not JSON' }] }),
    }));
    const failed = await generateReply(config, business, [], [], 'Question?', async () => ({ ok: false }));
    assert.equal(malformed.handoff, true);
    assert.equal(failed.handoff, true);
    assert.equal(malformed.reply, failed.reply);
  });

  it('answers prices only with the named service price stored by the business', async () => {
    const config = { anthropicApiKey: 'test-key', anthropicModel: 'test-model' };
    const services = [
      { name: 'Haircut', price_minor: '250000', currency: 'PKR', duration_minutes: 30 },
      { name: 'Coloring', price_minor: null, currency: 'PKR', duration_minutes: 60 },
    ];
    const neverCallProvider = async () => { throw new Error('Price answers must not use generated text.'); };
    assert.deepEqual(
      await generateReply(config, business, services, [], 'What is the Haircut price?', neverCallProvider),
      { reply: 'Haircut ki list price PKR 2500 hai.', handoff: false },
    );
    assert.equal((await generateReply(config, business, services, [], 'What is the Coloring price?', neverCallProvider)).handoff, true);
    assert.equal((await generateReply(config, business, services, [], 'What is the price?', neverCallProvider)).handoff, true);
    assert.equal((await generateReply(config, business, services, [], 'Can I book an appointment?', neverCallProvider)).handoff, true);
  });

  it('hands off when the model selects an unavailable FAQ or low confidence', async () => {
    const config = { anthropicApiKey: 'test-key', anthropicModel: 'test-model' };
    const fetch = async () => ({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: '{"action":"faq","faqIndex":7,"confidence":0.99}' }] }),
    });
    const response = await generateReply(config, business, [], [], 'Unknown question', fetch);
    assert.equal(response.handoff, true);
  });
});
