import { Capacitor, CapacitorHttp } from '@capacitor/core';

// Native Android requests avoid WebView CORS restrictions. Never send credentials
// through the native bridge to another origin or follow redirects.
export async function cloudflareFetch(url, options = {}, native = Capacitor.isNativePlatform(), http = CapacitorHttp) {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://api.cloudflare.com' || parsed.username || parsed.password) throw new Error('Недопустимый адрес Cloudflare API.');
  if (!native) return fetch(url, options);
  const signal = options.signal;
  if (signal?.aborted) throw new DOMException('Запрос отменён', 'AbortError');
  let abort;
  const cancelled = new Promise((_, reject) => {
    abort = () => reject(new DOMException('Запрос отменён', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    const result = await Promise.race([http.request({
      url, method: options.method || 'GET', headers: options.headers,
      ...(options.body ? {data: JSON.parse(options.body)} : {}),
      disableRedirects: true, connectTimeout: 20000, readTimeout: 120000, responseType: 'json'
    }), cancelled]);
    return { ok: result.status >= 200 && result.status < 300, status: result.status,
      json: async () => typeof result.data === 'string' ? JSON.parse(result.data) : result.data };
  } finally { signal?.removeEventListener('abort', abort); }
}
