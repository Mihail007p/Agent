import test from 'node:test';
import assert from 'node:assert/strict';
import { readAttachment, messageParts, MAX_ATTACHMENT_SIZE } from '../src/attachments.js';

test('text and images are converted into provider-specific message parts', async () => {
  const text = await readAttachment(new File(['Привет'], 'note.txt', { type: 'text/plain' }));
  const image = await readAttachment(new File([new Uint8Array([1,2,3])], 'screen.png', { type: 'image/png' }));
  const msg = { content:'Что здесь?', attachments:[text,image] };
  assert.match(messageParts(msg, 'openai')[0].text, /Привет/);
  assert.equal(messageParts(msg, 'openai')[1].image_url.url, 'data:image/png;base64,AQID');
  assert.equal(messageParts(msg, 'gemini')[1].inline_data.mime_type, 'image/png');
  assert.equal(messageParts(msg, 'anthropic')[1].source.data, 'AQID');
});

test('PDF is sent only to supported APIs', async () => {
  const pdf = await readAttachment(new File(['pdf'], 'doc.pdf', {type:'application/pdf'}));
  const msg = {content:'прочитай', attachments:[pdf]};
  assert.throws(() => messageParts(msg, 'cloudflare'), /PDF/);
  assert.equal(messageParts(msg, 'anthropic')[1].type, 'document');
  assert.equal(messageParts(msg, 'gemini')[1].inline_data.mime_type, 'application/pdf');
});

test('rejects unsupported binary and oversized files', async () => {
  await assert.rejects(readAttachment(new File([new Uint8Array([0, 255])], 'x.bin')), /двоичный/);
  await assert.rejects(readAttachment(new File([new Uint8Array(MAX_ATTACHMENT_SIZE + 1)], 'large.txt')), /1 МБ/);
});
