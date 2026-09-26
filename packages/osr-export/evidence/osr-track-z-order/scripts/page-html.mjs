// OSR ページの HTML を 2 つのツリーで作って比べる: node page-html.mjs <treeA> <treeB> <fixture...>
const OSR_Z_WORK = process.env.OSR_Z_WORK; // 作業ディレクトリ（fixture/ out/ を置く）
import { createHash } from 'node:crypto';
const [a, b, ...names] = process.argv.slice(2);
const build = async (tree, name) => {
  const { loadAndBuildOsrPage } = await import(`${tree}/packages/osr-export/src/page-builder.mjs`);
  const page = await loadAndBuildOsrPage({ projectRoot: `${OSR_Z_WORK}/fixture/${name}` });
  return page;
};
for (const name of names) {
  const [pa, pb] = [await build(a, name), await build(b, name)];
  const h = s => createHash('sha256').update(s).digest('hex').slice(0, 12);
  const stage = html => (html.match(/<div id="akari-stage">([\s\S]*?)<\/div>/u)?.[1] ?? '').replace(/srcdoc="[^"]*"/gu, 'srcdoc="…"').replace(/\s+/gu, ' ').trim();
  console.log(JSON.stringify({ name, identical: pa.html === pb.html, a: h(pa.html), b: h(pb.html), sheetIdentical: pa.overlaySheetHtml === pb.overlaySheetHtml, stageB: stage(pb.html).slice(0, 900) }));
}
