#!/usr/bin/env node
// apps/shell/scripts/ensure-no-nested-extension-deps.mjs
//
// apps/shell/extensions/<ext>/node_modules/ を消す（dual-package hazard の予防）。
//
// なぜ要るか（2026-08-19 実測 / task 2026-08-19-shell-webpack-pin）:
//   拡張ディレクトリ配下に node_modules が出来ると（例: 拡張ディレクトリで直接
//   `npm install` を打つと 643 パッケージが入る）、そこに **@theia/core の 2 つ目の実体**が
//   置かれる。esbuild は realpath 単位でモジュールを束ねるので、
//     src-gen/frontend/index.js         → apps/shell/node_modules/@theia/core の Provider に set()
//     extensions/akari-preview/**       → 入れ子側の @theia/core の Provider から get()
//   という 2 つの別モジュールが 1 つの bundle.js に同居し、フロントエンドが
//     "The configuration is not set. Did you call FrontendApplicationConfigProvider#set?"
//   でプリロード画面のまま停止する（= verify スキル L1 §既知の地雷 1）。
//
//   拡張の依存（@theia/* / jsonc-parser / file: の workspace パッケージ）は
//   apps/shell/node_modules 側へ必ず hoist されているので、入れ子を消すと解決は
//   そちらへ落ちる。**入れ子側が要る場面は無い**（apps/shell/.gitignore も
//   /extensions/*/node_modules/ を無視対象にしている）ため、検出したら黙って直す。

import { readdirSync, existsSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = '[ensure-no-nested-extension-deps]';
const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionsDir = path.join(shellRoot, 'extensions');

if (!existsSync(extensionsDir)) {
  process.exit(0);
}

const removed = [];
for (const name of readdirSync(extensionsDir)) {
  const nested = path.join(extensionsDir, name, 'node_modules');
  if (!existsSync(nested)) continue;
  let count = 0;
  try {
    count = readdirSync(nested).filter((n) => n !== '.package-lock.json' && n !== '.bin').length;
  } catch {
    // 読めなくても消す
  }
  rmSync(nested, { recursive: true, force: true });
  removed.push(`extensions/${name}/node_modules (${count} エントリ)`);
}

if (removed.length === 0) {
  process.exit(0);
}

console.log(`${TAG} 入れ子の node_modules を削除しました（@theia/core 二重化 = フロントエンド起動不能の原因）:`);
for (const r of removed) console.log(`${TAG}   - ${r}`);
console.log(`${TAG} 拡張の依存は apps/shell/node_modules 側で解決されます。拡張ディレクトリ単体で npm install しないでください`);
