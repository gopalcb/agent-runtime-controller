import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../backend/store';
import { Runtime } from '../backend/runtime';
import { Notice, Transport } from '../backend/codex';
const input = {title: 'Header', description: 'Build a dark shiny header', rect: {x: 10, y: 20, width: 900, height: 64}, viewport: {width: 1440, height: 900}};
const temp = () => mkdtempSync(join(tmpdir(), 'visual-builder-test-'));
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('project persistence, namespace preservation, exclusive ownership and geometry validation', () => {
  const root = temp(); mkdirSync(join(root, '.codex')); writeFileSync(join(root, '.codex', 'config.toml'), 'model = "existing"');
  const store = new ProjectStore(root);
  try {
    const item = store.add(input);
    assert.equal(item.status, 'todo'); assert.throws(() => new ProjectStore(root), /already owns/);
    for (const bad of [{...input, title:''}, {...input, rect:{...input.rect, width: 2}}, {...input, rect:{...input.rect, x:-2}}, {...input, rect:{...input.rect,width:2000}}, {...input, viewport:{width:NaN,height:900}}]) assert.throws(() => store.add(bad));
    store.close(); const reopened = new ProjectStore(root);
    assert.equal(reopened.state.instructions[0].id, item.id); reopened.close();
    assert.equal(readFileSync(join(root,'.codex','config.toml'),'utf8'), 'model = "existing"');
  } finally { store.close(); rmSync(root, {recursive:true,force:true}); }
});

test('symlinked state directories and files are refused', () => {
  const root = temp(), outside = temp(); symlinkSync(outside, join(root,'.codex'));
  try { assert.throws(() => new ProjectStore(root), /unsafe/); }
  finally {rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
  const root2 = temp(); const store = new ProjectStore(root2); store.close();
  const path = join(root2,'.codex','visual-builder','state.json'); rmSync(path); symlinkSync(join(root2,'untouched'),path); writeFileSync(join(root2,'untouched'),'outside');
  try { assert.throws(() => new ProjectStore(root2), /unsafe/); assert.equal(readFileSync(join(root2,'untouched'),'utf8'),'outside'); }
  finally {rmSync(root2,{recursive:true,force:true});}
});

function fixture(failTurn = false) {
  const root = temp(), store = new ProjectStore(root); let notice: Notice = () => {}; let disconnected = (_s:string) => {};
  const calls: {method:string;params:any}[] = [];
  const runtime = new Runtime(store, (n,d): Transport => { notice=n;disconnected=d; return {start:async()=>{},close:()=>{},request:async(method,params)=>{calls.push({method,params}); if(method==='thread/start') return {thread:{id:'thread-1'}}; if (method==='turn/start' && failTurn) throw new Error('uncertain timeout'); return {turn:{id:'turn-1'}};}}; });
  return {root,store,runtime,calls,notice:(m:string,p:any)=>notice(m,p),disconnect:()=>disconnected('connection lost'),cleanup:()=>{runtime.close();store.close();rmSync(root,{recursive:true,force:true});}};
}
test('one execution snapshots todos, pins sandbox and follows actual completion',async()=>{
  const f=fixture(); try {
    assert.throws(()=>f.runtime.execute({}),/at least one/); f.store.add({...input, source:{kind:'element',url:'http://localhost:4200/page?secret=omitted',selector:'#header',tag:'header',text:'Header',html:'<header id="header">Header</header>',styles:{display:'flex'},scroll:{x:0,y:0}}});
    const run=f.runtime.execute({prompt:'Use Angular and NestJS'});
    assert.throws(()=>f.runtime.execute({}),/already active/); assert.throws(()=>f.store.remove(run.instructionIds[0]),/running/);
    await tick(); assert.equal(run.status,'running');
    assert.equal(f.calls[0].params.cwd,f.store.root);assert.equal(f.calls[0].params.sandbox,'workspace-write');
    assert.equal(run.instructions[0].source?.selector,'#header'); assert.equal(run.instructions[0].source?.url,'http://localhost:4200/page'); assert.match(f.calls[1].params.input[0].text, /#header/);
    assert.deepEqual(f.calls[1].params.sandboxPolicy.writableRoots,[f.store.root]);assert.equal(f.calls[1].params.sandboxPolicy.networkAccess,false);
    f.store.add({...input,title:'Later'}); assert.equal(run.instructions.length,1);
    f.notice('turn/completed',{threadId:'other-thread',turn:{status:'completed'}});assert.equal(run.status,'running');
    f.notice('item/completed',{threadId:'thread-1',item:{type:'agentMessage',text:'Implemented'}});
    f.notice('turn/completed',{threadId:'thread-1',turn:{status:'completed'}});
    assert.equal(run.status,'completed'); assert.equal(f.store.state.instructions[0].status,'completed');assert.equal(f.store.state.instructions[1].status,'todo');assert.match(run.output,/Implemented/);
  }finally{f.cleanup();}
});
test('uncertain dispatch never retries or reports success',async()=>{
  const f=fixture(true);try{f.store.add(input);const run=f.runtime.execute({});await tick();assert.equal(run.status,'interrupted');assert.equal(f.calls.filter(c=>c.method==='turn/start').length,1);assert.equal(f.store.state.instructions[0].status,'failed');}finally{f.cleanup();}
});
test('disconnect, cancellation and restart retain truthful terminal states',async()=>{
  const f=fixture();try{f.store.add(input);const run=f.runtime.execute({});await tick();f.disconnect();assert.equal(run.status,'interrupted');f.store.add(input);const next=f.runtime.execute({});await tick();await f.runtime.cancel(next.id);assert.equal(next.status,'cancelled');assert.equal(f.calls.at(-1)?.method,'turn/interrupt');}finally{f.cleanup();}
  const root=temp();const store=new ProjectStore(root);const item=store.add(input);item.status='running';store.state.runs.push({id:'r',status:'running',activity:[{id:'cmd',time:'now',kind:'commandExecution',title:'test',text:'running',status:'inProgress'}],instructionIds:[item.id],instructions:[item],createdAt:new Date().toISOString(),prompt:'',output:''});store.save();store.close();const recovered=new ProjectStore(root);assert.equal(recovered.state.runs[0].status,'interrupted');assert.equal(recovered.state.runs[0].activity![0].status,'interrupted');assert.equal(recovered.state.instructions[0].status,'failed');recovered.close();rmSync(root,{recursive:true,force:true});
});

test('late cancellation response cannot close a subsequent run transport', async () => {
  const root=temp(),store=new ProjectStore(root);let release:()=>void=()=>{};
  const instances:{notice:Notice;closed:boolean}[]=[];
  const runtime=new Runtime(store,(notice)=>{
    const index=instances.length;const instance={notice,closed:false};instances.push(instance);
    return {start:async()=>{},close:()=>{instance.closed=true;},request:async(method)=>{
      if(method==='thread/start')return {thread:{id:`thread-${index}`}};
      if(method==='turn/interrupt') {await new Promise<void>(resolve=>{release=resolve;});return {};}
      return {turn:{id:`turn-${index}`}};
    }};
  });
  try {
    store.add(input);const first=runtime.execute({});await tick();const cancellation=runtime.cancel(first.id);
    instances[0].notice('turn/completed',{threadId:'thread-0',turn:{status:'interrupted'}});
    store.add(input);const second=runtime.execute({});await tick();release();await cancellation;
    assert.equal(second.status,'running');assert.equal(instances[1].closed,false);
  }finally{runtime.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('stale lock requires explicit recovery instead of racing another owner', () => {
  const root=temp();mkdirSync(join(root,'.codex','visual-builder'),{recursive:true});
  const lock=join(root,'.codex','visual-builder','owner.lock');const content=JSON.stringify({pid:2147483647,id:'stale'});writeFileSync(lock,content);
  try{assert.throws(()=>new ProjectStore(root),/Stale builder lock/);assert.equal(readFileSync(lock,'utf8'),content);}finally{rmSync(root,{recursive:true,force:true});}
});

test('activity streams commands, messages, edits and plans without duplicate final output', async () => {
  const f = fixture();
  try {
    f.store.add(input); const run = f.runtime.execute({}); await tick();
    const emit = (method: string, params: any) => f.notice(method, {threadId: 'thread-1', turnId: 'turn-1', ...params});
    emit('turn/plan/updated', {plan: [{step:'Inspect',status:'completed'},{step:'Implement',status:'inProgress'},{step:'Verify',status:'pending'}]});
    emit('item/started', {item:{id:'command',type:'commandExecution',command:'npm test',cwd:'/fixture'}});
    emit('item/commandExecution/outputDelta', {itemId:'command',delta:'first\n'});
    emit('item/commandExecution/outputDelta', {itemId:'command',delta:'second\n'});
    assert.equal(run.activity![0].text,'first\nsecond\n');
    emit('item/completed', {item:{id:'command',type:'commandExecution',command:'npm test',aggregatedOutput:'first\nsecond\n',exitCode:0,status:'completed'}});
    emit('item/agentMessage/delta',{itemId:'message',delta:'Hello '});
    emit('item/agentMessage/delta',{itemId:'message',delta:'world'});
    emit('item/completed',{item:{id:'message',type:'agentMessage',text:'Hello world'}});
    emit('item/completed',{item:{id:'message',type:'agentMessage',text:'Hello world'}});
    assert.equal(run.output,'Hello world\n'); assert.equal(run.activity!.length,2);
    emit('item/completed',{item:{id:'edit',type:'fileChange',status:'completed',changes:[{path:'src/app.ts',kind:{type:'update'},diff:'+ added'}]}});
    assert.match(run.activity![2].text,/src\/app.ts\n\+ added/);
    emit('item/mcpToolCall/progress',{itemId:'tool',message:'Reading docs'});
    emit('item/agentMessage/delta',{threadId:'other',itemId:'bad',delta:'wrong project'});
    emit('item/agentMessage/delta',{turnId:'other',itemId:'bad',delta:'wrong turn'});
    assert.equal(run.activity!.length,4);
    emit('turn/completed',{turn:{id:'turn-1',status:'completed'}});
    assert.equal(run.activity![3].status,'interrupted');
    assert.equal(run.plan![1].status,'inProgress'); // Never fabricate completion.
    emit('item/agentMessage/delta',{itemId:'late',delta:'late'});
    assert.equal(run.activity!.length,4);
    const persisted=JSON.parse(readFileSync(join(f.root,'.codex','visual-builder','state.json'),'utf8'));
    assert.deepEqual(persisted.runs[0].activity,run.activity);
  } finally {f.cleanup();}
});
