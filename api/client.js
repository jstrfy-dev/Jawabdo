const { resolveApiBaseUrl } = require('./baseUrl');

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function createApiClient({
  baseUrl,
  fetchImpl = globalThis.fetch,
  onUnauthorized = () => {},
  timeoutMs = 15000,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A Fetch API implementation is required.');
  if (!baseUrl) throw new Error('An API base URL is required.');
  const origin = new URL(baseUrl).origin;

  async function request(path, { method = 'GET', token, body, signal } = {}) {
    if (typeof path !== 'string' || !path.startsWith('/api/')) {
      throw new Error('API paths must begin with /api/.');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const abortRequest = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', abortRequest, { once: true });
    }

    try {
      let response;
      try {
        response = await fetchImpl(`${origin}${path}`, {
          method,
          headers: {
            accept: 'application/json',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) throw new ApiError('Request timed out or was cancelled. Check the server connection and try again.', 0, 'network_timeout');
        throw new ApiError('JawabDo server se rabta nahi ho saka. Server aur network check karein.', 0, 'network_error');
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        if (response.ok) throw new ApiError('Server ne invalid response diya.', response.status, 'invalid_response');
      }
      if (!response.ok) {
        if (response.status === 401) await onUnauthorized();
        throw new ApiError(
          typeof payload?.error === 'string' ? payload.error : 'Request complete nahi ho saki.',
          response.status,
          typeof payload?.code === 'string' ? payload.code : 'request_failed',
        );
      }
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new ApiError('Server ne invalid response diya.', response.status, 'invalid_response');
      }
      return payload;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortRequest);
    }
  }

  return Object.freeze({
    baseUrl: origin,
    request,
    publicConfig: () => request('/api/config/public'),
    login: (credentials) => request('/api/auth/login', { method: 'POST', body: credentials }),
    register: (details) => request('/api/auth/register', { method: 'POST', body: details }),
    me: (token) => request('/api/me', { token }),
    getBusiness: (token) => request('/api/business', { token }),
    updateBusiness: (token, business) => request('/api/business', { method: 'PUT', token, body: business }),
    getServices: (token) => request('/api/services', { token }),
    createService: (token, service) => request('/api/services', { method: 'POST', token, body: service }),
    deactivateService: (token, serviceId) => request(`/api/services/${encodeURIComponent(serviceId)}`, { method: 'DELETE', token }),
    getFaqs: (token) => request('/api/faqs', { token }),
    createFaq: (token, faq) => request('/api/faqs', { method: 'POST', token, body: faq }),
    getWhatsAppConnection: (token) => request('/api/whatsapp/connection', { token }),
    getConversations: (token) => request('/api/conversations', { token }),
    getConversationMessages: (token, conversationId) => request(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, { token }),
    setConversationState: (token, conversationId, state) => request(`/api/conversations/${encodeURIComponent(conversationId)}`, { method: 'PATCH', token, body: { state } }),
    getBookings: (token) => request('/api/bookings', { token }),
    updateBooking: (token, bookingId, status) => request(`/api/bookings/${encodeURIComponent(bookingId)}`, { method: 'PATCH', token, body: { status } }),
    deleteAccount: (token, confirmation, password) => request('/api/account', { method: 'DELETE', token, body: { confirmation, password } }),
  });
}

module.exports = { ApiError, createApiClient, resolveApiBaseUrl };
