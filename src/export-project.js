import { Capacitor } from '@capacitor/core';
import { blobToBase64, createProjectZip, projectArchiveName, readyFiles } from './project.js';

/**
 * Android WebView does not reliably download blob: links. Write a real cache file
 * and let Android's share sheet hand it to Files, Drive, or another destination.
 * The browser keeps its ordinary download behaviour and revokes the URL later.
 */
export async function exportProject(files, projectName) {
  const archive = await createProjectZip(files);
  const filename = projectArchiveName(projectName);
  const count = readyFiles(files).length;
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const path = `Agent/${filename}`;
    await Filesystem.writeFile({ path, directory: Directory.Cache, data: await blobToBase64(archive), recursive: true });
    const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
    await Share.share({ title: filename, files: [uri], dialogTitle: 'Сохранить или отправить ZIP' });
    return { count, native: true };
  }
  const url = URL.createObjectURL(archive);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { count, native: false };
}
