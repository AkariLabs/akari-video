#!/usr/bin/env node
// Stage runtime npm dependencies for the packaged GPU exporter.
// Resources/packages/node_modules serves the CLI packages through Node's upward lookup,
// independently of app.asar. The entry list explains why staging remains necessary.

import { cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
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
    cpSync(directory, target, {
        recursive: true,
        dereference: true,
        preserveTimestamps: true,
        // `.bin` は npm が作る CLI シムのディレクトリで、中身は他パッケージへの相対 symlink。
        // cpSync の dereference はコピー元のトップレベルにしか効かず、ツリー内部の symlink は
        // 「symlink のまま・宛先を絶対パスへ解決して」複製される。その絶対パスは .app の外を
        // 指すため、codesign が
        //   `AKARI Video.app: invalid destination for symbolic link in bundle`
        // で署名を拒否し、package が丸ごと落ちる（2026-08-20 実測。40 分かけて 2 回踏んだ）。
        // 同梱 CLI は .bin シムを一切使わない（render-cut は「.bin シムは Windows で
        // spawn できない」という理由から、常に node へパッケージ入口を直接渡す実装）ので、
        // まるごと除外するのが正しい。
        filter: source => basename(source) !== '.bin',
    });
}

// 除外し漏れの保険。staging に symlink が 1 つでも残っていたら、.app の外を指す可能性が
// あるのでここで止める（署名まで進んでから 40 分後に落ちるより、prepackage で落とす）。
const remainingSymlinks = [];
{
    const stack = [STAGING_DIR];
    while (stack.length > 0) {
        for (const entry of readdirSync(stack.pop(), { withFileTypes: true, encoding: 'utf8' })) {
            const child = join(entry.parentPath ?? entry.path, entry.name);
            if (entry.isSymbolicLink()) {
                remainingSymlinks.push(`${child} -> ${readlinkSync(child)}`);
            } else if (entry.isDirectory()) {
                stack.push(child);
            }
        }
    }
}
if (remainingSymlinks.length > 0) {
    throw new Error(
        'staging に symlink が残っています（codesign が .app 内の外部宛 symlink を拒否します）:\n'
        + remainingSymlinks.map(line => `  ${line}`).join('\n'),
    );
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
