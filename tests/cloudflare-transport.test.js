import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudflareFetch } from '../src/cloudflare-transport.js';

test('native transport sends requests without redirects and parses results', async () => {
  let options; const http={request:async o=>{options=o;return {status:200,data:{result:[]}}}};
  const res=await cloudflareFetch('https://api.cloudflare.com/client/v4/accounts/a/ai/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer secret'},body:'{"model":"test"}'},true,http);
  assert.equal(res.ok,true); assert.deepEqual(await res.json(),{result:[]});assert.equal(options.disableRedirects,true);assert.deepEqual(options.data,{model:'test'});
});
test('native transport rejects other origins and supports cancellation',async()=>{
  await assert.rejects(cloudflareFetch('https://evil.example/',{},true,{}),/Недопустимый/);
  const controller=new AbortController();const pending=cloudflareFetch('https://api.cloudflare.com/test',{signal:controller.signal},true,{request:()=>new Promise(()=>{})});controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
