// 帯 1 つの案件のページ HTML を基点と比べる: node page-html.mjs <repoA> <repoB> <fixtureDir>...
// 埋め込みの page-runtime（変更対象）とツリーの絶対パスを置き換えてから比較する
import { readFileSync } from 'node:fs';
import path from 'node:path';
const [a, b, ...fixtures] = process.argv.slice(2);
const html = async (repo, fixture) => {
    const { loadAndBuildGpuPage } = await import(path.join(repo, 'packages/gpu-export/src/page-builder.mjs'));
    const runtime = readFileSync(path.join(repo, 'packages/gpu-export/src/page-runtime.js'), 'utf8').replace(/<\/script/giu, '<\\/script');
    const page = await loadAndBuildGpuPage({ projectRoot: fixture });
    return page.html.replace(runtime, '<<page-runtime>>').replaceAll('/private' + repo, repo).replaceAll(repo, '<<repo>>');
};
for (const fixture of fixtures) {
    const [x, y] = [await html(a, fixture), await html(b, fixture)];
    console.log(JSON.stringify({ fixture: path.basename(fixture), identical: x === y, bytes: [x.length, y.length] }));
}
