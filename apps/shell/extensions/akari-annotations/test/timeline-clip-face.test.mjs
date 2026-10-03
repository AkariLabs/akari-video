import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { shapeClipFace, htmlClipFace, clipFaceWidthPx } = require('../lib/common/timeline-clip-face.js');

test('帯の絵幅は四角を正方形、横長の線を高さの 2.5 倍、テロップを 16:9 にする', () => {
    const square = '<svg width="600" height="600" viewBox="0 0 600 600"></svg>';
    const line = '<svg width="360" height="72" viewBox="0 0 360 72"></svg>';
    assert.equal(clipFaceWidthPx(44, 'shape', square), 44);
    assert.equal(clipFaceWidthPx(44, 'shape', line), 110);
    assert.equal(clipFaceWidthPx(44, 'html'), 78.22);
});

test('円・歯車・破線・角丸四角の色と日本語名を帯へ出す', () => {
    const cases = [
        ['ellipse', 'basic-circle', '円', '<ellipse', {}],
        ['path', 'gear-16', '歯車（細かい歯）', '<path',
            { path: { d: 'M0 0 L100 0 L50 100 Z', vb: [100, 100] } }],
        ['line', 'line-dash-none-none', '破線・なし・なし', '<', { dash: 'dash' }],
        ['rounded-rect', 'basic-rounded-square', '角丸四角', '<rect', { cornerRadius: 12 }]
    ];
    for (const [shape, preset, name, element, extra] of cases) {
        const face = shapeClipFace({ id: preset, source: { kind: 'shape', shape,
            params: { fill: '#123456', stroke: '#abcdef', ...extra } } }, name);
        assert.equal(face.label, name);
        assert.match(face.svg, /<svg/u);
        assert.ok(face.svg.includes(element));
        assert.match(face.svg, /#123456|#abcdef/u);
        if (shape === 'path') assert.match(face.svg, /<path d="M0 0L/u);
        if (shape === 'line') assert.match(face.svg, /stroke-dasharray/u);
        if (shape === 'rounded-rect') assert.match(face.svg, /rx="12"/u);
    }
});

test('ユーザー名は棚の名前より優先される', () => {
    const face = shapeClipFace({ id: 'shape-1', name: '自分の印', source: { kind: 'shape', shape: 'ellipse' } }, '円');
    assert.equal(face.label, '自分の印');
});

test('HTML テロップは title と preview を使い、欠けた素材は既存ラベルへ戻る', () => {
    const item = { id: 'telop-1', source: { kind: 'html', path: 'assets/overlay/a/fragment.html' } };
    assert.deepEqual(htmlClipFace(item, 'telop-1', { title: '見出し' }, 'image:data'),
        { label: '見出し', preview: 'image:data' });
    assert.deepEqual(htmlClipFace(item, 'telop-1', { title: '見出し' }),
        { label: '見出し', preview: undefined });
    assert.deepEqual(htmlClipFace(item, 'telop-1'),
        { label: 'telop-1', preview: undefined });
    assert.equal(htmlClipFace({ ...item, name: '私の字幕' }, 'telop-1', { title: '見出し' }).label, '私の字幕');
});
