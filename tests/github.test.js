import test from 'node:test';
import assert from 'node:assert/strict';
import { githubGet, listContents, listRepositories, decodeGithubFile } from '../src/github.js';

test('requests GitHub with token and safely encoded file paths', async () => {
  const calls=[];
  const fake=async (url, options)=>{calls.push({url,options});return {ok:true,json:async()=>[]}};
  await listRepositories('secret',fake);
  await listContents('secret','owner/repo','folder/a b.txt',fake);
  assert.equal(calls[1].url,'https://api.github.com/repos/owner/repo/contents/folder/a%20b.txt');
  assert.equal(calls[0].options.headers.Authorization,'Bearer secret');
  await assert.rejects(githubGet('//evil.test', 'secret', fake));
  await assert.rejects(listContents('secret','../evil','',fake));
});
test('decodes text and rejects binary or oversized GitHub files', () => {
  assert.equal(decodeGithubFile({type:'file',encoding:'base64',content:'0J/RgNC40LLQtdGC',size:12}),'Привет');
  assert.throws(()=>decodeGithubFile({type:'file',encoding:'base64',content:'AA==',size:1}),/текстовые/);
  assert.throws(()=>decodeGithubFile({type:'file',encoding:'base64',content:'',size:1048577}),/большой/);
});
test('GitHub errors do not expose token', async () => {
  await assert.rejects(githubGet('/user','secret',async()=>({ok:false,status:401})), e=>e.message.includes('401')&&!e.message.includes('secret'));
});
