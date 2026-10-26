/** Real installer + project switching in disposable projects; no Codex execution. */
const assert = require('node:assert/strict');
const {mkdtempSync, rmSync, existsSync, realpathSync} = require('node:fs');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
const {chromium} = require('playwright');
const {createApplication} = require('../dist/main');

(async () => {
  const a = mkdtempSync(join(tmpdir(), 'controller-ui-a-'));
  const b = mkdtempSync(join(tmpdir(), 'controller-ui-b-'));
  let server, browser;
  try {
    server = await createApplication({project:a, port:14334});
    await server.app.listen(14334, '127.0.0.1');
    browser = await chromium.launch({headless:true});
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if(m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:14334/');
    await page.getByRole('heading', {name:'Agent Runtime', exact:true}).waitFor();
    assert.equal(new URL(page.url()).pathname, '/controller/agent-runtime');
    await page.getByRole('button', {name:'Open setup', exact:true}).click();
    assert.equal(new URL(page.url()).pathname, '/controller/install');
    await page.getByRole('button', {name:'Install runtime', exact:true}).click();
    await page.getByRole('button', {name:'Open Agent Runtime', exact:true}).waitFor({timeout:90000});
    assert(existsSync(join(a, '.codex/AGENTS.md')));
    await page.getByRole('button', {name:'Open Agent Runtime', exact:true}).click();
    const data = await (await fetch('http://127.0.0.1:14334/api/bootstrap')).json();
    await fetch('http://127.0.0.1:14334/api/instructions', {method:'POST', headers:{'content-type':'application/json','x-builder-token':data.token,'x-project-id':data.project.id}, body:JSON.stringify({title:'Only project A',description:'Project isolation fixture',rect:{x:0,y:0,width:100,height:50},viewport:{width:1000,height:800}})});
    await page.getByRole('heading', {name:'Only project A',exact:true}).waitFor();
    await page.getByRole('button', {name:'Settings',exact:true}).click();
    await page.locator('#settings-model').fill('project-a-fixture');
    await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/settings')&&r.status()===200), page.getByRole('button',{name:'Save settings',exact:true}).click()]);
    const select = async (path) => {
      await page.getByRole('button', {name:'Settings',exact:true}).click();
      await page.locator('.project-picker').click();
      await page.locator('#project-path').fill(path);
      await page.getByRole('button',{name:'Browse',exact:true}).click();
      await page.getByRole('button',{name:'Select folder',exact:true}).click();
      await page.getByRole('dialog').waitFor({state:'hidden'});
    };
    await select(b);
    assert.equal(server.store.root, realpathSync(b));
    assert.equal(server.store.state.instructions.length,0);
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await page.locator('#settings-model').inputValue(),'');
    await page.getByRole('button',{name:'Agent Runtime',exact:true}).click();
    assert.equal(await page.getByRole('heading',{name:'Only project A',exact:true}).count(),0);
    await select(a);
    await page.getByRole('heading',{name:'Only project A',exact:true}).waitFor();
    await page.getByRole('button',{name:'Settings',exact:true}).click();
    assert.equal(await page.locator('#settings-model').inputValue(),'project-a-fixture');
    await page.reload();
    await page.waitForFunction(()=>document.querySelector('#settings-model')?.value==='project-a-fixture');
    assert.deepEqual(errors,[]);
    console.log('PASS real installer UI, folder browsing, A/B isolation, settings restore/reload, clean console');
  } finally {
    if(browser) await browser.close();
    if(server) await server.close();
    rmSync(a,{recursive:true,force:true});
    rmSync(b,{recursive:true,force:true});
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
