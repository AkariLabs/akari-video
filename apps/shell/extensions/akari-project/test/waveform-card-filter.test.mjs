import test from 'node:test';
import assert from 'node:assert/strict';
import { waveformCardFilter } from '../lib/common/waveform-card-filter.js';

const cases = [
    ['5 秒', 5, 1],
    ['30 秒', 30, 1],
    ['45 秒', 45, 2],
    ['3 分', 180, 4],
    ['20 分', 1200, 4],
    ['尺不明', undefined, 1]
];

for (const [label, duration, rows] of cases) {
    test(`waveformCardFilter: ${label} は ${rows} 行`, () => {
        for (const size of [640, 320]) {
            const filter = waveformCardFilter(duration, size);
            const wave = `showwavespic=s=${size}x${Math.floor(size / rows)}:colors=0d6efd:draw=full:scale=sqrt`;
            assert.equal(filter.split(wave).length - 1, rows);
            if (rows === 1) {
                assert.equal(filter, wave);
            } else {
                const audioLabels = Array.from({ length: rows }, (_, row) => `[a${row}]`);
                const videoLabels = Array.from({ length: rows }, (_, row) => `[v${row}]`);
                const parts = filter.split(';');
                assert.equal(parts.length, rows + 2);
                assert.equal(parts[0], `[0:a]asplit=${rows}${audioLabels.join('')}`);
                for (let row = 0; row < rows; row++) {
                    assert.equal(parts[row + 1],
                        `[a${row}]atrim=${duration * row / rows}:${duration * (row + 1) / rows},asetpts=PTS-STARTPTS,${wave}[v${row}]`);
                }
                assert.equal(parts.at(-1), `${videoLabels.join('')}vstack=inputs=${rows}`);
            }
        }
        assert.equal(waveformCardFilter(duration), waveformCardFilter(duration, 640));
        if (duration === undefined) {
            for (const invalidDuration of [NaN, Infinity, -Infinity, 0, -1]) {
                assert.equal(waveformCardFilter(invalidDuration), waveformCardFilter(undefined));
            }
        }
    });
}
