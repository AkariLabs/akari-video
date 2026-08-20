#!/usr/bin/env node
// bundle-cli-node-modules.mjs — 同梱 CLI（packages/render-cut・packages/bake-layer）が
// 実行時に必要とする npm 依存を、パッケージ版の Resources へ持ち込むための staging。
//
// なぜ必要か: extraResources で `packages/<cli>` を配っても、その CLI が import する
// npm 依存はモノレポルートの node_modules にしか無い。パッケージ版の Resources 配下には
// node_modules が一切無いため、Node の上方探索がどこにも当たらず
//   - render-cut: puppeteer-core 不在 → オーバーレイのラスタライザが静止画
//     （static-screenshot）へ黙って縮退する。3D オーバーレイは実行時エラー
//   - bake-layer: `import puppeteer` / `import { build } from "esbuild"` が
//     トップレベルで落ち、CLI が起動すらしない
// になる。
//
// 置き場は Resources/packages/node_modules。Resources 配下は `packages/<name>` という
// リポジトリと同じ相対配置になっているので（render-cut の caption-font.mjs が
// Resources をリポジトリルートとみなして assets/font を引くのと同じ前提）、
// packages/ の直下に node_modules を置けば Node の上方探索が render-cut からも
// bake-layer からも同じ 1 本に当たる。app.asar 内のバックエンドからは（探索経路が
// app.asar/… で閉じるため）見えない位置なので、シェル本体の依存解決には影響しない。
//
// hyperframes を同梱しない判断の根拠は bundled-cli-npm-entries.mjs のコメントにある。

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUNDLED_CLI_NPM_ENTRIES } from './bundled-cli-npm-entries.mjs';

const SHELL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_ROOT = resolve(SHELL_DIR, '..', '..');
const STAGING_DIR = join(SHELL_DIR, 'resources', 'cli-node-modules');

/** 入口の一覧は通知生成と共有する（bundled-cli-npm-entries.mjs のコメント参照）。 */
const ENTRY_PACKAGES = BUNDLED_CLI_NPM_ENTRIES;

/** Node と同じ上方探索で <name>/package.json を持つディレクトリを探す。 */
function findPackageDirectory(name, fromDirectory) {
    let directory = fromDirectory;
    for (;;) {
        const candidate = join(directory, 'node_modules', name);
        if (existsSync(join(candidate, 'package.json'))) {
            return candidate;
        }
        const parent = dirname(directory);
        if (parent === directory) {
            return undefined;
        }
        directory = parent;
    }
}

/**
 * 推移クロージャ。optionalDependencies も辿るが、未インストール（他プラットフォーム向けの
 * @esbuild/* 等）は素通りする — npm が現在のプラットフォーム向けだけを展開しているため。
 */
function collectClosure(entries) {
    const found = new Map();
    const queue = entries.map(name => ({ name, from: REPO_ROOT }));
    while (queue.length > 0) {
        const { name, from } = queue.shift();
        const directory = findPackageDirectory(name, from);
        if (!directory) {
            if (entries.includes(name)) {
                throw new Error(`同梱対象の npm パッケージが見つかりません: ${name}（npm install が未完了の可能性）`);
            }
            continue;
        }
        if (found.has(directory)) {
            continue;
        }
        const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
        found.set(directory, name);
        for (const dependency of Object.keys(manifest.dependencies ?? {})) {
            queue.push({ name: dependency, from: directory });
        }
        for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
            queue.push({ name: dependency, from: directory });
        }
    }
    return found;
}

function directoryBytes(path) {
    let total = 0;
    const stack = [path];
    while (stack.length > 0) {
        for (const entry of readdirSync(stack.pop(), { withFileTypes: true, encoding: 'utf8' })) {
            const child = join(entry.parentPath ?? entry.path, entry.name);
            if (entry.isDirectory()) {
                stack.push(child);
            } else if (entry.isFile()) {
                total += statSync(child).size;
            }
        }
    }
    return total;
}

const closure = collectClosure(ENTRY_PACKAGES);
rmSync(STAGING_DIR, { recursive: true, force: true });
mkdirSync(STAGING_DIR, { recursive: true });

for (const directory of closure.keys()) {
    // モノレポの node_modules 内での相対配置（ネストした node_modules も含む）をそのまま保つ。
    // ネストは版衝突の解決結果そのものなので、平坦化すると解決が変わる。
    const relativePath = directory.slice(join(REPO_ROOT, 'node_modules').length + 1);
    const target = join(STAGING_DIR, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(directory, target, { recursive: true, dereference: true, preserveTimestamps: true });
}

const megabytes = (directoryBytes(STAGING_DIR) / (1024 * 1024)).toFixed(1);
console.log(`bundle-cli-node-modules: ${closure.size} packages / ${megabytes}MB -> resources/cli-node-modules`);

// 同梱後の自己点検: 入口パッケージの実体（package.json と main 入口）が staging に
// 実在することを確認する。パッケージ版での「本当に require.resolve できるか」は
// harness/scripts/rebuild-and-verify.sh が .app の実配置に対して実行する。
for (const name of ENTRY_PACKAGES) {
    const manifestPath = join(STAGING_DIR, name, 'package.json');
    if (!existsSync(manifestPath)) {
        throw new Error(`staging に ${name}/package.json がありません: ${manifestPath}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const entry = manifest.main ?? manifest.module ?? 'index.js';
    // exports だけを持つパッケージもあるため、main が無い/当たらない場合は警告に留めない —
    // exports 経由の解決は実配置での検証（rebuild-and-verify.sh）に委ねる。
    if (typeof entry === 'string' && !existsSync(join(STAGING_DIR, name, entry)) && manifest.exports === undefined) {
        throw new Error(`staging の ${name} に入口 ${entry} がありません`);
    }
}
