const base = account => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/ai`;
function credentials(account, token) {
  if (!/^[a-f0-9]{32}$/i.test(account) || !token) throw new Error('Укажите Account ID и API Token Cloudflare.');
}
async function request(url, token, options = {}, fetcher = fetch) {
  let response;
  try { response = await fetcher(url, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers } }); }
  catch { throw new Error('Нет соединения с Cloudflare. Проверьте интернет и ограничения CORS.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    const detail = Array.isArray(data.errors) ? data.errors.map(e => e.message).filter(Boolean).join('; ') : '';
    throw new Error(`Cloudflare: ${detail || `HTTP ${response.status}`}`);
  }
  return data;
}
export async function discoverCloudflareModels(account, token, fetcher = fetch) {
  credentials(account, token);
  const models = new Set();
  // The catalog is paginated. Search only text generation models usable in chat.
  for (let page = 1; page <= 20; page++) {
    const data = await request(`${base(account)}/models/search?task=${encodeURIComponent('Text Generation')}&per_page=100&page=${page}`, token, {}, fetcher);
    if (!Array.isArray(data.result)) throw new Error('Не удалось прочитать каталог моделей Cloudflare.');
    for (const model of data.result) if (typeof model.name === 'string' && model.name.startsWith('@')) models.add(model.name);
    const info = data.result_info;
    if (info && Number.isFinite(info.total_pages)) { if (page >= info.total_pages) break; }
    else if (data.result.length < 100) break;
    if (page === 20) throw new Error('Каталог слишком большой: не удалось загрузить все страницы.');
  }
  return [...models].sort((a, b) => a.localeCompare(b));
}
export async function testCloudflareModel(account, token, model, fetcher = fetch) {
  credentials(account, token);
  if (!model) throw new Error('Выберите модель.');
  const data = await request(`${base(account)}/v1/chat/completions`, token, {
    method: 'POST', headers: { 'content-type':'application/json' },
    body: JSON.stringify({ model, messages:[{role:'user',content:'Reply OK.'}], max_tokens:16, stream:false })
  }, fetcher);
  if (!data.choices?.[0]?.message?.content) throw new Error('Модель не вернула текстовый ответ.');
}
