import test from 'node:test';
import assert from 'node:assert/strict';
import { reviseProject } from '../src/project-revision.js';

test('revises ready files in sequence with updated project context', async () => {
  const files=[{path:'a.js',content:'old A'},{path:'b.js',content:'old B'},{path:'bad',error:true}];const prompts=[];
  const result=await reviseProject(files,'улучши',async prompt=>{prompts.push(prompt);return prompts.length===1?'new A':'new B'});
  assert.equal(result.done,2);assert.equal(files[0].content,'new A');assert.match(prompts[1],/new A/);assert.equal(files[2].error,true);
});
test('preserves original file on error or cancellation',async()=>{
  const files=[{path:'x',content:'original'}];const result=await reviseProject(files,'task',async()=>{throw new Error('offline')});
  assert.equal(result.error,'offline');assert.equal(files[0].content,'original');
  const controller=new AbortController();const stopped=await reviseProject(files,'task',async()=>{controller.abort();return 'replacement'},{signal:controller.signal});
  assert.equal(stopped.cancelled,true);assert.equal(files[0].content,'original');
});
