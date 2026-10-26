import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listDocuments, readDocument } from '../backend/documents';
import { renderMarkdown } from '../frontend/src/markdown';
test('documents restrict discovery and reads to bounded project Markdown', async () => {
 const root=mkdtempSync(join(tmpdir(),'work-docs-')), outside=mkdtempSync(join(tmpdir(),'outside-docs-'));
 try {
  mkdirSync(join(root,'docs'));mkdirSync(join(root,'docs','node_modules'));writeFileSync(join(root,'docs','node_modules','private.md'),'private');mkdirSync(join(root,'.codex','plans'),{recursive:true});mkdirSync(join(root,'node_modules'));
  writeFileSync(join(root,'docs','plan.md'),'# Plan\n\nWork');writeFileSync(join(root,'.codex','plans','task.md'),'Task');writeFileSync(join(root,'README.md'),'Readme');writeFileSync(join(root,'node_modules','private.md'),'private');writeFileSync(join(outside,'secret.md'),'secret');
  symlinkSync(join(outside,'secret.md'),join(root,'docs','linked.md'));symlinkSync(outside,join(root,'docs','linked-dir'));
  writeFileSync(join(root,'docs','large.md'),'x'.repeat(512*1024+1));
  const result=await listDocuments(root);assert.equal(result.truncated,false);assert.deepEqual(result.documents.map(d=>d.path).sort(),['.codex/plans/task.md','README.md','docs/plan.md']);
  assert.equal((await readDocument(root,'docs/plan.md')).content,'# Plan\n\nWork');
  for(const path of ['../secret.md','/etc/passwd','docs/linked.md','docs/linked-dir/secret.md','node_modules/private.md','docs/node_modules/private.md','docs/large.md','.codex/visual-builder/state.json','docs/missing.md']) await assert.rejects(readDocument(root,path));
 } finally {rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});
test('Markdown formats readable blocks while leaving HTML and unsafe links inert',()=>{
 const html=renderMarkdown('# Plan\n- [x] Done\n\n| Task | Result |\n| --- | --- |\n| A | Pass |\n\n```js\n<script>bad()</script>\n```\n<img src=x onerror=bad()>\n[bad](javascript:bad)\n[good](https://example.com)');
 assert.match(html,/<h1>Plan<\/h1>/);assert.match(html,/<table>/);assert.match(html,/☑ Done/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|<img|href="javascript/);assert.match(html,/rel="noopener noreferrer"/);
});

test('Markdown preserves Mermaid fences as escaped render targets and keeps other code plain', () => {
 const html=renderMarkdown('```mermaid\nflowchart LR\n A["<script>unsafe()</script>"] --> B\n```\n\n```ts\nconst value = "<b>code</b>";\n```');
 assert.equal((html.match(/class="mermaid-source"/g)||[]).length,1);
 assert.match(html,/&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
 assert.match(html,/<pre><code>const value =/);
 assert.doesNotMatch(html,/<script|<b>/);
 assert.match(renderMarkdown('```MERMAID\ngraph LR\n A-->B'),/class="mermaid-source"/);
 assert.doesNotMatch(renderMarkdown('```mermaid-unknown\nA-->B\n```'),/class="mermaid-source"/);
});
