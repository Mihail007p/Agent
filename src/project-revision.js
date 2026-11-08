import { fileContext, isFileReady, unwrapGeneratedFile } from './project.js';

// Replace a file only after its complete revision succeeds, preserving partial work.
export async function reviseProject(files, instruction, request, { signal, onProgress = () => {} } = {}) {
  const eligible = files.filter(isFileReady);
  let done = 0;
  for (const file of eligible) {
    if (signal?.aborted) break;
    onProgress({ path: file.path, done, total: eligible.length });
    const context = fileContext(files.filter(f => f !== file), 24000);
    const prompt = `Задача: ${instruction}\n\nРедактируй файл ${file.path}. Верни его полное содержимое. Если изменения не нужны, верни файл без изменений.\n\nТекущий файл:\n${file.content}\n\nДругие файлы проекта (часть файлов может быть опущена):\n${context}`;
    try {
      const content = await request(prompt, signal);
      if (signal?.aborted) break;
      if (typeof content !== 'string' || !content.trim()) throw new Error('Модель вернула пустой ответ');
      file.content = unwrapGeneratedFile(content);
      done++;
    } catch (error) {
      if (signal?.aborted) break;
      return { done, total: eligible.length, error: error.message };
    }
  }
  return { done, total: eligible.length, cancelled: !!signal?.aborted };
}
