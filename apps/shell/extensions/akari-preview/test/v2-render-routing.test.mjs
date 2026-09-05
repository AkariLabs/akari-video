import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const browserSource = readFileSync(
    join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'),
    'utf8'
);
const backendSource = readFileSync(
    join(here, '..', 'src', 'node', 'akari-preview-service.ts'),
    'utf8'
);

test('preview z is resolved from normalized track ids, including mixed tracks', () => {
    assert.match(browserSource, /resolveInternalTrackZ/);
    assert.match(browserSource, /trackIdByItem/);
    assert.match(browserSource, /zForTrack\(segment\.trackId\)/);
    assert.doesNotMatch(browserSource, /resolveVisualTrackZ/);
});

test('unbaked telop is retired without rasterization; filters still draw', () => {
    assert.doesNotMatch(browserSource, /rasterizeTelopPreview/);
    assert.match(browserSource, /retiredTelop: true/);
    assert.match(browserSource, /テロップ（ATF）は退役しました/);
    assert.doesNotMatch(browserSource, /await this\.previewService\.rasterizeTelopPreview/);
    assert.match(browserSource, /type: 'akari-preview-model-update'/);
    assert.doesNotMatch(backendSource, /--kind', 'telop'/);
    assert.match(backendSource, /throw new Error\('telop\.retired:/);
    // 退役前は telop ラスタだけが preview backend から Node CLI 子プロセス（bake-layer）を
    // 起こす経路だった。その経路の専用装備（bake-layer 入口の探索・runProcess・
    // 子プロセス env の ELECTRON_RUN_AS_NODE・その戻り値を作る nodeCliCommand）が
    // 実装ごと消えていることが、「telop は spawn しない」の backend 側の証拠になる。
    assert.doesNotMatch(backendSource, /bake-layer/);
    assert.doesNotMatch(backendSource, /findBakeLayerEntry/);
    assert.doesNotMatch(backendSource, /runProcess/);
    assert.doesNotMatch(backendSource, /nodeCliCommand/);
    assert.doesNotMatch(backendSource, /ELECTRON_RUN_AS_NODE/);
    // 退役するのは未焼成（baked 無し）の telop だけ。baked を持つ項目は従来どおり
    // baked レイヤーへ写り、.preview.webm サイドカー経路で再生できる。
    assert.match(browserSource, /item\.source\.kind === 'telop' && item\.source\.baked === undefined/);
    assert.match(browserSource, /kind: 'baked', src: `deferred-telop:\$\{item\.id\}`/);
    assert.match(browserSource, /data-akari-filter-id/);
    assert.match(browserSource, /backdropFilter = cssFilterFor/);
});
