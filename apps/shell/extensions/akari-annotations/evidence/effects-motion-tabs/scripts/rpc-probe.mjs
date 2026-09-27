// 手順 0 の原因の裏取り（ラッパー作成の検証スクリプト）: ライブラリのテキスト系のページを開くときに走る backend 呼び出しの所要時間。
// 使い方（起動済みの Electron に対して）: node attach.mjs rpc-probe.mjs
import { measure } from './timing.mjs';
export default async ({ cdp, l1 }) => {
  await l1.evalOn(cdp, `(()=>{const d=window.theia.container._bindingDictionary;window.__rpc=[];for(const k of d._map.keys()){let v;try{v=window.theia.container.get(k)}catch{continue}if(!v||typeof v!=='object')continue;
    for(const m of ['getAssetCatalogView','getPresetShowcase','getLibraryUsage','listMyStyles','getLibraryFavorites','getTransitionPreviewUrls']){if(typeof v[m]==='function'&&!v[m].__w){const o=v[m].bind(v);const w=async(...a)=>{const t=performance.now();try{return await o(...a)}finally{window.__rpc.push([m,Math.round(t-(window.__tm?.t0??0)),Math.round(performance.now()-t)])}};w.__w=true;v[m]=w}}}return true})()`);
  const out = {};
  for (const [name, cat] of [['textstyle', 'textstyle'], ['textanim', 'textanim'], ['textstyle-again', 'textstyle']]) {
    const spec = { cardSel: `[data-akari-catalog-preset-item^="${cat}/"]`, readyBody: `return true` };
    await l1.evalOn(cdp, 'window.__rpc=[],true');
    const r = await measure(cdp, spec, async now => { await now(); await l1.evalOn(cdp, l1.command('akari.catalog.open', { category: cat })); });
    out[name] = { firstCardVisibleMs: r.firstCardVisibleMs, rpc: await l1.evalOn(cdp, 'window.__rpc') };
  }
  return out;
};
