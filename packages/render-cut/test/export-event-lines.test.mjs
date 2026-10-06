import assert from 'node:assert/strict';
import test from 'node:test';
import { RefusalError, formatEngineLine, formatRefusedLine, runCli } from '../src/render-cut.mjs';

test('ENGINE 行は選択と理由を機械可読で出す', () => {
    const reasons = [{ kind: 'caption', id: 'c1', reason: 'caption-motion-glitch-unsupported' }];
    assert.equal(formatEngineLine('gpu'), 'ENGINE gpu');
    assert.equal(formatEngineLine('osr', reasons), `ENGINE osr reasons=${JSON.stringify(reasons)}`);
});

test('REFUSED 行は progress 時のみ stdout、既存 stderr と exit code は維持', async () => {
    const message = '.akari/lint.json is missing or not PASS; run edit-lint first (or use --force with explicit approval)';
    assert.equal(formatRefusedLine(new RefusalError(message)), `REFUSED code=lint-not-pass detail=${JSON.stringify({ message })}`);
    assert.equal(formatRefusedLine(new RefusalError('unavailable')), 'REFUSED code=render-refused detail={"message":"unavailable"}');
    for (const progress of [false, true]) {
        const lines = [], errors = [];
        const exit = await runCli(['project', ...(progress ? ['--progress'] : [])],
            { log: line => lines.push(line), error: line => errors.push(line) },
            { renderProject: async () => { throw new RefusalError(message); } });
        assert.equal(exit, 1);
        assert.deepEqual(lines, progress ? [formatRefusedLine(new RefusalError(message))] : []);
        assert.deepEqual(errors, [`render-cut refused: ${message}`]);
    }
    const lines = [], errors = [];
    const exit = await runCli(['project', '--engine', 'legacy', '--progress'],
        { log: line => lines.push(line), error: line => errors.push(line) });
    assert.equal(exit, 2);
    assert.match(lines[0], /^REFUSED code=render-refused detail=/u);
    assert.equal(errors.length, 2);
});
