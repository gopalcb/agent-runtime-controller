import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DocumentSearch } from '../backend/document-search';
import { Notice } from '../backend/codex';

function fixture(reply = '{"paths":["docs/release.md","README.md","../secret.md","docs/release.md"]}', wait = false) {
  const root = mkdtempSync(join(tmpdir(), 'document-search-test-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'README.md'), '# Setup\nInstall dependencies');
  writeFileSync(join(root, 'docs/release.md'), '# Release\nPublish a tested artifact');
  const calls: {method: string; params: any}[] = [];
  let closed = false, cwd = '', notice!: Notice;
  const service = new DocumentSearch(root, (directory, handler) => {
    cwd = directory; notice = handler;
    return { async start() {}, close() { closed = true; }, async request(method, params) {
      calls.push({method, params});
      if (method === 'model/list') return {data:[{model:'gpt-6-luna',supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
      if (method === 'thread/start') return {thread:{id:'search'}};
      if (!wait) queueMicrotask(() => {
        handler('item/completed', {threadId:'unrelated',item:{type:'agentMessage',text:'bad'}});
        handler('item/completed', {threadId:'search',item:{type:'agentMessage',text:reply}});
        handler('turn/completed', {threadId:'search',turn:{status:'completed'}});
      });
      return {turn:{id:'turn'}};
    }};
  }, wait ? 80 : 1000, 20);
  return {root, service, calls, get closed(){return closed;}, get cwd(){return cwd;},
    get notice(){return notice;}, async close(){await service.close();rmSync(root,{recursive:true,force:true});}};
}

test('semantic search passes content index to isolated lightweight thread and validates ordered references', async () => {
  const f = fixture();
  try {
    const result = await f.service.search('how can I ship this software?');
    assert.deepEqual(result.documents.map(d=>d.path), ['docs/release.md','README.md']);
    const thread = f.calls.find(c=>c.method==='thread/start')!.params, turn = f.calls.find(c=>c.method==='turn/start')!.params;
    assert.equal(thread.model,process.env.RUNTIME_CONTROLLER_SEARCH_MODEL || 'gpt-6-luna');
    assert.equal(thread.sandbox,'read-only'); assert.equal(thread.approvalPolicy,'never');
    assert.equal(thread.config['features.shell_tool'],false); assert.equal(turn.effort,'low');
    assert.notEqual(thread.cwd,f.root); assert.equal(thread.ephemeral,true);
    const input = JSON.parse(turn.input[0].text);
    assert.equal(input.query,'how can I ship this software?');
    assert.match(input.index.documents.find((d:any)=>d.path==='docs/release.md').excerpt,/Publish a tested artifact/);
    assert.equal(f.closed,true); assert.equal(existsSync(f.cwd),false);
  } finally { await f.close(); }
});

test('watcher reconciles create/edit/delete, excludes private and linked files, bounds excerpts', async () => {
  const f = fixture();
  try {
    await f.service.refresh();
    const indexPath = join(f.root,'.codex/runtime-controller/documents-index.json');
    writeFileSync(join(f.root,'docs/new.md'),'# New topic\n'+'x'.repeat(10000));
    writeFileSync(join(f.root,'README.md'),'# Changed content');
    rmSync(join(f.root,'docs/release.md'));
    symlinkSync(join(f.root,'README.md'),join(f.root,'docs/link.md'));
    mkdirSync(join(f.root,'.codex/private'));writeFileSync(join(f.root,'.codex/private/secret.md'),'secret');
    for(let i=0;i<100;i++) {
      const index = JSON.parse(readFileSync(indexPath,'utf8'));
      if(index.documents.some((d:any)=>d.path==='docs/new.md')) break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    const index=JSON.parse(readFileSync(indexPath,'utf8'));
    assert.deepEqual(index.documents.map((d:any)=>d.path).sort(),['README.md','docs/new.md']);
    assert.match(index.documents.find((d:any)=>d.path==='README.md').excerpt,/Changed content/);
    assert.ok(index.documents.every((d:any)=>d.excerpt.length<=4000));
  } finally {await f.close();}
});

test('malformed output, timeout, concurrent search and cancellation fail cleanly', async () => {
  for(const reply of ['not JSON','{"paths":[7]}']) {
    const f=fixture(reply);
    try {await assert.rejects(f.service.search('release')); assert.equal(f.closed,true);}
    finally {await f.close();}
  }
  const f=fixture('',true);
  try {
    const pending=f.service.search('release');
    await assert.rejects(f.service.search('other'),/already running/);
    await assert.rejects(pending,/timed out/);
    assert.equal(f.closed,true);assert.equal(existsSync(f.cwd),false);
    const cancelled=f.service.search('release');
    await new Promise(resolve=>setTimeout(resolve,10));
    await f.service.close(); await assert.rejects(cancelled,/cancelled|Project changed/);
    await assert.rejects(f.service.refresh(),/Project changed/);
  } finally {await f.close();}
});

test('invalid queries never dispatch and unsafe index destination cannot overwrite a file', async () => {
  const f=fixture();
  try {
    for(const value of ['',null,'x'.repeat(1001)]) await assert.rejects(f.service.search(value));
    assert.equal(f.calls.length,0);
    mkdirSync(join(f.root,'.codex/runtime-controller'),{recursive:true});
    symlinkSync(join(f.root,'README.md'),join(f.root,'.codex/runtime-controller/documents-index.json'));
    await assert.rejects(f.service.refresh(),/Unsafe/);
    assert.equal(readFileSync(join(f.root,'README.md'),'utf8'),'# Setup\nInstall dependencies');
  } finally {await f.close();}
});

test('empty index skips Codex and deleted references are removed before display', async () => {
  const f=fixture('',true);
  try {
    const pending=f.service.search('release');
    for(let i=0;i<50&&!f.calls.some(call=>call.method==='turn/start');i++) await new Promise(resolve=>setTimeout(resolve,1));
    rmSync(join(f.root,'docs/release.md'));
    f.notice('item/completed',{threadId:'search',item:{type:'agentMessage',text:'{"paths":["docs/release.md"]}'}});
    f.notice('turn/completed',{threadId:'search',turn:{status:'completed'}});
    assert.deepEqual((await pending).documents,[]);
    rmSync(join(f.root,'README.md'));
    const count=f.calls.length;
    assert.deepEqual((await f.service.search('anything')).documents,[]);
    assert.equal(f.calls.length,count);
  } finally {await f.close();}
});

test('project switching cancels search and stops the old index watcher', async () => {
  const {Projects}=await import('../backend/projects');
  const f=fixture('',true), other=mkdtempSync(join(tmpdir(),'document-search-other-'));
  const projects=new Projects(f.root,'http://127.0.0.1:14319');
  projects.session.documents=f.service;
  try {
    const pending=f.service.search('release');
    const rejected=assert.rejects(pending,/cancelled|Project changed/);
    for(let i=0;i<50&&!f.calls.length;i++) await new Promise(resolve=>setTimeout(resolve,1));
    await projects.switch(other); await rejected;
    assert.equal(f.closed,true);
    await assert.rejects(f.service.refresh(),/Project changed/);
    assert.equal(projects.session.store.root,realpathSync(other));
  } finally {await projects.close();await f.close();rmSync(other,{recursive:true,force:true});}
});

test('catalog default, pagination, explicit override and useful model failures', async () => {
  const saved = process.env.RUNTIME_CONTROLLER_SEARCH_MODEL;
  const root = mkdtempSync(join(tmpdir(), 'search-model-selection-'));
  writeFileSync(join(root, 'README.md'), '# Release\nPublish an artifact');
  try {
    for (const scenario of ['default', 'pagination', 'override', 'error', 'failed-turn', 'missing']) {
      delete process.env.RUNTIME_CONTROLLER_SEARCH_MODEL;
      if (scenario === 'override') process.env.RUNTIME_CONTROLLER_SEARCH_MODEL = 'explicit-model';
      let selected = '', pages = 0;
      const service = new DocumentSearch(root, (_cwd, handler) => ({
        async start() {}, close() {},
        async request(method, params) {
          if (method === 'model/list') {
            pages++;
            if (scenario === 'pagination' && !params.cursor) return {data:[],nextCursor:'page2'};
            return {data:scenario === 'missing' ? [] : [{model:'account-default',isDefault:true,
              supportedReasoningEfforts:[{reasoningEffort:'low'}]}]};
          }
          if (method === 'thread/start') { selected=params.model;return {thread:{id:'search'}}; }
          queueMicrotask(() => {
            const error = {message:JSON.stringify({error:{message:'This model is not supported by your account'}})};
            if (scenario === 'error') handler('error',{threadId:'search',error,willRetry:false});
            else if (scenario === 'failed-turn') handler('turn/completed',{threadId:'search',turn:{status:'failed',error}});
            else {
              handler('error',{threadId:'search',error:{message:'Retrying transient error'},willRetry:true});
              handler('item/completed',{threadId:'search',item:{type:'agentMessage',text:'{"paths":["README.md"]}'}});
              handler('turn/completed',{threadId:'search',turn:{status:'completed'}});
            }
          });
          return {turn:{id:'turn'}};
        },
      }));
      try {
        if (scenario === 'missing') await assert.rejects(service.search('ship'), /No default search model/);
        else if (['error','failed-turn'].includes(scenario)) await assert.rejects(service.search('ship'), /This model is not supported by your account/);
        else assert.equal((await service.search('ship')).documents[0].path,'README.md');
        if (scenario !== 'missing') assert.equal(selected,scenario === 'override' ? 'explicit-model' : 'account-default');
        assert.equal(pages,scenario === 'override' ? 0 : scenario === 'pagination' ? 2 : 1);
      } finally {await service.close();}
    }
  } finally {
    if (saved === undefined) delete process.env.RUNTIME_CONTROLLER_SEARCH_MODEL;
    else process.env.RUNTIME_CONTROLLER_SEARCH_MODEL=saved;
    rmSync(root,{recursive:true,force:true});
  }
});
