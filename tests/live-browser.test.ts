import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { ProjectStore } from '../backend/store';
// Exercise production serialization of the browser init script (without tsx helpers).
const { LiveBrowser } = require('../dist/live-browser');

async function supplementalScreenshot(page: Page, name: string) {
  const directory = process.env.FORMA_SUPPLEMENTAL_DIR;
  if (!directory) return;
  mkdirSync(directory, {recursive: true});
  await page.screenshot({path: join(directory, name + '-supplemental.png')});
}

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'visual-builder-live-'));
  const store = new ProjectStore(root);
  const browser = new LiveBrowser(store, {headless: true});
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/frame') { res.end('<button>Frame content</button>'); return; }
    res.end(`<!doctype html><html><head><style>
      body {margin: 0; padding: 110px 24px; min-height: 1400px; font-family: sans-serif}
      #target {width: 420px; height: 230px; padding: 20px; background: rgb(230, 240, 250)}
      input, textarea, select {display: block; margin: 8px}
    </style></head><body>
      <section id="target" onclick="window.fixtureClicks++"><h2>Account card</h2>
        <input value="private-input-value" type="password">
        <textarea>private-textarea-value</textarea>
        <select><option selected>private-option-value</option></select>
      </section>
      <button id="ordinary" onclick="window.fixtureClicks++">App action</button>
      <iframe src="/frame"></iframe>
      <script>window.fixtureClicks = 0;</script>
    </body></html>`);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  const url = `http://127.0.0.1:${address.port}/`;
  return {root, store, browser, url, cleanup: async () => {
    await browser.close(); store.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(root, {recursive: true, force: true});
  }};
}

test('local app selection suppresses clicks, persists sanitized element evidence and restores browsing', async () => {
  const f = await fixture();
  try {
    const result = await f.browser.launch(f.url + '?session=private-query#private-fragment');
    assert.deepEqual(result, {open: true, url: f.url});
    const page = (f.browser as unknown as {page: Page}).page;
    await page.setViewportSize({width: 1440, height: 900});
    const overlay = page.locator('[data-forma-visual-root]');
    await overlay.waitFor();
    // Browsing is the initial mode, so an app click reaches its own handler.
    await page.locator('#ordinary').click();
    assert.equal(await page.evaluate(() => (window as any).fixtureClicks), 1);
    await page.evaluate(() => window.scrollTo(0, 40));
    await overlay.getByRole('button', {name: 'Select element', exact: true}).click();
    const target = page.locator('#target');
    await target.hover({position: {x: 10, y: 10}});
    const bounds = await target.boundingBox(); assert.ok(bounds);
    await target.click({position: {x: 10, y: 10}});
    assert.equal(await page.evaluate(() => (window as any).fixtureClicks), 1);
    assert.equal(await overlay.getByLabel('Region name', {exact: true}).count(), 0);
    assert.equal(await overlay.getByLabel('Instructions', {exact: true}).evaluate(node => (node.getRootNode() as ShadowRoot).activeElement === node), true);
    await overlay.getByLabel('Instructions', {exact: true}).fill('Increase the card spacing');
    await supplementalScreenshot(page, 'desktop-1440x900-editor');
    await overlay.getByRole('button', {name: 'Save instruction', exact: true}).click();
    // The binding is asynchronous; wait for an observable saved instruction list.
    await page.waitForFunction(async () => (await (window as any).__formaVisual({action: 'list'})).instructions.length === 1);
    const item = f.store.state.instructions[0];
    assert.equal(item.title, 'Increase the card spacing');
    assert.equal(item.description, 'Increase the card spacing');
    assert.equal(item.status, 'todo');
    assert.equal(item.source?.url, f.url);
    assert.equal(item.source?.tag, 'section');
    assert.ok(item.source?.selector);
    assert.equal(await page.locator(item.source!.selector).getAttribute('id'), 'target');
    assert.match(item.source!.text, /Account card/);
    assert.match(item.source!.html, /section/);
    assert.ok(Object.keys(item.source!.styles).length > 0);
    assert.deepEqual(item.source!.scroll, {x: 0, y: 40});
    assert.ok(Math.abs(item.rect.x - bounds.x) <= 1);
    assert.ok(Math.abs(item.rect.y - bounds.y) <= 1);
    assert.ok(Math.abs(item.rect.width - bounds.width) <= 1);
    assert.ok(Math.abs(item.rect.height - bounds.height) <= 1);
    assert.ok(item.viewport.width >= item.rect.x + item.rect.width);
    assert.ok(item.viewport.height >= item.rect.y + item.rect.height);
    const persisted = readFileSync(join(f.store.directory, 'state.json'), 'utf8');
    for (const secret of ['private-input-value', 'private-textarea-value', 'private-option-value', 'private-query', 'private-fragment']) assert.ok(!persisted.includes(secret), `Persisted evidence leaked ${secret}`);
    await overlay.getByRole('button', {name: 'Browse', exact: true}).click();
    await page.locator('#ordinary').click();
    assert.equal(await page.evaluate(() => (window as any).fixtureClicks), 2);
    await page.reload();
    await overlay.waitFor();
    assert.equal(await page.locator('[data-forma-visual-root]').count(), 1);
    const saved = await page.evaluate(() => (window as any).__formaVisual({action: 'list'}));
    assert.equal(saved.instructions[0].id, item.id);
    await overlay.getByRole('button', {name: /^Saved \(1\)$/}).click();
    await overlay.locator('.saved-item strong').filter({hasText: 'Increase the card spacing'}).waitFor();
  } finally { await f.cleanup(); }
});

test('Escape and Cancel discard unsaved element instructions', async () => {
  const f = await fixture();
  try {
    await f.browser.launch(f.url);
    const page = (f.browser as unknown as {page: Page}).page;
    const overlay = page.locator('[data-forma-visual-root]');
    for (const dismissal of ['Escape', 'Cancel']) {
      await overlay.getByRole('button', {name: 'Select element', exact: true}).click();
      await page.locator('#ordinary').hover();
      await page.locator('#ordinary').click();
      await overlay.getByLabel('Instructions', {exact: true}).fill('This must never be saved');
      if (dismissal === 'Escape') await page.keyboard.press('Escape');
      else await overlay.getByRole('button', {name: 'Cancel', exact: true}).click();
      await overlay.getByRole('dialog').waitFor({state: 'hidden'});
      assert.equal(await overlay.getByRole('button', {name: 'Select element', exact: true}).getAttribute('aria-pressed'), 'false');
      assert.equal(f.store.state.instructions.length, 0);
      assert.deepEqual((await page.evaluate(() => (window as any).__formaVisual({action: 'list'}))).instructions, []);
      await page.locator('#ordinary').click();
    }
    assert.equal(await page.evaluate(() => (window as any).fixtureClicks), 2);
    assert.equal(JSON.parse(readFileSync(join(f.store.directory, 'state.json'), 'utf8')).instructions.length, 0);
  } finally { await f.cleanup(); }
});

test('mobile toolbar and element editor fit a 390 by 844 viewport', async () => {
  const f = await fixture();
  try {
    await f.browser.launch(f.url);
    const page = (f.browser as unknown as {page: Page}).page;
    await page.setViewportSize({width: 390, height: 844});
    const overlay = page.locator('[data-forma-visual-root]');
    const fitsViewport = async (locator: ReturnType<Page['locator']>) => {
      const box = await locator.boundingBox(); assert.ok(box);
      assert.ok(box.x >= 0 && box.y >= 0, 'Overlay starts inside the viewport');
      assert.ok(box.x + box.width <= 391 && box.y + box.height <= 845, 'Overlay fits within the viewport');
      return box;
    };
    await fitsViewport(overlay.getByRole('toolbar'));
    for (const name of ['Select element', 'Browse', 'Saved (0)']) await fitsViewport(overlay.getByRole('button', {name, exact: true}));
    await overlay.getByRole('button', {name: 'Select element', exact: true}).click();
    await page.locator('#ordinary').hover();
    await page.locator('#ordinary').click();
    const editor = overlay.getByRole('dialog');
    const editorBox = await fitsViewport(editor);
    const toolbarBox = await fitsViewport(overlay.getByRole('toolbar'));
    assert.ok(editorBox.y + editorBox.height <= toolbarBox.y, 'Editor does not overlap toolbar');
    assert.equal(await overlay.getByLabel('Region name', {exact: true}).count(), 0);
    await overlay.getByLabel('Instructions', {exact: true}).fill('Increase the touch target spacing');
    await fitsViewport(overlay.getByRole('button', {name: 'Save instruction', exact: true}));
    await supplementalScreenshot(page, 'mobile-390x844-editor');
    await overlay.getByRole('button', {name: 'Cancel', exact: true}).click();
    assert.equal(f.store.state.instructions.length, 0);
  } finally { await f.cleanup(); }
});

test('an unreachable local app returns useful 503 feedback and a later launch can recover', async () => {
  const f = await fixture();
  const unavailable = createServer();
  try {
    await new Promise<void>(resolve => unavailable.listen(0, '127.0.0.1', resolve));
    const address = unavailable.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/`;
    await new Promise<void>((resolve, reject) => unavailable.close(error => error ? reject(error) : resolve()));
    await assert.rejects(f.browser.launch(url), (error: any) => {
      assert.equal(error.getStatus(), 503);
      assert.match(error.message, /Check that the app is running and the URL is reachable/);
      return true;
    });
    assert.equal(f.browser.open, false);
    assert.deepEqual(await f.browser.launch(f.url), {open: true, url: f.url});
    assert.equal(f.browser.open, true);
    assert.equal(f.store.state.instructions.length, 0);
    await (f.browser as unknown as {page: Page}).page.locator('[data-forma-visual-root]').waitFor();
  } finally {
    if (unavailable.listening) await new Promise<void>(resolve => unavailable.close(() => resolve()));
    await f.cleanup();
  }
});

test('live browser rejects invalid targets, iframe callbacks and cross-origin navigation', async () => {
  const f = await fixture();
  try {
    for (const url of ['https://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:secret@localhost:3000', '', null]) {
      await assert.rejects(f.browser.launch(url), /local|URL|HTTP|credentials/i);
      assert.equal(f.browser.open, false);
    }
    await f.browser.launch(f.url);
    const page = (f.browser as unknown as {page: Page}).page;
    const iframe = page.frameLocator('iframe');
    await iframe.getByRole('button', {name: 'Frame content'}).waitFor();
    const frame = page.frames().find(frame => frame.parentFrame()); assert.ok(frame);
    await assert.rejects(frame.evaluate(() => (window as any).__formaVisual({action: 'list'})), /main frame|opened app/i);
    assert.equal(f.store.state.instructions.length, 0);
    let externalRequests = 0, externalResponses = 0;
    page.on('request', request => { if (request.url().startsWith('https://example.com/')) externalRequests++; });
    page.on('response', response => { if (response.url().startsWith('https://example.com/')) externalResponses++; });
    await assert.rejects(page.goto('https://example.com/'), /ERR_BLOCKED_BY_CLIENT|blocked|interrupted/i);
    // A request event is emitted before interception, so verify it failed and no external response arrived.
    assert.equal(externalRequests, 1);
    assert.equal(externalResponses, 0);
    assert.equal(f.store.state.instructions.length, 0);
    assert.ok(!page.url().startsWith('https://example.com/'));
  } finally { await f.cleanup(); }
});
