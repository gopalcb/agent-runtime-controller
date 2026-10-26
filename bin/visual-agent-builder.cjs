#!/usr/bin/env node
'use strict';
const {resolve}=require('node:path');
const {spawn}=require('node:child_process');
const args=process.argv.slice(2);
if(args.includes('--help')){
 console.log('runtime-controller [setup|ensure] [--project PATH] [--port PORT] [--no-open]\nDefault desired port1001; permission-denied fallback10101. Setup starts the Python installer and /controller/install UI.\nAfter setup: python3 .codex/runtime-controller/codex.py [Codex arguments]');process.exit(0);
}
let command='start';if(['setup','ensure'].includes(args[0]))command=args.shift();
let project=process.cwd(),port=command==='start'?1001:10101,open=true,explicitPort=false;
for(let i=0;i<args.length;i++){
 if(args[i]==='--project'&&args[i+1])project=resolve(args[++i]);
 else if(args[i]==='--port'&&args[i+1]){port=Number(args[++i]);explicitPort=true;}
 else if(args[i]==='--no-open')open=false;
 else{console.error('Unknown or incomplete option: '+args[i]);process.exit(1);}
}
if(!Number.isInteger(port)||port<1||port>65535){console.error('Port must be between1 and65535');process.exit(1);}
if(typeof process.getuid==='function'&&process.getuid()===0){console.error('Run the controller as your normal user. Use installer.host_setup only for hostname/low-port setup.');process.exit(1);}
if(command!=='start'){
 const child=spawn(process.env.RUNTIME_CONTROLLER_PYTHON||'python3',['-m',command==='setup'?'installer.bootstrap':'installer.ensure','--project',project,'--port',String(port),...(!open?['--no-open']:[])],{cwd:resolve(__dirname,'..'),stdio:'inherit',env:process.env});
 child.on('error',error=>{console.error('Python3.10+ is required: '+error.message);process.exitCode=1;});child.on('exit',code=>process.exitCode=code??1);
}else{
 const {start}=require('../dist/main.js');
 start({project,port,open}).catch(async error=>{
  if(error.code==='EACCES'&&port===1001&&!explicitPort){console.log('Port1001 requires administrator setup. Starting loopback fallback10101; see README hostname setup.');await start({project,port:10101,open});}
  else throw error;
 }).catch(error=>{console.error(error.message);process.exitCode=1;});
}
