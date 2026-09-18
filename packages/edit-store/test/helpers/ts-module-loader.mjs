/**
 * `src/*.ts` を lib/ のビルド成果物なしで import するための解決 + 読み込みフック。
 *
 * 隣の `ts-source-loader.mjs` は「`./x.js` 指定を `./x.ts` へ倒す」だけなので、
 * edit-store 内部のような**拡張子なし**の相対 import（`./audio-ownership`）と、
 * `type` 修飾の無い型専用 named import（`import { EditCut, … }`）を解けない
 * （Node の型剥がしは import 指定子の書き換えも型専用指定子の除去もしない）。
 * ここでは解決を拡張子なし・`/index.ts` まで広げ、読み込みを TypeScript の
 * `transpileModule` に通すことで両方を解く。
 *
 * 用途は「lib/ を再生成せずに src の実装そのものを検査する」テストだけ。
 * 本番コードがこのフックに依存してはならない。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// リポのパスに日本語が含まれるため、パスは常に fileURLToPath 経由で組む。
const ts = createRequire(import.meta.url)('typescript');

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts')) {
    const candidates = [
      specifier.replace(/\.js$/u, '.ts'),
      `${specifier}.ts`,
      `${specifier}/index.ts`,
    ];
    for (const candidate of candidates) {
      const url = new URL(candidate, context.parentURL);
      if (existsSync(fileURLToPath(url))) {
        return { url: url.href, format: 'module', shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith('.ts')) return nextLoad(url, context);
  const fileName = fileURLToPath(url);
  const transpiled = ts.transpileModule(readFileSync(fileName, 'utf8'), {
    fileName,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      inlineSourceMap: true,
      inlineSources: true,
    },
  });
  return { format: 'module', source: transpiled.outputText, shortCircuit: true };
}
