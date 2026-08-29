import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { projectSpeechDeclarations } from '../../edit-store/lib/index.js';
import {
  ensurePreviewAudioSidecar,
  probePreviewAudioSource,
  sweepPreviewAudioSidecars,
} from '../../media-bin/src/preview-audio-sidecar.mjs';
import { projectPreviewEdit } from '../src/preview-edit.mjs';

const PROJECT = '/Users/ryoma/Akari/channels/my-channel/videos/2026-08-07-akari-reel';

test('akari-reel は ready 後に全 speech を先読みし、再生開始を 300ms 以内に予定する', {
  timeout: 4 * 60_000,
}, async t => {
  if (!fs.existsSync(path.join(PROJECT, 'edit.json'))) return t.skip('owner fixture unavailable');
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return t.skip('playwright unavailable'); }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-reel-prefetch-'));
  const cacheDir = process.env.AKARI_REEL_CACHE_DIR || path.join(PROJECT, '.akari', 'cache');
  let browser;
  try {
    const projectedEdit = projectPreviewEdit(
      fs.readFileSync(path.join(PROJECT, 'edit.json'), 'utf8'), scratch, PROJECT,
    );
    const fps = Number(projectedEdit.output?.fps) || 30;
    const declarations = projectSpeechDeclarations(projectedEdit.cuts ?? [], { fps });
    assert.ok(declarations.length > 0);
    const sources = new Map((projectedEdit.sources ?? []).map(source => [String(source.id), source]));

    // The schedule is authoritative, so a cold run starts by removing previous orphan/cache entries.
    sweepPreviewAudioSidecars({ cacheDir, keepKeys: [] });
    const generatePass = async () => {
      const startedAt = performance.now();
      const results = [];
      for (const declaration of declarations) {
        const source = sources.get(declaration.src);
        assert.ok(source?.path, `source ${declaration.src} is missing`);
        const sourcePath = path.resolve(PROJECT, source.path);
        const result = await ensurePreviewAudioSidecar({
          sourcePath,
          inSec: declaration.inSec,
          outSec: declaration.outSec,
          speed: declaration.speed,
          padBeforeSec: declaration.padBeforeSec ?? 0,
          padAfterSec: declaration.padAfterSec ?? 0,
          ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg',
          cacheDir,
        });
        assert.equal(result.ok, true, result.reason);
        results.push({ declaration, result });
      }
      return { results, elapsedMs: performance.now() - startedAt };
    };
    const cold = await generatePass();
    const warm = await generatePass();
    assert.ok(cold.results.every(item => item.result.skipped === false), 'cold pass must generate every sidecar');
    assert.ok(warm.results.every(item => item.result.skipped === true), 'warm pass must skip every sidecar');
    const regularItems = [
      ...(projectedEdit.audio?.bgm ? [{ kind: 'bgm', raw: projectedEdit.audio.bgm, id: 'bgm' }] : []),
      ...(projectedEdit.audio?.sfx ?? []).map((raw, index) => ({ kind: 'sfx', raw, id: raw.id ?? `sfx-${index + 1}` })),
      ...(projectedEdit.audio?.narration ?? []).map((raw, index) => ({
        kind: 'narration', raw, id: raw.id ?? `narration-${index + 1}`,
      })),
    ];
    const regularSidecars = new Map();
    for (const item of regularItems) {
      const sourcePath = path.resolve(PROJECT, item.raw.path);
      const stat = fs.statSync(sourcePath);
      if (path.extname(sourcePath).toLowerCase() !== '.wav' || stat.size <= 8 * 1024 * 1024) continue;
      const probe = probePreviewAudioSource(sourcePath);
      assert.equal(probe.ok, true, probe.reason);
      const inSec = Number.isFinite(item.raw.in) && item.raw.in >= 0 ? item.raw.in : 0;
      const outSec = Number.isFinite(item.raw.out) && item.raw.out > inSec
        ? Math.min(item.raw.out, probe.durationSec) : probe.durationSec;
      const first = await ensurePreviewAudioSidecar({
        sourcePath, inSec, outSec, speed: 1, padBeforeSec: 0, padAfterSec: 0,
        ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', cacheDir,
      });
      const second = await ensurePreviewAudioSidecar({
        sourcePath, inSec, outSec, speed: 1, padBeforeSec: 0, padAfterSec: 0,
        ffmpeg: process.env.FFMPEG_PATH || 'ffmpeg', cacheDir,
      });
      assert.equal(first.ok, true, first.reason);
      assert.equal(second.skipped, true);
      regularSidecars.set(item.id, second);
    }
    const keepKeys = [
      ...warm.results.map(item => item.result.key),
      ...[...regularSidecars.values()].map(item => item.key),
    ];
    sweepPreviewAudioSidecars({ cacheDir, keepKeys });
    const sidecarBytes = [
      ...warm.results.map(item => item.result.path),
      ...[...regularSidecars.values()].map(item => item.path),
    ].reduce((sum, filePath) => sum + fs.statSync(filePath).size, 0);

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const byUrl = new Map(warm.results.map((item, index) => [
      `http://127.0.0.1/sidecar-${index}`, item.result.path,
    ]));
    const regularDeclarations = regularItems.map((item, index) => {
      const sourcePath = path.resolve(PROJECT, item.raw.path);
      const sourceUrl = `http://127.0.0.1/audio-source-${index}`;
      byUrl.set(sourceUrl, sourcePath);
      const sidecar = regularSidecars.get(item.id);
      const sidecarUrl = `http://127.0.0.1/audio-sidecar-${index}`;
      if (sidecar) byUrl.set(sidecarUrl, sidecar.path);
      return {
        kind: item.kind,
        id: item.id,
        url: sidecar ? sidecarUrl : sourceUrl,
        ...(sidecar ? { sourceUrl } : {}),
        spec: {
          ...item.raw,
          id: item.id,
          durationSec: 0,
          ...(sidecar ? { sidecar: {
            path: sidecarUrl, durationSec: sidecar.durationSec,
            padBeforeSec: 0, padAfterSec: 0, skipped: true,
            bytes: fs.statSync(sidecar.path).size,
          } } : {}),
        },
      };
    });
    await page.route('http://127.0.0.1/**', route => {
      const filePath = byUrl.get(route.request().url());
      if (!filePath) return route.fulfill({ status: 404, body: 'source fallback must not be fetched' });
      const body = fs.readFileSync(filePath);
      return route.fulfill({
        status: 200, contentType: 'audio/flac',
        headers: { 'content-length': String(body.length), 'access-control-allow-origin': '*' }, body,
      });
    });
    await page.goto('http://127.0.0.1/reel?frameEngineMetrics=1', { waitUntil: 'domcontentloaded' });
    await page.setContent('<button id="play">play</button>');
    await page.addScriptTag({
      path: path.resolve(import.meta.dirname,
        '../../../apps/shell/extensions/akari-preview/generated/frame-engine.js'),
    });
    const speech = warm.results.map(({ declaration, result }, index) => ({
      ...declaration,
      url: `http://127.0.0.1/source-${declaration.src}`,
      sidecar: {
        path: `http://127.0.0.1/sidecar-${index}`,
        durationSec: result.durationSec,
        padBeforeSec: declaration.padBeforeSec ?? 0,
        padAfterSec: declaration.padAfterSec ?? 0,
        skipped: true,
        bytes: fs.statSync(result.path).size,
      },
      materialDurationSec: result.durationSec,
    }));
    await page.evaluate(({ speech, declarations, duration }) => {
      document.querySelector('#play').addEventListener('click', async () => {
        let context;
        const starts = [];
        const supply = window.AkariFrameEngine.createPreviewAudioSupply({
          timelineDurationSec: duration,
          contextFactory: () => {
            context = new AudioContext({ sampleRate: 48_000 });
            const create = context.createBufferSource.bind(context);
            context.createBufferSource = () => {
              const source = create();
              const start = source.start.bind(source);
              source.start = (...args) => { starts.push(args[0]); return start(...args); };
              return source;
            };
            return context;
          },
          declarations,
          speech,
        });
        await context?.resume();
        const readyAt = performance.now();
        supply.prime();
        while (supply.debug().prefetch.pending > 0) await new Promise(resolve => setTimeout(resolve, 10));
        const prefetch = supply.debug().prefetch;
        const clickAt = context.currentTime;
        supply.playFrom(0);
        const deadline = performance.now() + 10_000;
        while (performance.now() < deadline && !supply.debug().playing) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        window.result = {
          debug: supply.debug(),
          readyToPrefetchMs: performance.now() - readyAt,
          firstSampleDelayMs: (Math.min(...starts.slice(-speech.length)) - clickAt) * 1000,
          prefetch,
        };
        supply.dispose();
      }, { once: true });
    }, {
      speech,
      declarations: regularDeclarations,
      duration: Math.max(...speech.map(item => item.atSec + item.durationSec)),
    });
    await page.click('#play');
    await page.waitForFunction(() => window.result, null, { timeout: 30_000 });
    const observed = await page.evaluate(() => window.result);
    assert.equal(observed.debug.speechDecode.okSources, observed.debug.speechDecode.sources);
    assert.equal(observed.prefetch.pending, 0);
    assert.equal(observed.prefetch.items, speech.length + regularDeclarations.length);
    assert.ok(observed.firstSampleDelayMs <= 300, `${observed.firstSampleDelayMs} ms > 300 ms`);
    process.stdout.write([
      '| metric | before | after |',
      '|---|---:|---:|',
      `| ready → all audio prefetched | 8400 ms | ${observed.prefetch.elapsedMs.toFixed(1)} ms |`,
      `| play → first speech sample | 8400 ms | ${observed.firstSampleDelayMs.toFixed(1)} ms |`,
      `| sidecars | source-wide | ${sidecarBytes} bytes |`,
      `| cold generation | — | ${cold.elapsedMs.toFixed(1)} ms |`,
      `| warm skips | — | ${warm.results.filter(item => item.result.skipped).length}/${warm.results.length} |`,
      `| load average (reference) | — | ${os.loadavg()[0].toFixed(2)} |`,
      '',
    ].join('\n'));
  } finally {
    await browser?.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
