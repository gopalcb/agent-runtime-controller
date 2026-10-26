import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { get as httpGet } from 'node:http';
// Test compiled Nest decorators (tsx/esbuild does not emit parameter metadata).
const { createApplication } = require('../dist/main');
test('local HTTP API validates token, origin, body, persistence and real state', async () => {
  const root=mkdtempSync(join(tmpdir(),'visual-builder-http-'));
  const port=14319;const server=await createApplication({project:root,port});
  try {
    await server.app.listen(port,'127.0.0.1');const base=`http://127.0.0.1:${port}`;
    const landing=await fetch(base+'/',{redirect:'manual'});assert.equal(landing.status,302);assert.equal(landing.headers.get('location'),'/controller/agent-runtime');
    const bootstrap=await fetch(base+'/api/bootstrap');assert.equal(bootstrap.status,200);const data:any=await bootstrap.json();assert.equal(data.instructions.length,0);assert.equal(data.project.root,server.store.root);
    writeFileSync(join(root,'plan.md'),'# API document');
    const docsResponse=await fetch(base+'/api/documents',{headers:{'X-Project-Id':data.project.id}});
    assert.equal(docsResponse.status,200);assert.equal((await docsResponse.json() as any).documents[0].path,'plan.md');
    assert.equal((await (await fetch(base+'/api/documents/content?path=plan.md')).json() as any).content,'# API document');
    assert.equal((await fetch(base+'/api/documents/content?path=../secret.md')).status,400);
    assert.equal((await fetch(base+'/api/documents',{headers:{'X-Project-Id':'stale-project'}})).status,409);
    // Unlike fetch in this environment, raw HTTP sends the supplied Host header.
    const statusWithHeaders = (requestHeaders: Record<string, string>) =>
      new Promise<number | undefined>((resolve, reject) => {
        httpGet(base+'/api/state', {headers:requestHeaders}, response => {
          response.resume();
          resolve(response.statusCode);
        }).on('error', reject);
      });
    assert.equal(await statusWithHeaders({host:`localhost.runtime-controller:${port}`}),200);
    assert.equal(await statusWithHeaders({host:'localhost.runtime-controller:1001'}),200);

    // The extracted guard keeps browser-origin and project checks ahead of dispatch.
    for (const requestHeaders of [
      { host: 'attacker.example' },
      { origin: 'https://attacker.example' },
      { 'sec-fetch-site': 'cross-site' },
    ] as Record<string, string>[]) {
      assert.equal(await statusWithHeaders(requestHeaders), 403);
    }
    const allowed = await fetch(base+'/api/state', {
      headers:{origin:`http://localhost.runtime-controller:${port}`},
    });
    assert.equal(allowed.status,200);
    assert.equal(allowed.headers.get('cache-control'),'no-store');
    assert.match(allowed.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal((await fetch(base+'/api/state', {method:'HEAD'})).status,200);
    const body=JSON.stringify({title:'Test',description:'Draw header',rect:{x:0,y:0,width:100,height:50},viewport:{width:1000,height:800}});
    assert.equal((await fetch(base+'/api/instructions',{method:'POST',headers:{'content-type':'application/json'},body})).status,403);
    const headers={'content-type':'application/json','x-builder-token':data.token};
    assert.equal((await fetch(base+'/api/instructions',{method:'POST',headers:{...headers,'content-type':'text/plain'},body})).status,415);
    assert.equal((await fetch(base+'/api/execute',{method:'POST',headers,body:'{}'})).status,409);
    writeFileSync(join(root,'.codex','runtime-controller','install.json'),JSON.stringify({status:'completed',progress:100,steps:[],version:'0.2.0'}));
    assert.equal(data.settings.sandbox,'workspace-write');
    assert.equal(data.health.server.status,'ok'); assert.ok(Number.isFinite(data.health.memory.rssBytes));
    assert.ok(Array.isArray(data.approvals));
    assert.equal((await fetch(base+'/api/settings',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/settings',{method:'POST',headers,body:JSON.stringify({...data.settings,sandbox:'invalid'})})).status,400);
    const changedSettings={...data.settings,sandbox:'read-only',model:'test-model',reasoningEffort:'low'};
    const savedSettings=await fetch(base+'/api/settings',{method:'POST',headers,body:JSON.stringify(changedSettings)});
    assert.equal(savedSettings.status,200); assert.deepEqual(await savedSettings.json(),changedSettings);
    assert.deepEqual((await (await fetch(base+'/api/state')).json() as any).settings,changedSettings);
    assert.equal((await fetch(base+'/api/execute',{method:'POST',headers,body:JSON.stringify({instructionIds:['missing']})})).status,400);
    assert.ok((await fetch(base+'/api/approvals/missing',{method:'POST',headers,body:JSON.stringify({decision:'accept'})})).status >= 400);
    const urlBody=JSON.stringify({url:'http://localhost:4200/account?session=private'});
    assert.equal((await fetch(base+'/api/browser/url',{method:'POST',headers:{'content-type':'application/json'},body:urlBody})).status,403);
    assert.equal((await fetch(base+'/api/browser/url',{method:'POST',headers:{...headers,origin:'https://attacker.example'},body:urlBody})).status,403);
    for (const url of [undefined,'https://example.com','file:///etc/passwd','http://user:secret@localhost:3000']) {
      assert.equal((await fetch(base+'/api/browser/url',{method:'POST',headers,body:JSON.stringify({url})})).status,400);
    }
    // HTTP wiring must not launch a desktop browser in the API test process.
    const launch=server.liveBrowser.launch;const launched:unknown[]=[];
    server.liveBrowser.launch=async (url:unknown)=>{launched.push(url);return {open:true,url:'http://localhost:4200/account'};};
    try {
      const opened=await fetch(base+'/api/browser/url',{method:'POST',headers,body:urlBody});
      assert.equal(opened.status,200);assert.deepEqual(await opened.json(),{open:true,url:'http://localhost:4200/account'});
      assert.deepEqual(launched,['http://localhost:4200/account?session=private']);
    } finally {server.liveBrowser.launch=launch;}
    assert.equal((await fetch(base+'/api/instructions',{method:'POST',headers:{...headers,origin:'https://attacker.example'},body})).status,403);
    assert.equal((await fetch(base+'/api/instructions',{method:'POST',headers,body:'{}'})).status,400);
    const added=await fetch(base+'/api/instructions',{method:'POST',headers,body});assert.equal(added.status,201);const item:any=await added.json();
    const state:any=await (await fetch(base+'/api/state')).json();assert.equal(state.instructions[0].id,item.id);assert.equal(state.token,undefined);
    assert.equal((await fetch(base+'/api/instructions/'+item.id,{method:'DELETE',headers})).status,200);
    assert.equal((await fetch(base+'/api/execute',{method:'POST',headers,body:'{}'})).status,400);
    assert.equal((await fetch(base+'/api/unknown')).status,404);
  } finally {await server.close();rmSync(root,{recursive:true,force:true});}
});
