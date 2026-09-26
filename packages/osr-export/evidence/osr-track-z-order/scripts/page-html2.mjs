// OSR ページの HTML を 2 つのツリーで作り、ツリーの絶対パスと page-runtime の中身を除いて比べる
const OSR_Z_WORK = process.env.OSR_Z_WORK; // 作業ディレクトリ（fixture/ out/ を置く）
import { readFileSync } from 'node:fs';
const [a, b, ...names] = process.argv.slice(2);
const norm = (tree, html) => html.replaceAll(tree, '<tree>')
  .replace(readFileSync(`${tree}/packages/osr-export/src/page-runtime.js`, 'utf8'), '<page-runtime>');
for (const name of names) {
  const pages = [];
  for (const tree of [a, b]) {
    const { loadAndBuildOsrPage } = await import(`${tree}/packages/osr-export/src/page-builder.mjs`);
    const page = await loadAndBuildOsrPage({ projectRoot: `${OSR_Z_WORK}/fixture/${name}` });
    pages.push({ html: norm(tree, page.html), sheet: norm(tree, page.overlaySheetHtml) });
  }
  console.log(JSON.stringify({ name, htmlIdenticalExceptRuntime: pages[0].html === pages[1].html, sheetIdentical: pages[0].sheet === pages[1].sheet }));
}
