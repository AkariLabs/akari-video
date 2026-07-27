import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CLOUD_PROVIDER_ID,
    repairCloudConnection,
    withCloudConnectionOk
} from '../lib/common/cloud-connections.js';

// 接続成立時の connections.json 自動修復。ゲートの SSOT（akari-cloud provider の
// doctor.status）を、エントリが無いプロジェクトでも ok にできることと、
// ファイル自体が無いプロジェクトには何も作らないことを押さえる。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../../..');
const VALIDATOR = path.join(REPO_ROOT, 'packages/schemas/bin/validate-connections.mjs');
const NOW = '2026-07-27T04:05:06.000Z';

/** akari-cloud エントリだけが欠けた最小レジストリ（雛形から当該エントリを抜いた形）。 */
function registryWithoutCloud() {
    return {
        providers: [
            {
                id: 'voicevox',
                kind: 'tts',
                auth: 'none',
                env: null,
                models: { default: null, allowed: [] },
                notes: {
                    description: 'VOICEVOX ローカルエンジン。',
                    workflows: ['42 AI 生成素材'],
                    billing: '無償（ローカル実行）。',
                    quota: 'なし。',
                    scopes: ['音声合成'],
                    setup_url: 'https://voicevox.hiroshiba.jp/'
                },
                doctor: { last_checked: null, status: 'unchecked', detail: '未確認' }
            }
        ],
        policy: { currency: 'JPY', monthly_budget: null, approval_threshold: null },
        memory: []
    };
}

function findCloud(registry) {
    return registry.providers.find(provider => provider.id === CLOUD_PROVIDER_ID);
}

test('withCloudConnectionOk: エントリ不在なら追加して doctor を ok にする', () => {
    const patch = withCloudConnectionOk(registryWithoutCloud(), NOW);
    assert.equal(patch.added, true);
    assert.equal(patch.registry.providers.length, 2);
    const cloud = findCloud(patch.registry);
    assert.deepEqual(cloud.doctor, {
        last_checked: NOW,
        status: 'ok',
        detail: 'AI パートナーの接続を確認しました（ローカル CLI 接続の成立で判定、v0）。'
    });
    assert.equal(cloud.kind, 'genai');
    assert.equal(cloud.auth, 'login');
    assert.equal(cloud.env, null);
    assert.deepEqual(cloud.models, { default: null, allowed: [] });
    assert.deepEqual(Object.keys(cloud), ['id', 'kind', 'auth', 'env', 'models', 'notes', 'doctor']);
    // 既存の他プロバイダには触らない。
    assert.equal(patch.registry.providers[0].doctor.status, 'unchecked');
});

test('withCloudConnectionOk: 追加したエントリは connections.json スキーマを満たす', async () => {
    const patch = withCloudConnectionOk(registryWithoutCloud(), NOW);
    const dir = await mkdtemp(path.join(tmpdir(), 'akari-connections-'));
    const target = path.join(dir, 'connections.json');
    await writeFile(target, `${JSON.stringify(patch.registry, null, 2)}\n`, 'utf8');
    // packages/schemas の検証 CLI（依存ゼロ）に実物を通す。exit 0 = スキーマ適合。
    const output = execFileSync(process.execPath, [VALIDATOR, target], { encoding: 'utf8' });
    assert.match(output, /OK/);
});

test('withCloudConnectionOk: 既存エントリは doctor だけ差し替える（現行維持）', () => {
    const registry = registryWithoutCloud();
    registry.providers.push({
        id: CLOUD_PROVIDER_ID,
        kind: 'genai',
        auth: 'login',
        env: null,
        models: { default: null, allowed: ['keep-me'] },
        notes: {
            description: '手で書かれた説明。',
            workflows: ['42 AI 生成素材'],
            billing: '契約に従う。',
            quota: '上限に従う。',
            scopes: ['生成機能'],
            setup_url: null
        },
        doctor: { last_checked: null, status: 'unchecked', detail: '未確認' }
    });
    const patch = withCloudConnectionOk(registry, NOW);
    assert.equal(patch.added, false);
    assert.equal(patch.registry.providers.length, 2);
    const cloud = findCloud(patch.registry);
    assert.equal(cloud.doctor.status, 'ok');
    assert.equal(cloud.doctor.last_checked, NOW);
    // doctor 以外は書き換えない。
    assert.deepEqual(cloud.models.allowed, ['keep-me']);
    assert.equal(cloud.notes.description, '手で書かれた説明。');
});

test('withCloudConnectionOk: providers が配列でなくてもエントリを作れる', () => {
    const patch = withCloudConnectionOk({ policy: {} }, NOW);
    assert.equal(patch.added, true);
    assert.equal(findCloud(patch.registry).doctor.status, 'ok');
});

test('withCloudConnectionOk: レジストリの体を成さない値には触らない', () => {
    assert.equal(withCloudConnectionOk(undefined, NOW), undefined);
    assert.equal(withCloudConnectionOk(null, NOW), undefined);
    assert.equal(withCloudConnectionOk([], NOW), undefined);
    assert.equal(withCloudConnectionOk('{}', NOW), undefined);
});

test('repairCloudConnection: connections.json が無ければ何も書かない', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-project-'));
    const target = path.join(root, '.akari/connections.json');
    let writes = 0;
    const outcome = await repairCloudConnection({
        read: async () => {
            try {
                return await readFile(target, 'utf8');
            } catch {
                return undefined;
            }
        },
        write: async text => {
            writes++;
            await mkdir(path.dirname(target), { recursive: true });
            await writeFile(target, text, 'utf8');
        }
    }, NOW);
    assert.equal(outcome, 'missing');
    assert.equal(writes, 0);
    // `.akari/` ごとスキャフォールドしていないこと（F17）。
    assert.deepEqual(await readdir(root), []);
});

test('repairCloudConnection: 実ファイルに対して追記し、読み返せる', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'akari-project-'));
    const target = path.join(root, '.akari/connections.json');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(registryWithoutCloud(), null, 2)}\n`, 'utf8');
    const access = {
        read: async () => {
            try {
                return await readFile(target, 'utf8');
            } catch {
                return undefined;
            }
        },
        write: async text => writeFile(target, text, 'utf8')
    };

    assert.equal(await repairCloudConnection(access, NOW), 'added');
    const written = await readFile(target, 'utf8');
    assert.ok(written.endsWith('}\n'));
    assert.equal(findCloud(JSON.parse(written)).doctor.status, 'ok');

    // 2 回目は追加ではなく更新（冪等 — エントリは増えない）。
    assert.equal(await repairCloudConnection(access, NOW), 'updated');
    assert.equal(JSON.parse(await readFile(target, 'utf8')).providers.length, 2);
});

test('repairCloudConnection: 壊れた JSON は skipped で書き戻さない', async () => {
    let writes = 0;
    const outcome = await repairCloudConnection({
        read: async () => '{ これは JSON ではない',
        write: async () => { writes++; }
    }, NOW);
    assert.equal(outcome, 'skipped');
    assert.equal(writes, 0);
});
