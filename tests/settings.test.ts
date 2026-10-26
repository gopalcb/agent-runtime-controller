import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from '../backend/store';
import { Runtime } from '../backend/runtime';
import { Notice, ServerRequest } from '../backend/codex';
import { DEFAULT_SETTINGS, settings } from '../backend/settings';

const input = {title:'Header', description:'Update header',rect:{x:0,y:0,width:100,height:30},viewport:{width:800,height:600}};
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function fixture() {
  const root = mkdtempSync(join(tmpdir(),'builder-settings-')), store = new ProjectStore(root);
  const sessions: {notice:Notice; request:ServerRequest; disconnected:(reason:string)=>void; closed:boolean}[] = [];
  const calls: {method:string; params:any}[] = [];
  const runtime = new Runtime(store,(notice,disconnected,request)=>{
    const index=sessions.length,session={notice,request,disconnected,closed:false}; sessions.push(session);
    return {start:async()=>{},close:()=>{session.closed=true;},request:async(method,params)=>{
      calls.push({method,params});
      return method==='thread/start'?{thread:{id:`thread-${index}`}}:{turn:{id:`turn-${index}`}};
    }};
  });
  return {root,store,runtime,sessions,calls,cleanup:()=>{runtime.close();store.close();rmSync(root,{recursive:true,force:true});}};
}

test('old state migrates safe settings, full settings validate before persistence and survive restart',()=>{
  const f=fixture();try {
    const path=join(f.store.directory,'state.json');f.store.close();
    const legacy=JSON.parse(readFileSync(path,'utf8'));delete legacy.settings;writeFileSync(path,JSON.stringify(legacy));
    const reopened=new ProjectStore(f.root);
    try {
      assert.deepEqual(reopened.state.settings,DEFAULT_SETTINGS);
      const before=readFileSync(path,'utf8');
      for(const bad of [null,{}, {...DEFAULT_SETTINGS,approvalPolicy:'on-failure'}, {...DEFAULT_SETTINGS,sandbox:'host'}, {...DEFAULT_SETTINGS,networkAccess:'true'}, {...DEFAULT_SETTINGS,reasoningEffort:'arbitrary'}, {...DEFAULT_SETTINGS,model:'a\nsecret'}, {...DEFAULT_SETTINGS,extra:'oops'}, {...DEFAULT_SETTINGS,sandbox:'danger-full-access'}]) {
        assert.throws(()=>reopened.updateSettings(bad));assert.equal(readFileSync(path,'utf8'),before);
      }
      reopened.updateSettings({...DEFAULT_SETTINGS,sandbox:'read-only',approvalPolicy:'on-request',model:'gpt-example',reasoningEffort:'high'});
    } finally {reopened.close();}
    const again=new ProjectStore(f.root);assert.equal(again.state.settings.model,'gpt-example');again.close();
  }finally{f.cleanup();}
});

test('selection is validated without mutations and snapshots only selected todos with frozen future settings',async()=>{
  const f=fixture();try {
    const a=f.store.add(input),b=f.store.add({...input,title:'Other'}),done=f.store.add({...input,title:'Done'});done.status='completed';f.store.save();
    const before=JSON.stringify(f.store.state);
    for(const ids of [[],[a.id,a.id],['unknown'],[done.id],[2],null]) {
      assert.throws(()=>f.runtime.execute({instructionIds:ids}));assert.equal(JSON.stringify(f.store.state),before);assert.equal(f.sessions.length,0);
    }
    const original={...DEFAULT_SETTINGS,sandbox:'read-only' as const,approvalPolicy:'on-request' as const,model:'gpt-example',reasoningEffort:'high' as const,networkAccess:true};
    f.store.updateSettings(original);const run=f.runtime.execute({instructionIds:[b.id]});
    f.store.updateSettings({...DEFAULT_SETTINGS}); await tick();
    assert.deepEqual(run.instructionIds,[b.id]);assert.equal(a.status,'todo');assert.equal(b.status,'running');assert.deepEqual(run.settings,original);
    assert.equal(f.calls[0].params.sandbox,'read-only');assert.equal(f.calls[0].params.approvalsReviewer,'user');assert.equal(f.calls[0].params.model,'gpt-example');
    assert.deepEqual(f.calls[1].params.sandboxPolicy,{type:'readOnly',networkAccess:true});assert.equal(f.calls[1].params.effort,'high');assert.equal(f.calls[1].params.approvalPolicy,'on-request');
    f.sessions[0].notice('turn/completed',{threadId:run.threadId,turn:{status:'completed'}});
    const next=f.runtime.execute({instructionIds:[a.id]});await tick();assert.deepEqual(next.settings,DEFAULT_SETTINGS);
    assert.equal(f.calls[2].params.sandbox,'workspace-write');assert.deepEqual(f.calls[3].params.sandboxPolicy,{type:'workspaceWrite',writableRoots:[f.store.root],networkAccess:false,excludeTmpdirEnvVar:true,excludeSlashTmp:true});
  }finally{f.cleanup();}
});

test('full access transmits explicit broad policy only after valid selection',async()=>{
  const f=fixture();try {
    const a=f.store.add(input);f.store.updateSettings({...DEFAULT_SETTINGS,sandbox:'danger-full-access',networkAccess:true});
    f.runtime.execute({instructionIds:[a.id]});await tick();
    assert.equal(f.calls[0].params.sandbox,'danger-full-access');assert.deepEqual(f.calls[1].params.sandboxPolicy,{type:'dangerFullAccess'});
  }finally{f.cleanup();}
});

test('usage records maxima for duplicate, stale and terminal reports and persists across restart; missing stays absent',async()=>{
  const f=fixture();try {
    f.store.add(input);const run=f.runtime.execute({});await tick();assert.equal(run.tokenUsage,undefined);
    const report=(total:any,threadId=run.threadId)=>f.sessions[0].notice('thread/tokenUsage/updated',{threadId,tokenUsage:{total}});
    const usage={inputTokens:100,cachedInputTokens:20,outputTokens:30,reasoningOutputTokens:10,totalTokens:130};
    report(usage,'foreign');assert.equal(run.tokenUsage,undefined);report({...usage,totalTokens:-1});assert.equal(run.tokenUsage,undefined);
    report(usage);report(usage);report({...usage,inputTokens:80,totalTokens:110});report({...usage,outputTokens:90,totalTokens:120});report({...usage,outputTokens:100});assert.deepEqual(run.tokenUsage,usage);
    f.sessions[0].notice('turn/completed',{threadId:run.threadId,turn:{status:'completed'}});
    const later={...usage,inputTokens:120,totalTokens:150};report(later);assert.deepEqual(run.tokenUsage,later);
    f.store.close();const reopened=new ProjectStore(f.root);try{assert.deepEqual(reopened.state.runs[0].tokenUsage,later);}finally{reopened.close();}
  }finally{f.cleanup();}
});

test('approval decisions are one-shot, scoped to owned run and cleared on cancellation/disconnection',async()=>{
  const f=fixture();try {
    f.store.updateSettings({...DEFAULT_SETTINGS,approvalPolicy:'on-request'});f.store.add(input);const run=f.runtime.execute({});await tick();
    const params={threadId:run.threadId,turnId:run.turnId,itemId:'item',command:'echo test',reason:'permission',cwd:'/project'};
    await assert.rejects(f.sessions[0].request('item/commandExecution/requestApproval',{...params,threadId:'other'}));
    await assert.rejects(f.sessions[0].request('item/fileChange/requestApproval',{...params,grantRoot:'/outside'}));
    await assert.rejects(f.sessions[0].request('item/tool/requestUserInput',params));
    for(const decision of ['accept','decline'] as const) {
      const pending=f.sessions[0].request('item/commandExecution/requestApproval',params);const approval=f.runtime.approvals[0];
      assert.match(approval.description,/echo test/);assert.match(approval.description,/Working directory: \/project/);assert.equal(approval.runId,run.id);
      assert.throws(()=>f.runtime.respondApproval(approval.id,{decision:'acceptForSession'}));assert.equal(f.runtime.approvals.length,1);
      f.runtime.respondApproval(approval.id,{decision});assert.deepEqual(await pending,{decision});assert.throws(()=>f.runtime.respondApproval(approval.id,{decision}));
    }
    const file=f.sessions[0].request('item/fileChange/requestApproval',params);f.runtime.respondApproval(f.runtime.approvals[0].id,{decision:'accept'});assert.deepEqual(await file,{decision:'accept'});
    const waiting=f.sessions[0].request('item/commandExecution/requestApproval',params);const rejection=assert.rejects(waiting,/Run ended/);
    await f.runtime.cancel(run.id);await rejection;assert.deepEqual(f.runtime.approvals,[]);
    f.store.add(input);const next=f.runtime.execute({});await tick();
    const disconnectWait=f.sessions[1].request('item/fileChange/requestApproval',{...params,threadId:next.threadId,turnId:next.turnId});const disconnectRejection=assert.rejects(disconnectWait,/Run ended/);
    f.sessions[1].disconnected('lost');await disconnectRejection;assert.equal(next.status,'interrupted');assert.equal(f.runtime.approvals.length,0);
    assert.ok(!JSON.stringify(f.store.state.events).includes('echo test'));
  }finally{f.cleanup();}
});

test('never policy rejects approvals and request rejection events remain owned without threadId',async()=>{
  const f=fixture();try {
    f.store.add(input);const run=f.runtime.execute({});await tick();
    await assert.rejects(f.sessions[0].request('item/commandExecution/requestApproval',{threadId:run.threadId,turnId:run.turnId,itemId:'a'}));
    f.sessions[0].notice('request.rejected',{method:'item/tool/requestUserInput'});
    assert.equal(f.store.state.events.at(-1)?.runId,run.id);assert.equal(f.store.state.events.at(-1)?.type,'request.rejected');
  }finally{f.cleanup();}
});


test('explicit selection keeps saved work order even when selected IDs arrive reversed', async () => {
  const f = fixture();
  try {
    const first = f.store.add(input);
    const second = f.store.add({...input, title: 'Second'});
    const later = f.store.add({...input, title: 'Unselected'});
    const run = f.runtime.execute({instructionIds: [second.id, first.id]});
    await tick();

    assert.deepEqual(run.instructionIds, [first.id, second.id]);
    assert.deepEqual(run.instructions.map(item => item.title), ['Header', 'Second']);
    assert.equal(later.status, 'todo');
  } finally {
    f.cleanup();
  }
});
