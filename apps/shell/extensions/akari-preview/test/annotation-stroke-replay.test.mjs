import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { annotationStrokePrefix } = require('../lib/common/annotation-stroke-replay.js');
const { previewBootstrapScript } = require('../lib/browser/preview-script-bootstrap.js');

test('the endpoints retain the original point order and values', () => {
    const points = [[0, 0], [0.3, 0], [0.3, 0.4]];
    assert.deepEqual(annotationStrokePrefix(points, 0), [[0, 0]]);
    assert.deepEqual(annotationStrokePrefix(points, 1), points);
    assert.deepEqual(points, [[0, 0], [0.3, 0], [0.3, 0.4]]);
});

test('an uneven polyline advances by length and interpolates its tip', () => {
    const points = [[0, 0], [0.3, 0], [0.3, 0.4]];
    const halfway = annotationStrokePrefix(points, 0.5);
    assert.deepEqual(halfway.slice(0, 2), points.slice(0, 2));
    assert.ok(Math.abs(halfway[2][0] - 0.3) < 1e-12);
    assert.ok(Math.abs(halfway[2][1] - 0.05) < 1e-12);
    const traversed = 0.3 + Math.hypot(
        halfway[2][0] - points[1][0], halfway[2][1] - points[1][1]);
    assert.ok(Math.abs(traversed / 0.7 - 0.5) < 1e-12);
});

test('reversing the input reverses the replay without sorting', () => {
    const reversed = [[0.3, 0.4], [0.3, 0], [0, 0]];
    const partial = annotationStrokePrefix(reversed, 0.5);
    assert.deepEqual(partial[0], reversed[0]);
    assert.ok(Math.abs(partial[1][0] - 0.3) < 1e-12);
    assert.ok(Math.abs(partial[1][1] - 0.05) < 1e-12);
    assert.deepEqual(annotationStrokePrefix(reversed, 1), reversed);
});

test('empty, single-point, and zero-length paths remain safe', () => {
    assert.deepEqual(annotationStrokePrefix([], 0.5), []);
    assert.deepEqual(annotationStrokePrefix([[0.2, 0.7]], 0.5), [[0.2, 0.7]]);
    assert.deepEqual(annotationStrokePrefix([[0.2, 0.7], [0.2, 0.7]], 0.5),
        [[0.2, 0.7], [0.2, 0.7]]);
});

test('the webview embeds the same pure function as the tested module', () => {
    assert.ok(previewBootstrapScript().includes(
        `const annotationStrokePrefixFn = (${annotationStrokePrefix.toString()});`
    ));
});
