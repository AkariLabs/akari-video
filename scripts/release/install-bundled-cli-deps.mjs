#!/usr/bin/env node
// install-bundled-cli-deps.mjs — 同梱 CLI の実行時依存（BUNDLED_CLI_NPM_ENTRIES）を
// モノレポ **root** の node_modules へ導入する（CI 用）。
//
// なぜ必要か: リリース CI は apps/shell でしか `npm install --no-workspaces` を回さず、
// workspace パッケージ（render-cut / bake-layer）の依存は root node_modules に存在しない。
// 一方 bundle-cli-node-modules.mjs は root からの上方探索で入口パッケージを解決するため、
// CI では「同梱対象の npm パッケージが見つかりません」で package が落ちる（v0.1.13 で実測）。
// 開発機ではフル workspace install が root にあるため露見しなかった。
//
// 入口と版は既存の正本から導出する（ここに重複させない）:
// - 入口: apps/shell/resources/scripts/bundled-cli-npm-entries.mjs
// - 版:   各 CLI パッケージの package.json dependencies
//
// --ignore-scripts で入れる: puppeteer のブラウザ DL は不要（配布先はシステム Chrome へ
// フォールバックする）。esbuild のプラットフォームバイナリは optionalDependencies の
// パッケージとして script なしで入る。--no-save で root の package.json / lock を汚さない。
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { BUNDLED_CLI_NPM_ENTRIES } = await import(
    new URL('file://' + join(REPO_ROOT, 'apps/shell/resources/scripts/bundled-cli-npm-entries.mjs').replaceAll('\\', '/'))
);

const manifestPaths = [
    'packages/render-cut/package.json',
    'packages/bake-layer/package.json',
    'packages/frame-engine/package.json', // @webav/mp4box.js の版（gpu-export が直接 import・宣言は frame-engine）
];
const manifests = manifestPaths.map(p => JSON.parse(readFileSync(join(REPO_ROOT, p), 'utf8')));

const specs = BUNDLED_CLI_NPM_ENTRIES.map(name => {
    for (const manifest of manifests) {
        const version = manifest.dependencies?.[name];
        if (version) {
            return `${name}@${version}`;
        }
    }
    throw new Error(`版が特定できません: ${name}（${manifestPaths.join(' / ')} の dependencies に無い）`);
});

console.log('install-bundled-cli-deps:', specs.join(' '));
const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['install', '--no-workspaces', '--ignore-scripts', '--no-save', '--no-audit', '--no-fund', ...specs],
    { cwd: REPO_ROOT, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (result.status !== 0) {
    throw new Error(`npm install が失敗しました（exit ${result.status}）`);
}
// 早期ゲート: 入口が root から解決できることを確認してから package 工程へ進ませる
for (const name of BUNDLED_CLI_NPM_ENTRIES) {
    readFileSync(join(REPO_ROOT, 'node_modules', name, 'package.json'));
}
console.log('install-bundled-cli-deps: OK（root node_modules から全入口を解決可能）');
