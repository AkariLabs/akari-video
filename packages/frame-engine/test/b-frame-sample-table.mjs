import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as MP4BoxNamespace from '@webav/mp4box.js';
import {
  buildKeyframeIndexFromHeader,
  calculateDecoderTimestampOffsetUs,
} from '../dist/index.js';

const MP4Box = MP4BoxNamespace.default ?? MP4BoxNamespace;
const generated = resolve(dirname(fileURLToPath(import.meta.url)), 'golden/.generated');
const variants = [
  { id: 'bf0-30', fps: 30, reorderFrames: 0 },
  { id: 'bf1-30', fps: 30, reorderFrames: 1 },
  { id: 'bf2-30', fps: 30, reorderFrames: 2 },
  { id: 'bf3-30', fps: 30, reorderFrames: 2 },
  { id: 'bf2-60', fps: 60, reorderFrames: 2 },
];

function tool(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  if (existsSync(homebrew)) return homebrew;
  return execFileSync('/usr/bin/env', ['which', name], { encoding: 'utf8' }).trim();
}

function parse(file) {
  return new Promise((resolveParse, rejectParse) => {
    const bytes = readFileSync(file);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    buffer.fileStart = 0;
    const mp4 = MP4Box.createFile();
    mp4.onError = message => rejectParse(new Error(`mp4box parse error: ${message}`));
    mp4.onReady = info => {
      const track = info.videoTracks[0];
      if (!track) return rejectParse(new Error(`${file} has no video track`));
      resolveParse({ info, track, samples: mp4.getTrackSamplesInfo(track.id) });
    };
    mp4.appendBuffer(buffer);
    mp4.flush();
  });
}

const ffprobe = tool('ffprobe');
const rows = [];
for (const variant of variants) {
  const file = resolve(generated, `bframe-${variant.id}.mp4`);
  const { track, samples } = await parse(file);
  const headerBytes = readFileSync(file);
  const header = headerBytes.buffer.slice(
    headerBytes.byteOffset,
    headerBytes.byteOffset + headerBytes.byteLength,
  );
  const index = await buildKeyframeIndexFromHeader(header);
  const first = samples[0];
  const mediaTime = track.edits?.find(edit => edit.media_time >= 0)?.media_time ?? 0;
  const firstPacketDtsUs = Math.round(Number(JSON.parse(execFileSync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1',
    '-show_entries', 'packet=dts_time', '-of', 'json', file,
  ], { encoding: 'utf8' })).packets?.[0]?.dts_time) * 1e6);
  const decoderTimestampOffsetUs = calculateDecoderTimestampOffsetUs(
    first.dts,
    track.timescale,
    track.edits,
  );
  const expectedOffsetUs = Math.round((variant.reorderFrames / variant.fps) * 1e6);
  const presentationStartsUs = [...new Set(samples.map(sample => Math.round(
    ((sample.cts - mediaTime) / sample.timescale) * 1e6,
  )))].sort((left, right) => left - right);
  const penultimateStartUs = presentationStartsUs.at(-2);
  const finalStartUs = presentationStartsUs.at(-1);
  rows.push({
    variant: variant.id,
    firstPacketDtsUs,
    sampleFirstDts: first.dts,
    sampleFirstCts: first.cts,
    editMediaTime: mediaTime,
    decoderTimestampOffsetUs,
    expectedOffsetUs,
    presentationDurationUs: index.presentationDurationUs,
    penultimateStartUs,
    finalStartUs,
    indexedNextStartUs: index.nextFrameStartUs(penultimateStartUs),
  });
  assert.equal(decoderTimestampOffsetUs, expectedOffsetUs);
  assert.equal(first.cts - mediaTime, 0);
  assert.equal(index.presentationDurationUs, 2_000_000);
  assert.equal(index.nextFrameStartUs(penultimateStartUs), finalStartUs);
  assert.equal(variant.reorderFrames === 0 ? firstPacketDtsUs === 0 : firstPacketDtsUs < 0, true);
}

process.stdout.write(`B-frame sample tables: ${JSON.stringify(rows)}\n`);
