import assert from 'node:assert/strict';
import test from 'node:test';
import { copyNativeYuvFrame } from '../dist/decode/native-yuv.js';

for (const format of ['I420', 'NV12']) {
  test(`${format} copies an odd visible rectangle with a nonzero origin`, async () => {
    const rect = { x: 2, y: 2, width: 3, height: 3 };
    const chromaWidth = Math.ceil(rect.width / 2);
    const chromaHeight = Math.ceil(rect.height / 2);
    const planeWidths = format === 'NV12'
      ? [rect.width, chromaWidth * 2]
      : [rect.width, chromaWidth, chromaWidth];
    const planeHeights = format === 'NV12'
      ? [rect.height, chromaHeight]
      : [rect.height, chromaHeight, chromaHeight];
    const layouts = [];
    let size = 0;
    for (let index = 0; index < planeWidths.length; index += 1) {
      layouts.push({ offset: size, stride: planeWidths[index] + 1 });
      size += (planeWidths[index] + 1) * planeHeights[index];
    }
    const frame = {
      format, codedWidth: 8, codedHeight: 6, visibleRect: rect,
      allocationSize(options) {
        assert.deepEqual(options.rect, rect);
        return size;
      },
      async copyTo(destination, options) {
        assert.deepEqual(options.rect, rect);
        for (let index = 0; index < layouts.length; index += 1) {
          const { offset, stride } = layouts[index];
          for (let row = 0; row < planeHeights[index]; row += 1) {
            for (let col = 0; col < planeWidths[index]; col += 1) {
              destination[offset + row * stride + col] = 10 * (index + 1) + row * stride + col;
            }
          }
        }
        return layouts;
      },
    };
    const copied = await copyNativeYuvFrame(frame);
    assert.equal(copied.width, 3);
    assert.equal(copied.height, 3);
    assert.equal(copied.y.length, 9);
    assert.deepEqual([...copied.y], [10, 11, 12, 14, 15, 16, 18, 19, 20]);
    if (format === 'NV12') {
      assert.equal(copied.uv.length, 8);
    } else {
      assert.equal(copied.u.length, 4);
      assert.equal(copied.v.length, 4);
    }
  });
}
