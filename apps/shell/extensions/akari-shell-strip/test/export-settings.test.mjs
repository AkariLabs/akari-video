import test from 'node:test';
import assert from 'node:assert/strict';
import {
    containerForCodec,
    describeOutput,
    EXPORT_FORMAT_SEATS,
    EXPORT_QUALITY_CHOICES,
    EXPORT_SETTING_SEATS,
    isMasterSelectable,
    isFormatSelectable,
    qualityChoiceForCli,
    resolveOutputResolution
} from '../lib/common/export-settings.js';

test('containerForCodec: MP4 / MOV / ディレクトリを codec から導く', () => {
    assert.deepEqual(containerForCodec('h264'), { ext: 'mp4', kind: 'file' });
    assert.deepEqual(containerForCodec('hevc'), { ext: 'mp4', kind: 'file' });
    assert.deepEqual(containerForCodec('prores422'), { ext: 'mov', kind: 'file' });
    assert.deepEqual(containerForCodec('png'), { ext: null, kind: 'directory' });
});

test('ProRes 422 HQ と連番 PNG の形式席・説明が選択形式に追従する', () => {
    assert.equal(isFormatSelectable('prores422'), true);
    assert.equal(isFormatSelectable('png'), true);
    const base = {
        quality: 'standard', engine: 'auto', encoder: 'auto', fps: undefined,
        resolution: 'native', customWidth: undefined, outputDirectoryUri: undefined,
        rerunLint: true, saveAsDefault: false
    };
    const prores = describeOutput({ ...base, codec: 'prores422' }, { output: { width: 1920, height: 1080, fps: 30 } });
    assert.equal(prores[0].value, 'MOV · ProRes 422 HQ / PCM 48 kHz');
    assert.equal(prores[3].value, '10-bit · Rec.709');
    const png = describeOutput({ ...base, codec: 'png' }, { output: { width: 1920, height: 1080, fps: 30 } });
    assert.equal(png[0].value, '連番 PNG / WAV 48 kHz');
});

test('3 択は標準 / 高画質 / 軽量を CLI 値へ対応させる', () => {
    assert.deepEqual(EXPORT_QUALITY_CHOICES.map(choice => [choice.label, choice.id]), [
        ['標準', 'standard'], ['高画質', 'high'], ['軽量', 'light']
    ]);
    assert.equal(qualityChoiceForCli('high')?.label, '高画質');
    assert.equal(qualityChoiceForCli('master'), undefined);
});

test('マスターは x264 のときだけ選べる', () => {
    assert.equal(isMasterSelectable('x264'), true);
    assert.equal(isMasterSelectable('auto'), false);
    assert.equal(isMasterSelectable('videotoolbox'), false);
});

test('近日の席を 12 個以上、tooltip つきで保持する', () => {
    const unavailable = EXPORT_SETTING_SEATS.filter(seat => !seat.available);
    assert.ok(unavailable.length >= 12);
    assert.ok(unavailable.every(seat => seat.tooltip));
});

test('describeOutput: 現在の固定出力を 4 行で返す', () => {
    const lines = describeOutput({
        quality: 'standard', engine: 'auto', encoder: 'auto', fps: undefined,
        resolution: 'native', customWidth: undefined,
        outputDirectoryUri: undefined, rerunLint: true, saveAsDefault: false
    }, { output: { width: 1920, height: 1080, fps: 30 } });
    assert.equal(lines.length, 4);
    assert.deepEqual(lines.map(line => line.label), ['形式', '画素数', '音', '色']);
    assert.match(lines[1].value, /1920 × 1080/);
});

test('resolveOutputResolution: native は edit.json の画素数を維持する', () => {
    assert.deepEqual(
        resolveOutputResolution({ width: 1920, height: 1080 }, { resolution: 'native' }),
        { width: 1920, height: 1080, mode: 'none' }
    );
});

test('resolveOutputResolution: 720p と 4K は画角を保って縮小・拡大する', () => {
    assert.deepEqual(
        resolveOutputResolution({ width: 1920, height: 1080 }, { resolution: '720p' }),
        { width: 1280, height: 720, mode: 'down' }
    );
    assert.deepEqual(
        resolveOutputResolution({ width: 1920, height: 1080 }, { resolution: '4k' }),
        { width: 3840, height: 2160, mode: 'up' }
    );
});

test('resolveOutputResolution: custom の奇数幅と高さを偶数へ丸める', () => {
    assert.deepEqual(
        resolveOutputResolution({ width: 1920, height: 1080 }, { resolution: 'custom', customWidth: 959 }),
        { width: 960, height: 540, mode: 'down' }
    );
});

test('resolveOutputResolution: 縦動画の 720p は 720×1280', () => {
    assert.deepEqual(
        resolveOutputResolution({ width: 1080, height: 1920 }, { resolution: '720p' }),
        { width: 720, height: 1280, mode: 'down' }
    );
});

test('resolveOutputResolution: custom 幅は 320〜7680 に収める', () => {
    assert.equal(resolveOutputResolution(
        { width: 1920, height: 1080 }, { resolution: 'custom', customWidth: 1 }
    ).width, 320);
    assert.equal(resolveOutputResolution(
        { width: 1920, height: 1080 }, { resolution: 'custom', customWidth: 9999 }
    ).width, 7680);
});

test('describeOutput: 画素数行にプリセットと拡縮 mode を併記する', () => {
    const lines = describeOutput({
        quality: 'standard', engine: 'auto', encoder: 'auto', fps: undefined,
        resolution: '720p', customWidth: undefined,
        outputDirectoryUri: undefined, rerunLint: true, saveAsDefault: false
    }, { output: { width: 1920, height: 1080, fps: 30 } });
    assert.match(lines[1].value, /1280 × 720（720p・縮小/u);
});

test('H.265（HEVC）の形式席を選べ、形式説明が codec に追従する', () => {
    const hevc = EXPORT_FORMAT_SEATS.find(seat => seat.id === 'hevc');
    assert.equal(hevc?.available, true);
    assert.match(hevc?.tooltip ?? '', /X は非対応/u);
    assert.equal(isFormatSelectable('h264'), true);
    assert.equal(isFormatSelectable('hevc'), true);
    assert.equal(isFormatSelectable('prores422'), true);
    const lines = describeOutput({
        quality: 'standard', engine: 'auto', encoder: 'auto', codec: 'hevc', fps: undefined,
        resolution: 'native', customWidth: undefined,
        outputDirectoryUri: undefined, rerunLint: true, saveAsDefault: false
    }, { output: { width: 1920, height: 1080, fps: 30 } });
    assert.equal(lines[0].value, 'MP4 · H.265（HEVC） / AAC 48 kHz');
});
