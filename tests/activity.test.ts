import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordActivity } from '../backend/activity';
import { Run } from '../backend/types';
const run = () => ({id:'run',status:'running',instructionIds:[],instructions:[],createdAt:'now',prompt:'',output:''} as Run);
test('activity retention is bounded and private reasoning is excluded', () => {
  const r=run();
  for(let i=0;i<510;i++) recordActivity(r,'item/completed',{item:{id:String(i),type:'agentMessage',text:'x'.repeat(31000)}});
  assert.equal(r.activity!.length,500);
  assert(r.activity!.reduce((n,e)=>n+e.text.length,0)<=200000);
  assert(r.activityTruncated);
  recordActivity(r,'item/completed',{item:{id:'reason',type:'reasoning',summary:['Public summary'],content:['PRIVATE']}});
  assert.equal(r.activity!.at(-1)!.text,'Public summary');
  assert.equal(recordActivity(r,'item/reasoning/textDelta',{itemId:'reason',delta:'PRIVATE'}),false);
  recordActivity(r,'item/agentMessage/delta',{itemId:'escaped',delta:'\x1b[31mred\x1b[0m\x00'});
  assert.equal(r.activity!.at(-1)!.text,'red');
  recordActivity(r,'item/completed',{item:{id:'tool-output',type:'functionCallOutput',output:[{type:'input_text',text:'Tool result'},{type:'encrypted_content',encrypted_content:'PRIVATE'}]}});
  assert.equal(r.activity!.at(-1)!.text,'Tool result');
});
test('invalid plans cannot replace a valid plan', () => {
  const r=run(); recordActivity(r,'turn/plan/updated',{plan:[{step:'Test',status:'pending'}]});
  assert.equal(recordActivity(r,'turn/plan/updated',{plan:[{step:'Test',status:'invented'}]}),false);
  assert.equal(r.plan![0].status,'pending');
});
