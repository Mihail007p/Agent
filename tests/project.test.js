import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { safeProjectPath, extractPlan, unwrapGeneratedFile, projectArchiveName, readyFiles, fileContext, createProjectZip, blobToBase64 } from '../src/project.js';

test('relative paths are accepted; traversal, absolute and control paths are rejected', () => {
  assert.equal(safeProjectPath('./src/app.js'), 'src/app.js');
  assert.equal(safeProjectPath('src\\app.js'), 'src/app.js');
  for (const path of ['../secret', '/etc/passwd', 'C:/secret', 'src/../../key', 'src//a', 'a\x00b', 'src/<bad>', '', null]) {
    assert.equal(safeProjectPath(path), null, String(path));
  }
});

test('plan parses JSON, deduplicates case-insensitively and enforces the selected bound', () => {
  const plan = extractPlan('```json\n' + JSON.stringify({ projectName: 'Finance', files: [
    { path: 'src/app.js', description: 'Application' }, { path: 'SRC/App.js' },
    { path: '../key' }, { path: 'README.md' }, { path: 'test.js' },
  ] }) + '\n```', 2);
  assert.equal(plan.projectName, 'Finance');
  assert.deepEqual(plan.files.map(f => f.path), ['src/app.js', 'README.md']);
  assert.equal(plan.skipped, 3);
  assert.throws(() => extractPlan('not json'), /план/);
  assert.throws(() => extractPlan('{"files":[]}'), /нет безопасных/);
  assert.throws(() => extractPlan('{}'), /без списка/);
  assert.throws(() => extractPlan('{"files":[{"path":"../x"}]}'), /безопасных/);
  assert.equal(extractPlan('{"files":[{"path":"a"}]}', 999).files.length, 1);
});

test('the hard limit cannot be exceeded', () => {
  const plan = extractPlan(JSON.stringify({ files: Array.from({ length: 40 }, (_, i) => ({ path: `file-${i}.js` })) }), 999);
  assert.equal(plan.files.length, 30);
  assert.equal(plan.skipped, 10);
});

test('only a complete outer code fence is removed', () => {
  assert.equal(unwrapGeneratedFile('```js\nconsole.log(1);\n```'), 'console.log(1);\n');
  const markdown = '# Guide\n\n```js\nconst x = 1;\n```\n';
  assert.equal(unwrapGeneratedFile(markdown), markdown);
  assert.equal(unwrapGeneratedFile(''), '');
});

test('empty valid files are retained but failed and pending files are excluded', () => {
  assert.deepEqual(readyFiles([{ path: '.gitkeep', content: '' }, { path: 'bad', content: '', error: true }, { path: 'next' }]).map(f => f.path), ['.gitkeep']);
});

test('generation context contains exact complete files within its budget', () => {
  const files = [{ path: 'a', content: 'a'.repeat(100) }, { path: 'b', content: 'b'.repeat(100) }, { path: 'c', content: 'export const value = 42;' }];
  const context = fileContext(files, 150);
  assert.ok(context.includes(files[2].content));
  assert.ok(context.includes(files[1].content));
  assert.ok(!context.includes(files[0].content));
  assert.ok(context.length <= 150);
});

test('archive preserves nested UTF-8 files and can be reopened', async () => {
  const files = [{ path: 'src/привет.txt', content: 'Привет, Agent!' }, { path: '.gitkeep', content: '' }, { path: 'failed.js', content: 'broken', error: true }];
  const blob = await createProjectZip(files);
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  assert.equal(await zip.file('src/привет.txt').async('string'), 'Привет, Agent!');
  assert.equal(zip.file('.gitkeep').name, '.gitkeep');
  assert.equal(zip.file('failed.js'), null);
  await assert.rejects(createProjectZip([{ path: '../key', content: 'secret' }]), /небезопасный/);
  await assert.rejects(createProjectZip([]), /нет готовых/);
});

test('base64 conversion works across chunk boundaries', async () => {
  const bytes = Uint8Array.from({ length: 20000 }, (_, i) => i % 256);
  const encoded = await blobToBase64(new Blob([bytes]));
  assert.deepEqual(new Uint8Array(atob(encoded).split('').map(c => c.charCodeAt(0))), bytes);
});

test('archive names cannot escape their destination', () => {
  assert.equal(projectArchiveName('../../secret'), 'secret.zip');
  assert.equal(projectArchiveName('Финансы'), 'Финансы.zip');
  assert.equal(projectArchiveName(''), 'agent-project.zip');
});
