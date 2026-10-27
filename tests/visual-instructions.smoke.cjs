/** Supplemental synthetic checks only; never starts a coding agent. */
const assert = require('node:assert/strict');
const {mkdirSync,writeFileSync} = require('node:fs');
const {join} = require('node:path');
const {chromium} = require('playwright');
const {fixture} = require('./relay-fixture.cjs');
(async()=>{
 let browser;
 try {
  browser=await chromium.launch({headless:true});
  for(const viewport of [{width:1280,height:713},{width:390,height:844}]) {
   let f,context;
   try {
    f=await fixture(14335);context=await browser.newContext({viewport});const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    mkdirSync(join(f.root,'docs'));writeFileSync(join(f.root,'docs','plan.md'),'# Synthetic plan\n\n**Readable content**\n\n<script>window.docUnsafe=true</script>\n\n| Task | Status |\n| --- | --- |\n| Build | Done |'+'\n\n'+Array.from({length:60},(_,i)=>'Paragraph '+i+' describes a project task.').join('\n\n'));
    f.server.store.event('runtime.debug','Synthetic debug message');
    const execute=f.server.runtime.execute;
    f.server.runtime.execute=body=>{const run=execute(body);run.status='running';run.output=Array.from({length:100},(_,i)=>'Output line '+i).join('\n');return run;};
    await page.goto('http://127.0.0.1:14335/controller/agent-runtime');
    await page.getByRole('heading',{name:'Agent Runtime',exact:true}).waitFor();
    assert.equal(await page.locator('.brand').innerText(),'RUNTIME CONTROLLER');assert.equal(await page.locator('.project-topbar,.project-info').count(),0);
    assert.equal(await page.getByRole('button',{name:'Select project',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Runtime installed',exact:true}).count(),0);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Runtime installed',exact:true}).click();await page.waitForURL('**/controller/install');await page.getByRole('button',{name:'Select project',exact:true}).waitFor({state:'hidden'});
    assert.equal(await page.getByRole('button',{name:'Select project',exact:true}).count(),0);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    await page.getByRole('button',{name:'Select project',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');
    await page.getByRole('button',{name:'Agent Runtime',exact:true}).click();
    await page.getByRole('checkbox',{name:'Select Header contrast',exact:true}).check();await page.getByRole('button',{name:'Execute instructions',exact:true}).click();await page.getByRole('button',{name:'Confirm execution',exact:true}).click();
    await page.getByRole('heading',{name:'Running…',exact:true}).waitFor();
    await page.waitForFunction(()=>{const n=document.querySelector('.runtime-terminal');return n && n.scrollHeight>n.clientHeight && Math.abs(n.scrollHeight-n.clientHeight-n.scrollTop)<3;});
    await page.setViewportSize({...viewport,height:viewport.height-80});
    await page.waitForFunction(()=>{const n=document.querySelector('.runtime-terminal');return Math.abs(n.scrollHeight-n.clientHeight-n.scrollTop)<3;});
    await page.setViewportSize(viewport);
    const run=f.server.store.state.runs[0];run.output+='\nNewest output';await page.getByText(/Newest output/).waitFor();assert.match(await page.locator('.terminal-entry').last().innerText(),/Newest output/);
    await page.getByRole('button',{name:'Pause auto-scroll',exact:true}).click();await page.locator('.runtime-terminal').evaluate(n=>n.scrollTop=0);run.output+='\nPaused update';await page.getByText(/Paused update/).waitFor();assert.equal(await page.locator('.runtime-terminal').evaluate(n=>n.scrollTop),0);
    await page.getByRole('button',{name:'Follow latest',exact:true}).click();
    await page.waitForFunction(()=>{const n=document.querySelector('.runtime-terminal');return Math.abs(n.scrollHeight-n.clientHeight-n.scrollTop)<3;});
    run.plan=[{step:'Inspect source',status:'completed'},{step:'Implement change',status:'inProgress'},{step:'Run tests',status:'pending'}];
    run.activity=[{id:'cmd',time:new Date().toISOString(),kind:'commandExecution',title:'$ npm test',text:'<script>unsafe</script>\nTests running',status:'inProgress'}];
    await page.locator('.workflow-steps [data-status=inProgress] .step-spinner').waitFor();
    assert.equal(await page.locator('.workflow-steps [data-status=completed]').count(),1);
    assert.equal(await page.locator('.workflow-steps [data-status=pending]').count(),1);
    await page.getByText('$ npm test',{exact:true}).waitFor();
    assert.equal(await page.locator('.runtime-terminal script').count(),0);
    assert((await page.locator('.runtime-terminal').boundingBox()).height>=320);
    run.plan[1].status='completed';run.plan[2].status='inProgress';
    await page.waitForFunction(()=>document.querySelectorAll('.workflow-steps [data-status=completed]').length===2);
    run.status='completed';await page.getByRole('heading',{name:'Running…',exact:true}).waitFor({state:'hidden'});
    await page.locator('.workflow-steps [data-status=interrupted]').waitFor();assert.equal(await page.locator('.runtime-terminal').count(),1);await page.getByRole('button',{name:'Work Docs',exact:true}).click();await page.locator('.markdown-content h1').waitFor();assert.equal(await page.locator('.markdown-content h1').innerText(),'Synthetic plan');assert.equal(await page.evaluate(()=>window.docUnsafe),undefined);assert.equal(await page.locator('.markdown-content table').count(),1);
    assert.equal(await page.getByRole('button',{name:'Select project',exact:true}).count(),0);
    assert.equal(await page.getByRole('button',{name:'Runtime installed',exact:true}).count(),0);
    const documentLayout=await page.locator('.markdown-content').evaluate(node=>({maxHeight:getComputedStyle(node).maxHeight,overflow:getComputedStyle(node).overflowY,height:node.clientHeight,pageHeight:document.documentElement.scrollHeight,viewport:innerHeight}));
    assert.equal(documentLayout.maxHeight,'none');assert.equal(documentLayout.overflow,'visible');assert(documentLayout.height>documentLayout.viewport);assert(documentLayout.pageHeight>documentLayout.viewport);
    if(viewport.width>800)assert((await page.locator('.docs-sidebar').boundingBox()).width>=320);
    await page.locator('#doc-search').fill('missing');await page.getByText('No matching Markdown documents.',{exact:true}).waitFor();await page.locator('#doc-search').fill('');await page.reload();await page.locator('.markdown-content h1').waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'Observability',exact:true}).click();await page.locator('#event-severity').selectOption('debug');await page.getByText('DEBUG',{exact:true}).waitFor();assert.equal(await page.locator('.event-row').count(),1);assert(await page.locator('.metric').first().evaluate(n=>n.getBoundingClientRect().height<180));
    for (const [count, display] of [[0,'0'],[999,'999'],[1000,'1K'],[100000,'100K'],[999999,'1M'],[3500000,'3.5M']]) {
     f.server.store.state.runs.find(run=>run.tokenUsage).tokenUsage.totalTokens=count;
     await page.waitForFunction(expected=>document.querySelector('.metric strong')?.textContent===expected,display);
     assert.equal(await page.locator('.metric strong').first().getAttribute('title'),count.toLocaleString('en-US'));
    }
    for (const heading of await page.locator('.panel-heading').all()) {
     assert.deepEqual(await heading.evaluate(node=>{const s=getComputedStyle(node);return [s.borderBottomLeftRadius,s.borderBottomRightRadius];}),['0px','0px']);
    }
    f.server.store.state.runs.forEach(run=>delete run.tokenUsage);
    await page.waitForFunction(()=>document.querySelector('.metric strong')?.textContent==='Unreported');
    assert.deepEqual(errors,[]);
   } finally {if(context)await context.close();if(f)await f.close();}
  }
  console.log('PASS saved visual instructions at desktop/mobile viewports');
 } finally {if(browser)await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
