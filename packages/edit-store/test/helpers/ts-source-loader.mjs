/**
 * 隣のパッケージの TypeScript ソースを、ビルド成果物（dist/）を用意せずに import するための
 * 解決フック。Node の型剥がし（.ts をそのまま実行）は拡張子の書き換えまではしないため、
 * `./x.js` の指定を実体が無いときだけ `./x.ts` へ倒す。
 *
 * 用途は「同型の純関数が本当に一致していること」をテストで固定する照合だけ。
 * 本番コードがこのフックに依存してはならない。
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && specifier.endsWith('.js') && context.parentURL?.endsWith('.ts')) {
    const asDeclared = new URL(specifier, context.parentURL);
    if (!existsSync(fileURLToPath(asDeclared))) {
      const asSource = new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL);
      if (existsSync(fileURLToPath(asSource))) return { url: asSource.href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
