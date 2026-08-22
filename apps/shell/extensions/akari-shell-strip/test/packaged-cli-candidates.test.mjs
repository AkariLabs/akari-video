import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { bundledMediaBinCandidate, packagedCliCandidates } from '../lib/node/packaged-cli-candidates.js';

// パッケージ版バックエンドの実測値（`theia build` の単一バンドルなので __dirname は常にここ）。
const PACKAGED_DIRNAME = '/Applications/AKARI Video.app/Contents/Resources/app.asar/lib/backend';
const RESOURCES_PATH = '/Applications/AKARI Video.app/Contents/Resources';
// 開発起動（npm start / Electron 直起動）での __dirname。
const DEV_DIRNAME = '/repo/apps/shell/lib/backend';

test('packagedCliCandidates: resourcesPath 基点が最優先', () => {
    const candidates = packagedCliCandidates('render-cut', 'render-cut.mjs', PACKAGED_DIRNAME, RESOURCES_PATH);
    assert.equal(candidates[0], resolve(RESOURCES_PATH, 'packages/render-cut/bin/render-cut.mjs'));
});

test('packagedCliCandidates: resourcesPath が無くても祖先探索で Resources 配下に当たる', () => {
    // process.resourcesPath が使えない経路でも壊れないことの保証（多重防御）。
    const candidates = packagedCliCandidates('render-cut', 'render-cut.mjs', PACKAGED_DIRNAME);
    assert.ok(
        candidates.includes(resolve(RESOURCES_PATH, 'packages/render-cut/bin/render-cut.mjs')),
        `Resources 基点の候補が祖先探索に含まれていない: ${candidates.join(', ')}`
    );
});

test('packagedCliCandidates: 開発配置ではリポルート直下の packages/ に当たる', () => {
    const candidates = packagedCliCandidates('edit-lint', 'edit-lint.mjs', DEV_DIRNAME);
    assert.ok(
        candidates.includes('/repo/packages/edit-lint/bin/edit-lint.mjs'),
        `リポルート基点の候補が無い: ${candidates.join(', ')}`
    );
});

test('packagedCliCandidates: process.cwd() に依存しない（cwd を変えても結果が一致する）', () => {
    // 受け入れ条件「探索パスが process.cwd() に依存しなくなっている」の機械化。
    // 旧実装は cwd 起点の候補を 2 件持っており、パッケージ版（cwd = `/`）では
    // どちらも `/packages/...` に潰れて当たらなかった。
    const original = process.cwd();
    try {
        process.chdir('/tmp');
        const fromTmp = packagedCliCandidates('render-cut', 'render-cut.mjs', PACKAGED_DIRNAME, RESOURCES_PATH);
        process.chdir('/');
        const fromRoot = packagedCliCandidates('render-cut', 'render-cut.mjs', PACKAGED_DIRNAME, RESOURCES_PATH);
        assert.deepEqual(fromTmp, fromRoot);
    } finally {
        process.chdir(original);
    }
});

test('packagedCliCandidates: 後方互換の兄弟配置候補を末尾に持つ', () => {
    const candidates = packagedCliCandidates('render-cut', 'render-cut.mjs', PACKAGED_DIRNAME, RESOURCES_PATH);
    assert.equal(candidates.at(-1), resolve(PACKAGED_DIRNAME, '../render-cut/bin/render-cut.mjs'));
});

test('packagedCliCandidates: 候補は重複しない', () => {
    const candidates = packagedCliCandidates('render-cut', 'render-cut.mjs', PACKAGED_DIRNAME, RESOURCES_PATH);
    assert.equal(new Set(candidates).size, candidates.length);
});

test('bundledMediaBinCandidate: Resources/media-bin を指す', () => {
    assert.equal(
        bundledMediaBinCandidate('ffmpeg', RESOURCES_PATH, 'darwin'),
        resolve(RESOURCES_PATH, 'media-bin/ffmpeg')
    );
    assert.equal(
        bundledMediaBinCandidate('ffprobe', RESOURCES_PATH, 'win32'),
        resolve(RESOURCES_PATH, 'media-bin/ffprobe.exe')
    );
});

test('bundledMediaBinCandidate: 開発起動（resourcesPath 未設定）では undefined', () => {
    assert.equal(bundledMediaBinCandidate('ffmpeg', undefined, 'darwin'), undefined);
});
