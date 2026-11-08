const API = 'https://api.github.com';
export async function githubGet(path, token, fetcher = fetch) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Некорректный путь GitHub API');
  let response;
  try { response = await fetcher(API + path, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28'.trim() } }); }
  catch { throw new Error('Не удалось подключиться к GitHub. Проверьте интернет.'); }
  if (!response.ok) throw new Error(`GitHub: ошибка ${response.status}. Проверьте токен и доступ к репозиторию.`);
  return response.json();
}
export async function listRepositories(token, fetcher) {
  return githubGet('/user/repos?sort=updated&per_page=100&type=all', token, fetcher);
}
export async function listContents(token, repo, path = '', fetcher) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split('/').some(part => part === '.' || part === '..')) throw new Error('Некорректное имя репозитория');
  if (path.split('/').some(part => part === '.' || part === '..')) throw new Error('Некорректный путь файла');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return githubGet(`/repos/${repo}/contents/${encoded}`, token, fetcher);
}
export function decodeGithubFile(file) {
  if (file.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string') throw new Error('GitHub не вернул содержимое файла.');
  if (file.size > 1024 * 1024) throw new Error('Файл слишком большой: максимум 1 МБ.');
  try {
    const binary = atob(file.content.replace(/\s/g, ''));
    const text = new TextDecoder('utf-8', {fatal:true}).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
    if (/[\x00-\x08\x0e-\x1f]/.test(text)) throw new Error();
    return text;
  } catch { throw new Error('Поддерживаются только текстовые файлы UTF-8.'); }
}
