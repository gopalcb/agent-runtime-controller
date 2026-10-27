/** Async component behavior only: these checks do not certify rendered browser layout. */
import '../frontend/node_modules/@angular/compiler/fesm2022/compiler.mjs';
import { AppComponent } from '../frontend/src/app';
import { test } from 'node:test';
import assert from 'node:assert/strict';

function cell(value: any) { const read = () => value; read.set = (next: any) => { value = next; }; return read; }
function component() {
  const app: any = Object.create(AppComponent.prototype);
  Object.assign(app, {docSearch:'release software', projectEpoch:0, searchRequest:0, token:'test-token',
    state:cell({project:{id:'project'}}), documents:cell([{path:'README.md'}]),
    docsSearching:cell(false), docsError:cell(''), docsTruncated:cell(false), docSearchResults:cell(null)});
  return app;
}

test('search submits explicit query, preserves relevance order, and reset returns browsing', async () => {
  const original=globalThis.fetch, app=component();
  try {
    globalThis.fetch=async(url, options)=>{
      assert.equal(url,'/api/documents/search');assert.equal(options?.method,'POST');
      assert.equal(JSON.parse(String(options?.body)).query,'release software');
      assert.equal((options?.headers as any)['X-Project-Id'],'project');
      assert.equal(app.docsSearching(),true);
      return new Response(JSON.stringify({documents:[{path:'docs/release.md'},{path:'README.md'}],truncated:false}));
    };
    await app.searchDocuments();
    assert.deepEqual(app.filteredDocuments().map((d:any)=>d.path),['docs/release.md','README.md']);
    assert.equal(app.docsSearching(),false);
    app.docSearch=''; app.documentQueryChanged();
    assert.deepEqual(app.filteredDocuments(),[{path:'README.md'}]);
  } finally {globalThis.fetch=original;}
});

test('query edits and project switches fence stale responses; errors and empty matches are distinct', async () => {
  const original=globalThis.fetch;
  try {
    for(const change of ['query','project']) {
      const app=component();let finish!: (response:Response)=>void;
      globalThis.fetch=()=>new Promise(resolve=>{finish=resolve;});
      const pending=app.searchDocuments();
      if(change==='query'){app.docSearch='new query';app.documentQueryChanged();}
      else {app.projectEpoch++;app.documentQueryChanged();}
      finish(new Response(JSON.stringify({documents:[{path:'stale.md'}]})));await pending;
      assert.equal(app.docSearchResults(),null);assert.equal(app.docsSearching(),false);
    }
    const app=component();
    globalThis.fetch=async()=>new Response(JSON.stringify({documents:[],truncated:false}));
    await app.searchDocuments();assert.deepEqual(app.filteredDocuments(),[]);assert.equal(app.docsError(),'');
    globalThis.fetch=async()=>new Response(JSON.stringify({message:'Model unavailable'}),{status:503});
    await app.searchDocuments();assert.equal(app.docsError(),'Model unavailable');assert.equal(app.docsSearching(),false);
  } finally {globalThis.fetch=original;}
});
