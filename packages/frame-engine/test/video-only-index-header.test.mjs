import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as MP4BoxNamespace from '@webav/mp4box.js';
import {
  buildKeyframeIndexFromHeader,
  buildVideoSampleTable,
  childBoxes,
  videoOnlyIndexHeader,
} from '../dist/index.js';

const MP4Box = MP4BoxNamespace.default ?? MP4BoxNamespace;

// 原本の PCM は 1 サンプル = 1 音声サンプルなので、stsz は固定 sample_size + sample_count だけで
// 48 kHz なら毎秒 48000 件を宣言する。V8 は密に伸ばした Array を 2^27 要素で打ち切って
// RangeError: Invalid array length を投げる（Node 22.22 実測: length 134217728 で throw、1.1 s / 580 MB）
// ので、約 46 分の原本でこの上限に届く（不具合メモ 第19項）。ffmpeg では尺を盛るしかなく 46 分の
// fixture は作れないため、1 秒の原本を作って音声 stsz の sample_count だけを上限の 1 つ先へ書き換える
// （既存 range-source.test.mjs の forceVideoStcoToCo64 と同じ手口）。
const HAZARDOUS_PCM_SAMPLE_COUNT = 134_217_729;

function typeAt(bytes, offset) {
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

/** ftyp + moov だけを取り出す（scanMp4Header が組む索引用ヘッダーと同じ形）。 */
function headerBytes(file) {
  const parts = childBoxes(file, 0, file.byteLength)
    .filter(box => box.type === 'ftyp' || box.type === 'moov')
    .map(box => file.subarray(box.start, box.end));
  assert.equal(parts.length, 2, 'fixture must expose ftyp and moov');
  const header = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    header.set(part, offset);
    offset += part.byteLength;
  }
  return header;
}

function traks(bytes) {
  const moov = childBoxes(bytes, 0, bytes.byteLength).find(box => box.type === 'moov');
  assert.ok(moov, 'moov box is missing');
  return childBoxes(bytes, moov.dataStart, moov.end)
    .filter(box => box.type === 'trak')
    .map(trak => {
      const mdia = childBoxes(bytes, trak.dataStart, trak.end).find(box => box.type === 'mdia');
      const children = childBoxes(bytes, mdia.dataStart, mdia.end);
      const hdlr = children.find(box => box.type === 'hdlr');
      const minf = children.find(box => box.type === 'minf');
      const stbl = childBoxes(bytes, minf.dataStart, minf.end).find(box => box.type === 'stbl');
      const stsz = childBoxes(bytes, stbl.dataStart, stbl.end).find(box => box.type === 'stsz');
      return { trak, handler: typeAt(bytes, hdlr.dataStart + 8), stsz };
    });
}

/** 非映像 trak を隠さないまま MP4Box に読ませた、比較用の映像サンプル表。 */
function unhiddenVideoSamples(header) {
  return new Promise((resolve, reject) => {
    const buffer = header.slice().buffer;
    buffer.fileStart = 0;
    const file = MP4Box.createFile();
    file.onError = message => reject(new Error(String(message)));
    file.onReady = info => {
      try {
        resolve(file.getTrackSamplesInfo(info.videoTracks[0].id).map(sample => ({
          offset: sample.offset,
          size: sample.size,
          dts: sample.dts,
          cts: sample.cts,
          is_sync: sample.is_sync,
        })));
      } catch (error) {
        reject(error);
      }
    };
    file.appendBuffer(buffer);
    file.flush();
  });
}

let cachedFixture = null;

function pcmFixtureHeader(t) {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    t.skip('ffmpeg is required');
    return null;
  }
  cachedFixture ??= buildPcmFixtureHeader();
  return cachedFixture.slice();
}

function buildPcmFixtureHeader() {
  const directory = mkdtempSync(path.join(tmpdir(), 'akari-pcm-index-'));
  try {
    const file = path.join(directory, 'pcm-original.mp4');
    execFileSync('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=30:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1:sample_rate=48000',
      '-c:v', 'libx264', '-g', '15', '-pix_fmt', 'yuv420p',
      '-c:a', 'pcm_s16le',
      '-movflags', '+faststart',
      file,
    ], { stdio: 'pipe' });
    return headerBytes(new Uint8Array(readFileSync(file)));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** 音声 stsz の sample_count だけを、46 分級の原本と同じ桁へ書き換えたヘッダー。 */
function withLongPcmSampleTable(header) {
  const bytes = header.slice();
  const audio = traks(bytes).find(entry => entry.handler !== 'vide');
  assert.ok(audio?.stsz, 'fixture must carry a non-video trak with an stsz box');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint8(audio.stsz.dataStart), 0, 'stsz must use version 0');
  assert.ok(view.getUint32(audio.stsz.dataStart + 4) > 0, 'PCM stsz must declare a fixed sample_size');
  view.setUint32(audio.stsz.dataStart + 8, HAZARDOUS_PCM_SAMPLE_COUNT);
  return bytes;
}

test('a long fixed-size PCM sample table no longer breaks the video index', async t => {
  const header = pcmFixtureHeader(t);
  if (!header) return;
  const hazardous = withLongPcmSampleTable(header);

  // 元の 1 秒 fixture は素で読めるので、これを「非映像 trak を隠さない場合」の正解にする。
  const expected = await unhiddenVideoSamples(header);
  assert.ok(expected.length > 0, 'fixture must carry video samples');

  // 書き換えた fixture が本当に危険であること（= 回帰したら落ちること）を先に確かめる。
  await assert.rejects(
    unhiddenVideoSamples(hazardous),
    /Invalid array length/u,
    'the patched fixture must reproduce the stsz blow-up when non-video traks stay visible',
  );

  const table = await buildVideoSampleTable(hazardous.slice().buffer);
  assert.deepEqual(
    table.samples.map(sample => ({
      offset: sample.offset,
      size: sample.size,
      dts: sample.dts,
      cts: sample.cts,
      is_sync: sample.isSync,
    })),
    expected,
    'hiding non-video traks must not move a single video sample',
  );

  const safeTable = await buildVideoSampleTable(header.slice().buffer);
  assert.equal(table.samples.length, safeTable.samples.length);
  assert.equal(table.codec, safeTable.codec);
  assert.equal(table.fourcc, 'avc1');
  assert.equal(table.width, safeTable.width);
  assert.equal(table.height, safeTable.height);
  assert.deepEqual(table.presentationOrder, safeTable.presentationOrder);

  // range-mp4-source が索引を組む経路（キーフレーム索引側）も同じヘッダーのコピーで通ること。
  const keyframes = await buildKeyframeIndexFromHeader(videoOnlyIndexHeader(hazardous.slice().buffer));
  const safeKeyframes = await buildKeyframeIndexFromHeader(videoOnlyIndexHeader(header.slice().buffer));
  assert.ok(keyframes.keyframeTimesUs.length > 0, 'keyframe index must not come back empty');
  assert.deepEqual(keyframes.keyframeTimesUs, safeKeyframes.keyframeTimesUs);
  assert.equal(keyframes.lastFrameStartUs, safeKeyframes.lastFrameStartUs);
});

test('hiding non-video traks only relabels the trak type in a copy and leaves the caller buffer alone', async t => {
  const header = pcmFixtureHeader(t);
  if (!header) return;
  const original = header.slice();
  const hidden = new Uint8Array(videoOnlyIndexHeader(header.slice().buffer));

  assert.deepEqual(header, original, 'the caller header must not be mutated');
  assert.equal(hidden.byteLength, header.byteLength, 'byte offsets must stay where they are');

  const before = traks(header);
  assert.ok(before.some(entry => entry.handler === 'vide'), 'fixture must carry a video trak');
  assert.ok(before.some(entry => entry.handler !== 'vide'), 'fixture must carry a non-video trak');
  assert.deepEqual(traks(hidden).map(entry => entry.handler), ['vide'], 'only the video trak stays visible');

  const typeField = new Set();
  for (const entry of before) {
    if (entry.handler === 'vide') continue;
    assert.equal(typeAt(hidden, entry.trak.start + 4), 'free', 'non-video trak must be relabelled');
    for (let index = 0; index < 4; index += 1) typeField.add(entry.trak.start + 4 + index);
  }
  for (let index = 0; index < hidden.byteLength; index += 1) {
    if (typeField.has(index)) continue;
    assert.equal(hidden[index], header[index], `byte ${index} must stay where it is`);
  }

  const hiddenTop = childBoxes(hidden, 0, hidden.byteLength).find(box => box.type === 'moov');
  const kinds = childBoxes(hidden, hiddenTop.dataStart, hiddenTop.end)
    .filter(box => ['trak', 'free'].includes(box.type))
    .map(box => box.type);
  assert.deepEqual(kinds, ['trak', 'free'], 'the audio trak must read as a free box');
});

test('headers without a walkable moov come back untouched', () => {
  const noMoov = new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]).buffer;
  assert.equal(videoOnlyIndexHeader(noMoov), noMoov);
  const truncated = new Uint8Array([0, 0, 0x40, 0, 0x6d, 0x6f, 0x6f, 0x76, 1, 2]).buffer;
  assert.equal(videoOnlyIndexHeader(truncated), truncated);
});
