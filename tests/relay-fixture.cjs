/** Disposable UI fixture. Execution is synthetic and never launches Codex. */
const {mkdtempSync,rmSync,writeFileSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {createApplication}=require('../dist/main');
async function fixture(port=14330){
 const root=mkdtempSync(join(tmpdir(),'relay-ui-'));const server=await createApplication({project:root,port});
 writeFileSync(join(root,'.codex','runtime-controller','install.json'),JSON.stringify({status:'completed',progress:100,steps:[],version:'0.2.0'}));
 const rect={x:12,y:20,width:200,height:64},viewport={width:1440,height:900};
 const first=server.store.add({title:'Header contrast',description:'Improve header contrast.',rect,viewport});
 const second=server.store.add({title:'Button spacing',description:'Align action buttons.',rect,viewport});
 const third=server.store.add({title:'Finished item',description:'A previously completed item.',rect,viewport}); third.status='completed';
 const usage={inputTokens:1200,cachedInputTokens:400,outputTokens:300,reasoningOutputTokens:100,totalTokens:1500};
 server.store.state.runs=[{id:'recorded-session',status:'completed',instructionIds:[third.id],instructions:[structuredClone(third)],createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),prompt:'Synthetic usage fixture',output:'Synthetic UI test output; no agent was run.',threadId:'fixture-thread',tokenUsage:usage},{id:'unreported-session',status:'failed',instructionIds:[],instructions:[],createdAt:new Date().toISOString(),prompt:'Unreported usage fixture',error:'Synthetic connection error',output:''}];
 server.store.event('runtime.error','Synthetic connection error','unreported-session');
 const executions=[];
 server.runtime.execute=(body)=>{
  executions.push(structuredClone(body));
  const selected=server.store.state.instructions.filter(i=>body.instructionIds.includes(i.id));
  const run={id:'synthetic-'+executions.length,status:'completed',instructionIds:selected.map(i=>i.id),instructions:structuredClone(selected),createdAt:new Date().toISOString(),finishedAt:new Date().toISOString(),prompt:body.prompt,output:'Synthetic confirmation test; no Codex process started.'};
  selected.forEach(i=>i.status='completed');server.store.state.runs.unshift(run);server.store.event('run.completed','Synthetic selected execution',run.id);return run;
 };
 await server.app.listen(port,'127.0.0.1');
 return {server,root,first,second,executions,close:async()=>{await server.close();rmSync(root,{recursive:true,force:true});}};
}
module.exports={fixture};
if(require.main===module) fixture().then(f=>{console.log('Synthetic RELAY UI fixture: http://127.0.0.1:14330');for(const s of ['SIGINT','SIGTERM'])process.once(s,()=>f.close().then(()=>process.exit(0)));});
