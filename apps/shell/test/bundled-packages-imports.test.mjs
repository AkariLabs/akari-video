// パッケージ済み .app へ写す packages/（lib/packages/ 配下）の import 不変条件テスト。
//
// 発端は v0.1.39 の実機報告:
//   「新しい動画の作成に失敗しました（Cannot find module
//    '…/app.asar/lib/packages/akari-launcher/src/history-policy.mjs' imported from
//    '…/app.asar/lib/packages/project-scaffold/src/index.mjs'）」
//
// 機構: copy-native-helpers.mjs は lib/packages/ へ写すパッケージを名前の決め打ちリスト
//   （project-scaffold / creator-root）で持っていた。issue #48 の対応で project-scaffold が
//   `../../akari-launcher/src/history-policy.mjs` を import するようになったが、その写しは
//   リストに無いので asar に入らない。リポジトリ内では上方探索が本物の packages/ に当たって
//   しまうため開発中は一切露見せず、.app をリポの外（/Applications）へ置いた配布版でだけ落ちた。
//
// copy-native-helpers.mjs 側は相対 import を辿って写すようになり、verify-asar-contents.mjs も
// 実在を見るが、どちらもパッケージング時にしか回らない。ここでは同じ不変条件を
// 「packages/ のソースを読むだけ」で固定して、npm test の時点で落とす。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packagesRoot = path.join(repoRoot, 'packages');

// copy-native-helpers.mjs が lib/packages/ へ写す起点。あちらを増やしたらここも増やす。
const BUNDLED_PACKAGES = ['project-scaffold', 'creator-root'];

async function listEsmFiles(directory) {
    const found = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        const candidate = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            found.push(...(await listEsmFiles(candidate)));
        } else if (entry.isFile() && /\.(?:mjs|js)$/.test(entry.name)) {
            found.push(candidate);
        }
    }
    return found;
}

/** 起点から相対 import を辿って到達する packages/ 内のファイル全部（連鎖・循環対応）。 */
async function reachableFiles(rootNames) {
    const queue = [];
    for (const name of rootNames) {
        queue.push(...(await listEsmFiles(path.join(packagesRoot, name, 'src'))));
    }
    const visited = new Set(queue);
    const escaping = [];
    while (queue.length > 0) {
        const file = queue.shift();
        const contents = await readFile(file, 'utf8');
        for (const match of contents.matchAll(/(?:^|\n)\s*(?:import|export)[^'"]*?from\s*['"](\.[^'"]*)['"]/g)) {
            const resolved = path.resolve(path.dirname(file), match[1]);
            if (!resolved.startsWith(`${packagesRoot}${path.sep}`)) {
                escaping.push({ file: path.relative(repoRoot, file), specifier: match[1] });
                continue;
            }
            if (!visited.has(resolved)) {
                visited.add(resolved);
                queue.push(resolved);
            }
        }
    }
    return { visited, escaping };
}

test('同梱パッケージの相対 import は packages/ の外へ出ない（写せないものは配布版で落ちる）', async () => {
    const { escaping } = await reachableFiles(BUNDLED_PACKAGES);
    assert.deepEqual(escaping, [], `packages/ の外を import しているため lib/packages/ へ写せません: ${JSON.stringify(escaping)}`);
});

test('同梱パッケージから辿れる import 先はすべて実在する', async () => {
    const { visited } = await reachableFiles(BUNDLED_PACKAGES);
    const missing = [...visited].filter(file => !existsSync(file)).map(file => path.relative(repoRoot, file));
    assert.deepEqual(missing, [], `import 先が存在しません: ${JSON.stringify(missing)}`);
});

test('パッケージの外を指す import は verify-asar-contents の必須リストに載っている', async () => {
    const { visited } = await reachableFiles(BUNDLED_PACKAGES);
    const crossPackage = [...visited]
        .map(file => path.relative(packagesRoot, file))
        .filter(relative => !BUNDLED_PACKAGES.includes(relative.split(path.sep)[0]))
        .map(relative => `/lib/packages/${relative.split(path.sep).join('/')}`);
    const verifier = await readFile(path.join(repoRoot, 'apps/shell/resources/scripts/verify-asar-contents.mjs'), 'utf8');
    const unguarded = crossPackage.filter(entry => !verifier.includes(`'${entry}'`));
    assert.deepEqual(unguarded, [], `パッケージング検収の requiredFiles に追加してください: ${JSON.stringify(unguarded)}`);
});

test('発端の history-policy.mjs が現に検出対象へ入っている（回帰の錨）', async () => {
    const { visited } = await reachableFiles(BUNDLED_PACKAGES);
    const relatives = [...visited].map(file => path.relative(repoRoot, file));
    assert.ok(
        relatives.includes(path.join('packages', 'akari-launcher', 'src', 'history-policy.mjs')),
        `history-policy.mjs へ到達できていません。到達集合: ${JSON.stringify(relatives)}`
    );
});
