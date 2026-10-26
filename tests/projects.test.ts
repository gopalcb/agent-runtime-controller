import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const {createApplication}=require('../dist/main');
const item={title:'Project A only',description:'Keep this project isolated',rect:{x:0,y:0,width:100,height:50},viewport:{width:1000,height:800}};
test('project switching isolates state/settings, rotates tokens, rejects stale tabs and preserves active session on failure',async()=>{
 const a=mkdtempSync(join(tmpdir(),'controller-a-')),b=mkdtempSync(join(tmpdir(),'controller-b-'));const server=await createApplication({project:a,port:14331});
 try{
  await server.app.listen(14331,'127.0.0.1');const base='http://127.0.0.1:14331/api';let data:any=await (await fetch(base+'/bootstrap')).json();const first=data;
  const post=(path:string,body:any,session=data)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-builder-token':session.token,'x-project-id':session.project.id},body:JSON.stringify(body)});
  assert.equal((await post('/instructions',item)).status,201);
  assert.equal((await post('/projects/register',{path:b})).status,200);assert.equal(existsSync(join(b,'.codex')),false);
  const folders:any=await (await fetch(base+'/projects/folders?path='+encodeURIComponent(a))).json();assert.equal(folders.path,server.store.root);assert.ok(Array.isArray(folders.folders));
  const switched=await post('/projects/switch',{path:b});assert.equal(switched.status,200);data=await switched.json();assert.notEqual(data.token,first.token);assert.notEqual(data.project.id,first.project.id);assert.equal(data.instructions.length,0);
  assert.equal((await fetch(base+'/state',{headers:{'x-project-id':first.project.id}})).status,409);
  assert.equal((await post('/instructions',item,first)).status,409);
  assert.equal((await fetch(base+'/instructions',{method:'POST',headers:{'content-type':'application/json','x-builder-token':first.token},body:JSON.stringify(item)})).status,403);
  assert.equal((await post('/settings',{...data.settings,model:'project-b-model'})).status,200);
  const back=await post('/projects/switch',{path:a});data=await back.json();assert.equal(data.instructions.length,1);assert.equal(data.settings.model,'');
  assert.equal((await post('/projects/switch',{path:join(a,'missing')})).status,400);assert.equal(server.store.root,first.project.root);
  server.store.state.runs.unshift({id:'active-fixture',status:'running',instructionIds:[],instructions:[],createdAt:new Date().toISOString(),prompt:'',output:''});
  assert.equal((await post('/projects/switch',{path:b})).status,409);server.store.state.runs.shift();
  for(const path of ['/controller/agent-runtime','/controller/history','/controller/settings','/controller/observability','/controller/install','/controller/canvas'])assert.equal((await fetch('http://127.0.0.1:14331'+path)).status,200);
 }finally{await server.close();rmSync(a,{recursive:true,force:true});rmSync(b,{recursive:true,force:true});}
});
test('real Python installation is observable, gates execution and preserves work and edited files on reset',async()=>{
 const root=mkdtempSync(join(tmpdir(),'controller-install-api-')),other=mkdtempSync(join(tmpdir(),'controller-other-'));const server=await createApplication({project:root,port:14332});
 try{
  await server.app.listen(14332,'127.0.0.1');const base='http://127.0.0.1:14332/api',data:any=await(await fetch(base+'/bootstrap')).json(),headers={'content-type':'application/json','x-builder-token':data.token,'x-project-id':data.project.id};
  const post=(path:string,body:any)=>fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal(data.installation.status,'not-installed');assert.equal((await post('/execute',{})).status,409);assert.equal((await post('/install',{action:'reset'})).status,409);
  assert.equal((await post('/instructions',item)).status,201);
  assert.equal((await post('/install',{action:'install'})).status,202);
  assert.equal((await post('/projects/switch',{path:other})).status,409);
  const wait=async(status:string)=>{for(let i=0;i<300;i++){const d:any=await(await fetch(base+'/state')).json();if(d.installation.status==='failed')assert.fail(d.installation.error);if(d.installation.status===status&&!server.installation.running)return d;await new Promise(r=>setTimeout(r,100));}assert.fail('Installer did not finish');};
  const installed=await wait('completed');assert.equal(installed.installation.progress,100);assert.ok(existsSync(join(root,'.codex','AGENTS.md')));assert.ok(existsSync(join(root,'.agents','skills','plan-development','SKILL.md')));
  writeFileSync(join(root,'.codex','AGENTS.md'),'User-edited instructions');
  assert.equal((await post('/install',{action:'reinstall'})).status,202);await wait('completed');assert.equal(readFileSync(join(root,'.codex','AGENTS.md'),'utf8'),'User-edited instructions');
  assert.equal((await post('/install',{action:'reset'})).status,202);await wait('not-installed');assert.equal(readFileSync(join(root,'.codex','AGENTS.md'),'utf8'),'User-edited instructions');assert.equal(server.store.state.instructions[0].title,item.title);
 }finally{await server.close();rmSync(root,{recursive:true,force:true});rmSync(other,{recursive:true,force:true});}
});
