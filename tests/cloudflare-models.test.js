import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverCloudflareModels, testCloudflareModel } from '../src/cloudflare-models.js';
const account='a'.repeat(32), token='secret';
test('discovers, deduplicates and sorts paginated catalog models',async()=>{
  const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({success:true,result:calls.length===1?[{name:'@cf/z'},{name:'@cf/a'}]:[{name:'@cf/a'},{name:'@cf/b'}],result_info:{total_pages:2}})}};
  assert.deepEqual(await discoverCloudflareModels(account,token,fetcher),['@cf/a','@cf/b','@cf/z']);
  assert.match(calls[0].url,/task=Text%20Generation/);assert.match(calls[1].url,/page=2/);assert.equal(calls[0].options.headers.authorization,'Bearer secret');
});
test('reports errors without claiming models work',async()=>{
  await assert.rejects(discoverCloudflareModels(account,token,async()=>({ok:false,status:403,json:async()=>({errors:[{message:'forbidden'}]})})),/forbidden/);
  await assert.rejects(discoverCloudflareModels('bad',token),/Account ID/);
  await assert.rejects(testCloudflareModel(account,token,'@cf/a',async()=>({ok:true,json:async()=>({choices:[]})})),/не вернула/);
});
test('model test sends a short inference request',async()=>{
  let call;await testCloudflareModel(account,token,'@cf/a',async(url,options)=>{call={url,options};return {ok:true,json:async()=>({choices:[{message:{content:'OK'}}]})}});
  assert.match(call.url,/ai\/v1\/chat\/completions$/);assert.equal(JSON.parse(call.options.body).max_tokens,16);
});

test('verification keeps only successful models and respects cancellation',async()=>{
  const {verifyCloudflareModels}=await import('../src/cloudflare-models.js');
  const progress=[];const result=await verifyCloudflareModels(['@ok','@error','@ok2'],async model=>{if(model==='@error')throw new Error('busy')},{onProgress:p=>progress.push(p)});
  assert.deepEqual(result.verified,['@ok','@ok2']);assert.equal(result.failed,1);assert.equal(progress.at(-1).checked,3);
  const controller=new AbortController();const stopped=await verifyCloudflareModels(['a','b'],async()=>{controller.abort()},{signal:controller.signal});assert.deepEqual(stopped.verified,[]);assert.equal(stopped.cancelled,true);
});
