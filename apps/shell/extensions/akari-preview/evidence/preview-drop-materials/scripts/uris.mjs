// 出力プレビューが持つ editUri と、ワークスペースのルート（= タイムラインが照合に使う側）を並べる: node uris.mjs [out.json]
import { writeFile } from 'node:fs/promises';
import { connect, evalOn } from './common.mjs';
const cdp = await connect();
const value = await evalOn(cdp, `(async()=>{const c=window.theia.container,d=c._bindingDictionary;
 const shellKey=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.collapsePanel==='function'&&typeof k.prototype?.revealWidget==='function');
 const wsKey=[...d._map.keys()].find(k=>typeof k==='function'&&typeof k.prototype?.tryGetRoots==='function');
 const shell=c.get(shellKey);const previews=shell.widgets.filter(w=>w.akariPreviewEditUri!==undefined||w.akariLibraryDrop).map(w=>({id:w.id,title:w.title.label,editUri:w.akariPreviewEditUri?.toString()??null}));
 const roots=(await c.get(wsKey).roots).map(r=>r.resource.toString());
 return{previews,roots}})()`);
console.log(JSON.stringify(value, null, 1));
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(value, null, 1) + '\n');
cdp.close(); process.exit(0);
