import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../lib/browser/akari-annotations-widget.js',import.meta.url),'utf8');
const rest=source.slice(source.indexOf('    async reloadEdit('));const method=rest.slice(0,rest.indexOf('\n    }')+6);
const Widget=new Function(`return class {${method}}`)();
test('pending file reads never publish an empty timeline; superseded reads do not replace it',async()=>{
 let release;const cuts=[{id:'kept'}],tracks=[{id:'v1'}],edit={version:2};
 const w=Object.assign(new Widget(),{editReloadGeneration:0,location:{editUri:{}},cuts,timelineTracks:tracks,editDocument:edit,
 fileService:{readFile:()=>new Promise(r=>release=r)},resolveLegacyEditForOpen:async s=>s,readEdit:()=>({tracks:[]}),hydrateDocumentMotionReferences:async()=>{}});
 const pending=w.reloadEdit();assert.equal(w.cuts,cuts);assert.equal(w.timelineTracks,tracks);assert.equal(w.editDocument,edit);
 w.editReloadGeneration++;release({value:'{}'});await pending;assert.equal(w.cuts,cuts);assert.equal(w.timelineTracks,tracks);
});
