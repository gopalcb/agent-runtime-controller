/** Supplemental headless UI regression, never executes Codex. Native certification is separate. */
const assert=require('node:assert/strict');
const {mkdirSync,writeFileSync}=require('node:fs');
const {resolve,join}=require('node:path');
const {chromium}=require('playwright');
const {fixture}=require('./relay-fixture.cjs');
const artifacts=resolve(__dirname,'../artifacts/controller-ui');mkdirSync(artifacts,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true});const records=[];
 try{for(let cycle=1;cycle<=2;cycle++)for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const f=await fixture(14322),context=await browser.newContext({viewport}),page=await context.newPage();const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('response',r=>{if(r.url().includes('/api/'))requests.push({path:new URL(r.url()).pathname,status:r.status(),method:r.request().method()})});
  const fit=async()=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
  const shot=async name=>page.screenshot({path:join(artifacts,`${cycle}-${viewport.width}-${name}.png`),fullPage:true});
  try{
   await page.goto('http://127.0.0.1:14322');await page.getByRole('heading',{name:'Agent Runtime',exact:true}).waitFor();await page.getByRole('checkbox',{name:'Select Header contrast',exact:true}).waitFor();
   assert.equal(await page.locator('.avatar,.brand-mark,.build-sidebar').count(),0);assert.equal(await page.getByRole('button',{name:'Execute instructions',exact:true}).isDisabled(),true);await fit();await shot('runtime');
   await page.getByRole('checkbox',{name:'Select Header contrast',exact:true}).check();await page.getByRole('button',{name:'Execute instructions',exact:true}).click();await page.getByRole('dialog').waitFor();
   await page.locator('#execute-prompt').fill('Synthetic confirmation direction');assert.equal(await page.locator('#execute-prompt').evaluate(e=>getComputedStyle(e).resize),'none');await page.keyboard.press('Escape');assert.equal(f.executions.length,0);
   await page.getByRole('button',{name:'Execute instructions',exact:true}).click();await page.getByRole('dialog').waitFor();await shot('confirm');await page.getByRole('button',{name:'Confirm execution',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
   assert.deepEqual(f.executions,[{instructionIds:[f.first.id],prompt:'Synthetic confirmation direction'}]);assert.equal(f.server.store.state.instructions.find(i=>i.id===f.second.id).status,'todo');
   assert.equal(await page.getByRole('heading',{name:'Finished item',exact:true}).count(),0);
   await page.getByRole('button',{name:'Run History',exact:true}).click();await page.getByRole('heading',{name:'Finished item',exact:true}).waitFor();await page.getByRole('heading',{name:'Header contrast',exact:true}).waitFor();await fit();await shot('history');
   await page.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('#settings-sandbox').selectOption('read-only');await page.locator('#settings-model').fill('fixture-model');await page.locator('#settings-effort').selectOption('low');
   await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/settings')&&r.status()===200),page.getByRole('button',{name:'Save settings',exact:true}).click()]);await page.reload();await page.locator('#settings-model').waitFor();await page.waitForFunction(()=>document.querySelector('#settings-model').value==='fixture-model');assert.equal(await page.locator('#settings-sandbox').inputValue(),'read-only');
   await page.locator('#settings-sandbox').selectOption('danger-full-access');assert.equal(await page.locator('#settings-network').isChecked(),true);assert.equal(await page.locator('#settings-network').isDisabled(),true);await page.locator('#settings-sandbox').selectOption('read-only');await fit();await shot('settings');
   await page.getByRole('button',{name:'Observability',exact:true}).click();await page.getByRole('heading',{name:'Recorded tokens',exact:true}).waitFor();assert.match(await page.locator('.metric').first().innerText(),/1,500/);assert.match(await page.locator('tbody').innerText(),/Unreported/);await page.locator('#run-status').selectOption('failed');assert.equal(await page.locator('tbody tr').count(),1);assert.match(await page.locator('tbody').innerText(),/Unreported/);assert.match(await page.locator('.metric').first().innerText(),/1,500/);
   await page.locator('#event-severity').selectOption('error');assert.equal(await page.locator('.event-row').count(),1);await page.locator('#event-search').fill('not-found');await page.getByText('No matching events',{exact:true}).waitFor();await page.locator('#event-search').fill('');await page.locator('#run-status').selectOption('');await fit();await shot('observability');
   await page.getByRole('button',{name:'Agent Runtime',exact:true}).click();await page.getByRole('button',{name:'Add interactive work items',exact:true}).click();await page.getByRole('button',{name:/Existing local URL/}).click();await page.locator('#target-url').fill('https://example.com');await page.getByRole('button',{name:'Open app',exact:true}).click();await page.locator('#url-error').waitFor();await page.keyboard.press('Escape');
   const canvas=await context.newPage();canvas.on('pageerror',e=>errors.push(e.message));await canvas.goto('http://127.0.0.1:14322/canvas');await canvas.getByRole('button',{name:'Draw rectangle',exact:true}).click();await canvas.mouse.move(30,60);await canvas.mouse.down();await canvas.mouse.move(230,145,{steps:5});await canvas.mouse.up();await canvas.getByRole('dialog').waitFor();await canvas.locator('#region-title').fill('Canvas regression');await canvas.locator('#region-description').fill('Preserve rectangle capture');await canvas.getByRole('button',{name:'Save instruction',exact:true}).click();await canvas.getByRole('dialog').waitFor({state:'hidden'});assert(f.server.store.state.instructions.some(i=>i.title==='Canvas regression'));
   assert.deepEqual(errors,[]);assert(requests.some(r=>r.path==='/api/execute'&&r.status===201));assert(requests.some(r=>r.path==='/api/settings'&&r.status===200));records.push({cycle,viewport,passed:true,requests,checks:['layout','selected-confirmation-cancel','settings-persistence','fullaccess-network','usage-missing-total','filters','URL-validation','canvas-regression'],consoleErrors:errors});
  }finally{await context.close();await f.close();}
 }
 writeFileSync(join(artifacts,'results.json'),JSON.stringify({driver:'supplemental-headless',nativeStability:'NOT_EVALUATED',records},null,2));console.log(`PASS ${records.length} desktop/mobile cycles; no real Codex execution`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
