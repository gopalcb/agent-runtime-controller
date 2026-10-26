import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexTransport } from '../backend/codex';

test('stdio transport correlates responses, rejects errors and never retries a timed-out call', async()=>{
  const root=mkdtempSync(join(tmpdir(),'visual-builder-rpc-'));const binary=join(root,'fake-codex');
  writeFileSync(binary,`#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});let count=0;
rl.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;
if(m.method==='timeout'){count++;return;}
const config={features:Object.fromEntries(['apps','plugins','remote_plugin','browser_use','computer_use','hooks','multi_agent','skill_mcp_dependency_install'].map(k=>[k,false]))};
if(m.method==='config/read'){process.stdout.write(JSON.stringify({id:m.id,result:{config}})+'\\n');return;}
const response=m.method==='bad'?{id:m.id,error:{message:'synthetic error'}}:{id:m.id,result:m.method==='count'?count:{echo:m.method}};
setTimeout(()=>process.stdout.write(JSON.stringify(response)+'\\n'),m.method==='slow'?25:0);});
`,{mode:0o700});
  const transport=new CodexTransport(root,()=>{},()=>{},binary,1500);
  try{await transport.start();const [slow,fast]=await Promise.all([transport.request('slow'),transport.request('fast')]);assert.equal(slow.echo,'slow');assert.equal(fast.echo,'fast');await assert.rejects(transport.request('bad'),/synthetic error/);await assert.rejects(transport.request('timeout'),/not retried/);assert.equal(await transport.request('count'),1);}finally{transport.close();rmSync(root,{recursive:true,force:true});}
});
test('missing Codex executable rejects initialization',async()=>{const transport=new CodexTransport(tmpdir(),()=>{},()=>{},'/missing/visual-builder-codex',100);try{await assert.rejects(transport.start(),/ENOENT/);}finally{transport.close();}});

test('server requests receive only one-shot decisions; unsupported interactions return errors and scoped notices',async()=>{
  const root=mkdtempSync(join(tmpdir(),'builder-approval-rpc-')),binary=join(root,'fake-codex');
  writeFileSync(binary,`#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});const waiters=new Map();
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
if(!m.method){const caller=waiters.get(m.id);if(caller){send({id:caller,result:m});waiters.delete(m.id);}return;}
if(m.method==='config/read'){send({id:m.id,result:{config:{features:Object.fromEntries(['apps','plugins','remote_plugin','browser_use','computer_use','hooks','multi_agent','skill_mcp_dependency_install'].map(k=>[k,false]))}}});return;}
if(m.method==='trigger'){const id='approval-'+m.id;waiters.set(id,m.id);send({id,method:m.params.method,params:{threadId:'thread',turnId:'turn',itemId:'item'}});return;}
send({id:m.id,result:{}});});
`,{mode:0o700});
  const notices:{method:string;params:any}[]=[],requests:string[]=[];
  const transport=new CodexTransport(root,(method,params)=>notices.push({method,params}),()=>{},binary,1500,async(method)=>{
    requests.push(method);return {decision:method.includes('commandExecution')?'accept':'decline'};
  });
  try {
    await transport.start();
    const command=await transport.request('trigger',{method:'item/commandExecution/requestApproval'});assert.deepEqual(command.result,{decision:'accept'});
    const file=await transport.request('trigger',{method:'item/fileChange/requestApproval'});assert.deepEqual(file.result,{decision:'decline'});
    const unsupported=await transport.request('trigger',{method:'item/tool/requestUserInput'});assert.equal(unsupported.error.code,-32601);
    assert.equal(requests.length,2);assert.equal(notices.at(-1)?.method,'request.rejected');
  }finally{transport.close();rmSync(root,{recursive:true,force:true});}
});


test('closing or losing the subprocess rejects every pending RPC without false disconnect notices', async () => {
  const root = mkdtempSync(join(tmpdir(), 'builder-pending-rpc-'));
  const binary = join(root, 'fake-codex');
  writeFileSync(binary, `#!/usr/bin/env node
const rl = require('node:readline').createInterface({input: process.stdin});
const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
rl.on('line', line => {
  const m = JSON.parse(line);
  if (!m.id || m.method === 'hang') return;
  if (m.method === 'exit') { process.exit(0); return; }
  const config = {features: Object.fromEntries(['apps','plugins','remote_plugin','browser_use','computer_use','hooks','multi_agent','skill_mcp_dependency_install'].map(k => [k, false]))};
  send({id: m.id, result: m.method === 'config/read' ? {config} : {}});
});
`, {mode: 0o700});

  try {
    for (const mode of ['close', 'exit']) {
      const notices: string[] = [];
      const transport = new CodexTransport(root, () => {}, reason => notices.push(reason), binary, 1500);
      try {
        await transport.start();
        const pending = [transport.request('hang'), transport.request('hang')];
        if (mode === 'exit') pending.push(transport.request('exit'));
        const results = Promise.allSettled(pending);
        if (mode === 'close') transport.close();

        for (const result of await results) {
          assert.equal(result.status, 'rejected');
          if (result.status === 'rejected') {
            assert.match(result.reason.message, mode === 'close' ? /connection closed/ : /disconnected/);
          }
        }
        assert.equal(notices.length, mode === 'exit' ? 1 : 0);
      } finally {
        transport.close();
      }
    }
  } finally {
    rmSync(root, {recursive: true, force: true});
  }
});
