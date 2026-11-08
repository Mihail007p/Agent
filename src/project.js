import JSZip from 'jszip';

export const MAX_PROJECT_FILES = 30;

/** Only relative, portable paths are allowed inside a generated archive. */
export function safeProjectPath(input) {
  if (typeof input !== 'string') return null;
  const path = input.replace(/\\/g, '/').trim().replace(/^\.\//, '');
  if (!path || path.length > 240 || /[\x00-\x1f\x7f]/.test(path)) return null;
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return null;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*]/.test(part))) return null;
  return path;
}

export function projectArchiveName(name) {
  const slug = String(name || 'agent-project').normalize('NFKC')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 64);
  return `${slug || 'agent-project'}.zip`;
}

export function extractPlan(text, maxFiles = 16) {
  if (typeof text !== 'string') throw new Error('Модель не вернула текстовый план.');
  const clean = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try { parsed = JSON.parse(clean); } catch {
    const begin = clean.indexOf('{'), end = clean.lastIndexOf('}');
    if (begin < 0 || end <= begin) throw new Error('Не удалось прочитать план. Попробуйте модель с поддержкой JSON.');
    try { parsed = JSON.parse(clean.slice(begin, end + 1)); } catch {
      throw new Error('Модель вернула невалидный JSON-план. Попробуйте ещё раз.');
    }
  }
  if (!parsed || !Array.isArray(parsed.files)) throw new Error('Модель вернула план без списка файлов.');
  const limit = Math.max(1, Math.min(MAX_PROJECT_FILES, Number(maxFiles) || 16));
  const seen = new Set(), files = [];
  let skipped = 0;
  for (const file of parsed.files) {
    const path = safeProjectPath(file?.path);
    // Case-insensitive deduplication also avoids collisions when extracted on Windows/macOS.
    const key = path?.toLowerCase();
    if (!path || seen.has(key)) { skipped++; continue; }
    seen.add(key);
    if (files.length >= limit) { skipped++; continue; }
    files.push({ path, description: String(file.description || 'Реализуй файл согласно идее проекта.').slice(0, 1000) });
  }
  if (!files.length) throw new Error('В плане нет безопасных путей файлов.');
  return { projectName: String(parsed.projectName || 'agent-project').slice(0, 100), files, skipped };
}

/** Remove a wrapper only when it encloses the entire answer, not code fences in a README. */
export function unwrapGeneratedFile(text) {
  const clean = String(text).trim();
  const match = clean.match(/^```[\w+.-]*[ \t]*\r?\n([\s\S]*)\r?\n```$/);
  return match ? `${match[1]}\n` : String(text);
}

export function isFileReady(file) {
  return !file.error && typeof file.content === 'string';
}

export function readyFiles(files) {
  return files.filter(isFileReady);
}

/** Share exact existing implementations with the model, with an explicit bounded budget. */
export function fileContext(files, budget = 24000) {
  const blocks = [];
  let used = 0;
  for (const file of [...readyFiles(files)].reverse()) {
    const block = `Файл ${file.path}:\n${file.content}`;
    if (used + block.length > budget) continue;
    blocks.unshift(block);
    used += block.length;
  }
  return blocks.join('\n\n');
}

export async function createProjectZip(files) {
  const ready = readyFiles(files);
  if (!ready.length) throw new Error('Пока нет готовых файлов.');
  const zip = new JSZip();
  const seen = new Set();
  for (const file of ready) {
    const path = safeProjectPath(file.path);
    if (!path || seen.has(path.toLowerCase())) throw new Error('Обнаружен небезопасный или повторяющийся путь файла.');
    seen.add(path.toLowerCase());
    zip.file(path, file.content);
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', platform: 'UNIX' });
}

/** Chunk conversion avoids overflowing the call stack on large archives. */
export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)));
  }
  return btoa(chunks.join(''));
}
