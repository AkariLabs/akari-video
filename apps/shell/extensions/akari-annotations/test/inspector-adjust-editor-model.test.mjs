import assert from 'node:assert/strict';
import test from 'node:test';
import * as model from '../lib/browser/inspector/adjust-editor-model.js';

for (const hue of [false, true]) {
    const axis = hue ? 'hue' : 'in';
    const value = hue ? 'value' : 'out';
    const name = hue ? 'Hue' : 'Curve';
    const point = (x, y) => ({ [axis]: x, [value]: y });
    const add = model[`add${name}Point`];
    const move = model[`move${name}Point`];
    const remove = model[`remove${name}Point`];
    test(`${name}: 追加・移動は単調性を維持し元配列を変えない`, () => {
        const original = [point(0, 0), point(1, 1)];
        const points = add(original, point(0.5, 0.8));
        assert.deepEqual(points.map(p => p[axis]), [0, 0.5, 1]);
        assert.equal(original.length, 2);
        assert.equal(add(points, point(0.5, 0)), points);
        assert.equal(add(points, point(0.50001, 0)), points);
        for (let index = 0; index < points.length; index++) {
            for (const x of [-2, 0, 0.5, 1, 3]) {
                const moved = move(points, index, point(x, x));
                assert.ok(moved.every((p, i) => i === 0 || p[axis] > moved[i - 1][axis]));
                assert.ok(moved.every(p => p[axis] >= 0 && p[axis] <= 1 && p[value] >= 0 && p[value] <= 1));
            }
        }
        assert.deepEqual(points, [point(0, 0), point(0.5, 0.8), point(1, 1)]);
        const close = [point(0, 0), point(0.00001, 0.2), point(0.00002, 0.4)];
        const moved = move(close, 1, point(1, 1));
        assert.ok(moved[0][axis] < moved[1][axis] && moved[1][axis] < moved[2][axis]);
    });
    test(`${name}: 点数の上下限・clamp・sort・空 path`, () => {
        const full = Array.from({ length: 16 }, (_, i) => point(i / 15, 0.3));
        assert.equal(add(full, point(0.1, 0)), full);
        assert.equal(add(full, point(0.1, 0), 8), full);
        const min = hue ? [point(0, 0.5)] : [point(0, 0), point(1, 1)];
        assert.equal(remove(min, 0), min);
        assert.equal(remove(full, 5).length, 15);
        assert.equal(remove(full, 0, 16), full);
        assert.deepEqual(model[`clamp${name}Point`](point(-1, 2)), point(0, 1));
        assert.deepEqual(model[`sort${name}Points`]([point(1, 1), point(0, 0)]), [point(0, 0), point(1, 1)]);
        assert.equal(model[hue ? 'huePathD' : 'curvePathD']([], 180, 140), '');
        assert.equal(model[hue ? 'huePathD' : 'curvePathD']([point(1, 1), point(0, 0)], 180, 140), 'M0.0,140.0L180.0,0.0');
    });
}

test('identity はエンジンと同じ許容値・Hue の既定は 6 点', () => {
    assert.equal(model.isCurveChannelIdentity(model.IDENTITY_CURVE_POINTS), true);
    assert.equal(model.isCurveChannelIdentity([{ in: 0, out: 0.000009 }, { in: 1, out: 1 }]), true);
    assert.equal(model.isCurveChannelIdentity([{ in: 0, out: 0.00001 }, { in: 1, out: 1 }]), false);
    assert.equal(model.isCurveChannelIdentity([{ in: 0, out: 0 }, { in: 0.5, out: 0.5 }, { in: 1, out: 1 }]), false);
    assert.deepEqual(model.DEFAULT_HUE_POINTS, Array.from({ length: 6 }, (_, i) => ({ hue: i / 6, value: 0.5 })));
    assert.equal(model.isHueChannelIdentity([{ hue: 0, value: 0.5001 }]), true);
    assert.equal(model.isHueChannelIdentity([{ hue: 0, value: 0.50011 }]), false);
    assert.equal(model.isHueChannelIdentity([{ hue: 0, value: 0 }]), false);
});

test('4 ホイールの定義・範囲と非クリップ時の方向・半径・輝度の往復', () => {
    assert.deepEqual(model.INSPECTOR_ADJUST_WHEELS.map(w => w.label), ['Lift', 'Gamma', 'Gain', 'Offset']);
    assert.deepEqual(model.INSPECTOR_ADJUST_WHEELS.map(w => model.wheelRange(w.key)), [0.25, 0.5, 0.5, 0.1]);
    for (const { key } of model.INSPECTOR_ADJUST_WHEELS) {
        const range = model.wheelRange(key);
        for (const [dx, dy] of [[0, 0], [0.3, 0.4], [-0.4, 0.2], [0.2, -0.6], [-0.3, -0.4]]) {
            const luma = range * 0.1;
            const rgb = model.wheelXyToRgb(dx, dy, range, luma);
            const d = model.rgbToWheelDisplay(...rgb, range);
            assert.ok(Math.abs((d.xPct - 50) / 42 - dx) < 1e-12);
            assert.ok(Math.abs((50 - d.yPct) / 42 - dy) < 1e-12);
            assert.ok(Math.abs(d.luma - luma) < 1e-12);
        }
        assert.ok(model.wheelXyToRgb(10, 5, range, range).every(v => v >= -range && v <= range));
    }
});
