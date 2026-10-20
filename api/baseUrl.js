function resolveApiBaseUrl({ platform, override, hostUri } = {}) {
  const configured = String(override || '').trim();
  if (configured) {
    let url;
    try {
      url = new URL(configured);
    } catch {
      throw new Error('EXPO_PUBLIC_API_URL must be an absolute HTTP(S) URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('EXPO_PUBLIC_API_URL must be an HTTP(S) origin without a path, query, or fragment.');
    }
    return url.origin;
  }

  if (platform === 'web') return 'http://localhost:3000';
  if (platform === 'android' && hostUri) {
    const host = String(hostUri).replace(/^(?:https?|exp):\/\//, '').split('/')[0].replace(/:\d+$/, '');
    if (host && !host.includes(' ')) return `http://${host}:3000`;
  }
  if (platform === 'android') return 'http://10.0.2.2:3000';
  return 'http://localhost:3000';
}

module.exports = { resolveApiBaseUrl };
