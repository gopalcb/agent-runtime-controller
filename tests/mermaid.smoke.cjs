/** Supplemental diagram rendering checks against disposable projects and the real compiled UI. */
const assert = require('node:assert/strict');
const {mkdirSync, readFileSync, writeFileSync} = require('node:fs');
const {join, resolve} = require('node:path');
const {chromium} = require('playwright');
const {fixture} = require('./relay-fixture.cjs');
const artifacts=resolve(__dirname,'../artifacts/mermaid');
mkdirSync(artifacts,{recursive:true});
const block=source=>'```mermaid\n'+source+'\n```';

(async()=>{
  let browser;
  try {
    browser=await chromium.launch({headless:true});
    for(const viewport of [{width:1357,height:797},{width:390,height:844}]) {
      let f,context;
      try {
        f=await fixture(14337);
        mkdirSync(join(f.root,'docs'));
        writeFileSync(join(f.root,'README.md'),readFileSync(join(__dirname,'../README.md'),'utf8'));
        writeFileSync(join(f.root,'docs','broken.md'),'# Invalid diagram\n\n'+block('flowchart LR\n A[unclosed --> B')+'\n\nOrdinary paragraph still renders.');
        writeFileSync(join(f.root,'docs','plain.md'),'# Plain document\n\n```ts\nconst x = "<script>window.unsafe=true</script>";\n```');
        writeFileSync(join(f.root,'docs','security.md'),'# Safe labels\n\n'+block('%%{init: {"securityLevel":"loose","flowchart":{"htmlLabels":true}}}%%\nflowchart LR\n A["<img src=x onerror=window.unsafe=true>"] --> B[Safe]\n click B call unsafe()'));
        writeFileSync(join(f.root,'docs','large.md'),block('flowchart LR\n%%'+ 'x'.repeat(50001)));
        context=await browser.newContext({viewport});
        const page=await context.newPage(),errors=[],external=[];
        page.on('pageerror',error=>errors.push(error.message));
        page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
        page.on('request',request=>{if(/^https?:/.test(request.url())&&!request.url().startsWith('http://127.0.0.1:14337/'))external.push(request.url());});
        await page.goto('http://127.0.0.1:14337/controller/work-docs');
        const select=async(name)=>{await page.getByRole('button',{name:new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))}).click();};
        await select('README.md');
        await page.waitForFunction(()=>document.querySelectorAll('.mermaid-diagram img').length===2&&Array.from(document.querySelectorAll('.mermaid-diagram img')).every(image=>image.complete&&image.naturalWidth>0));
        assert.equal(await page.locator('.mermaid-error').count(),0);
        assert.equal(await page.locator('.markdown-content svg,.markdown-content iframe').count(),0);
        await page.locator('.mermaid-diagram summary').first().focus();
        await page.keyboard.press('Enter');
        assert.match(await page.locator('.mermaid-diagram pre').first().innerText(),/flowchart LR/);
        await page.locator('.mermaid-diagram summary').first().click();
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.equal(await page.locator('.markdown-content').evaluate(node=>getComputedStyle(node).maxHeight),'none');
        await page.screenshot({path:join(artifacts,`${viewport.width}-readme.png`),fullPage:true});
        await page.reload();
        await select('README.md');
        await page.waitForFunction(()=>document.querySelectorAll('.mermaid-diagram img').length===2&&Array.from(document.querySelectorAll('.mermaid-diagram img')).every(image=>image.complete&&image.naturalWidth>0));
        await select('broken.md');
        await page.getByText('Could not render this Mermaid diagram. Check the syntax below.',{exact:true}).waitFor();
        await page.getByText('Ordinary paragraph still renders.',{exact:true}).waitFor();
        assert.equal(await page.locator('.mermaid-diagram').count(),0);
        await select('security.md');
        await page.locator('.mermaid-error').waitFor();
        assert.equal(await page.evaluate(()=>window.unsafe),undefined);
        assert.equal(await page.locator('.markdown-content script,.markdown-content iframe,.markdown-content img[src=x]').count(),0);
        await select('large.md');
        await page.getByText('This diagram exceeds the 50,000 character rendering limit. Source is shown below.',{exact:true}).waitFor();
        await select('README.md');
        await select('plain.md');
        await page.getByRole('heading',{name:'Plain document',exact:true}).waitFor();
        await page.waitForFunction(()=>document.querySelectorAll('.mermaid-staging').length===0);
        assert.equal(await page.locator('.mermaid-diagram,.mermaid-error').count(),0);
        assert.equal(await page.locator('.markdown-content pre').count(),1);
        assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      } finally {await context?.close();await f?.close();}
    }
    console.log('PASS Mermaid README flowchart/sequence, reload, invalid syntax, safe labels, ordinary code and desktop/mobile layout');
  } finally {await browser?.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
