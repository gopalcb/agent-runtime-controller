#!/usr/bin/env node
'use strict';
/** npm's dependency lifecycle bridges into the Python installer; never reads account data. */
const {realpathSync}=require('node:fs');
const {resolve}=require('node:path');
const {spawnSync}=require('node:child_process');
const packageRoot=realpathSync(resolve(__dirname,'..'));
const initial=process.env.INIT_CWD;
if(process.env.RUNTIME_CONTROLLER_SKIP_SETUP==='1'||process.env.RUNTIME_CONTROLLER_CHILD==='1'||process.env.npm_config_global==='true'){
 console.log('Runtime Controller setup skipped. Run runtime-controller setup from the target project when ready.');
}else if(!initial||realpathSync(initial)===packageRoot){
 console.log('Source checkout ready. Build, then run npm run setup to start the installation UI.');
}else{
 const args=['-m','installer.bootstrap','--project',realpathSync(initial),'--port',process.env.RUNTIME_CONTROLLER_PORT||'10101'];
 if(process.env.RUNTIME_CONTROLLER_NO_OPEN==='1')args.push('--no-open');
 const result=spawnSync(process.env.RUNTIME_CONTROLLER_PYTHON||'python3',args,{cwd:packageRoot,stdio:'inherit',env:process.env,timeout:60000});
 if(result.error||result.status!==0){console.error('Runtime Controller setup could not finish bootstrap. Run npx runtime-controller setup --project . to retry.');process.exitCode=1;}
}
