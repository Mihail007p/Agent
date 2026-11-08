// Keep attachments small enough for local chat storage and JSON requests.
export const MAX_ATTACHMENT_SIZE = 1024 * 1024;
export const MAX_ATTACHMENTS = 4;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export async function readAttachment(file) {
  if (file.size > MAX_ATTACHMENT_SIZE) throw new Error(`${file.name}: максимум 1 МБ на файл`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = (file.type || '').toLowerCase();
  if (IMAGE_TYPES.includes(type) || type === 'application/pdf') {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { name: file.name, type, data: btoa(binary), kind: type === 'application/pdf' ? 'pdf' : 'image' };
  }
  // Do not silently send arbitrary binary data as if it were readable text.
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error();
    return { name: file.name, type: type || 'text/plain', text, kind: 'text' };
  } catch { throw new Error(`${file.name}: двоичный формат не поддерживается. Отправьте текст, PDF или изображение JPEG, PNG, GIF, WebP.`); }
}

export function messageParts(message, mode) {
  const attachments = message.attachments || [];
  let text = message.content || '';
  for (const file of attachments.filter(f => f.kind === 'text')) text += `\n\nФайл ${file.name}:\n${file.text}`;
  const media = attachments.filter(f => f.kind !== 'text');
  if (media.some(f => f.kind === 'pdf') && !['gemini', 'anthropic'].includes(mode)) throw new Error('PDF поддерживается только через Gemini или Anthropic. Выберите совместимую модель.');
  if (!media.length) return mode === 'gemini' ? [{ text }] : text;
  if (mode === 'gemini') return [{ text }, ...media.map(f => ({ inline_data: { mime_type: f.type, data: f.data } }))];
  if (mode === 'anthropic') return [{ type:'text', text: text || 'Проанализируй вложения.' }, ...media.map(f => ({ type: f.kind === 'pdf' ? 'document' : 'image', source: { type:'base64', media_type:f.type, data:f.data } }))];
  return [{ type:'text', text: text || 'Проанализируй вложения.' }, ...media.map(f => ({ type:'image_url', image_url:{ url:`data:${f.type};base64,${f.data}` } }))];
}
