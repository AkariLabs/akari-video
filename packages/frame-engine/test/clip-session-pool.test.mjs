import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ClipSessionPool } from '../dist/index.js';

const sourceRoot = path.resolve(import.meta.dirname, '../src/decode');
const [clipSessionSource, poolSource] = await Promise.all([
  readFile(path.join(sourceRoot, 'clip-session.ts'), 'utf8'),
  readFile(path.join(sourceRoot, 'clip-session-pool.ts'), 'utf8'),
]);

test('ClipSessionPool keeps its base parse-only and gives every stream a releasable fork', () => {
  assert.doesNotMatch(poolSource, /baseStreamId/u);
  assert.match(poolSource, /sessionPromise = this\.ensureBase\(\)\.fork\(`\$\{this\.id\}:\$\{streamId\}`\)/u);
  const releaseSession = poolSource.slice(
    poolSource.indexOf('releaseSession(streamId'),
    poolSource.indexOf('liveStreamIds()'),
  );
  assert.match(releaseSession, /this\.sessions\.delete\(streamId\)/u);
  assert.match(releaseSession, /value => value\.destroy\(\)/u);
  assert.doesNotMatch(releaseSession, /this\.base/u);
});

test('ClipSession forks parsed media without priming the base decoder', () => {
  const ensureParsed = clipSessionSource.slice(
    clipSessionSource.indexOf('private async ensureParsed()'),
    clipSessionSource.indexOf('async decode('),
  );
  const fork = clipSessionSource.slice(
    clipSessionSource.indexOf('async fork('),
    clipSessionSource.indexOf('destroy(): void'),
  );
  assert.match(ensureParsed, /await this\.prepare\(\)/u);
  assert.match(ensureParsed, /this\.clip = this\.preparedCandidate/u);
  assert.match(ensureParsed, /this\.loadPromise = Promise\.resolve\(\)/u);
  assert.doesNotMatch(ensureParsed, /\.tick\(/u);
  assert.match(fork, /await this\.ensureParsed\(\)/u);
  assert.doesNotMatch(fork, /await this\.load\(\)/u);
  assert.match(fork, /fork\.sourceBytes = this\.sourceBytes/u);
  assert.match(fork, /fork\.ownsSourceBytes = false/u);
  const destroy = clipSessionSource.slice(
    clipSessionSource.indexOf('destroy(): void'),
    clipSessionSource.indexOf('private async guardedTick'),
  );
  assert.match(destroy, /if \(this\.ownsSourceBytes\) this\.sourceBytes\.destroy\(\)/u);
});

test('decoder acceleration degradation is learned once per pool and decoder failures get two paced retry rounds', () => {
  assert.match(clipSessionSource, /hardwareAcceleration\?: HardwarePreference/u);
  assert.match(clipSessionSource, /onDecoderDegraded\?: \(\) => void/u);
  assert.match(clipSessionSource, /this\.options\.hardwareAcceleration \?\? 'prefer-hardware'/u);
  assert.match(clipSessionSource, /for \(let round = 0; round < 3; round \+= 1\)/u);
  assert.match(clipSessionSource, /setTimeout\(resolve, round \* 150\)/u);
  assert.match(clipSessionSource, /if \(!isDecoderErrorMessage\(lastError\)\) break/u);
  assert.match(clipSessionSource, /this\.options\.onDecoderDegraded\?\.\(\)/u);
  assert.match(poolSource, /private acceleration: HardwarePreference \| undefined/u);
  assert.match(poolSource, /hardwareAcceleration: this\.acceleration/u);
  assert.match(poolSource, /onDecoderDegraded: \(\) => this\.noteDegraded\(\)/u);
  assert.match(poolSource, /this\.acceleration = 'prefer-software'/u);
  assert.match(poolSource, /this\.base\?\.destroy\(\);\s*this\.base = null/u);
});

test('HEVC support that lacks software decode denies pool degradation', () => {
  const denied = [];
  const pool = new ClipSessionPool('hevc', '/hevc.mp4', {
    codecSupport: { codec: 'hvc1.2.4.H156.B0', hw: true, sw: false, any: true },
    onSoftwareFallbackDenied: support => denied.push(support),
  });
  pool.noteDegraded();
  assert.equal(pool.acceleration, undefined);
  assert.equal(pool.codecSupport()?.sw, false);
  assert.equal(denied.length, 1);
  pool.destroy();
});

test('H.264 support that has software decode still learns pool degradation', () => {
  const pool = new ClipSessionPool('h264', '/h264.mp4', {
    codecSupport: { codec: 'avc1.640028', hw: true, sw: true, any: true },
  });
  pool.noteDegraded();
  assert.equal(pool.acceleration, 'prefer-software');
  pool.destroy();
});
