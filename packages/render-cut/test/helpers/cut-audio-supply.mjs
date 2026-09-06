import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlan } from '../../src/plan.mjs';
import { readRenderEdit } from '../../src/internal-render.mjs';

// Only the media probe is mocked. Projection, cut_audio, audio_mix and envelope generation run unchanged.
export function renderFixture(doc, engine = 'osr', inspect = value => value) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'cut-audio-supply-'));
  const originalProbe = childProcess.spawnSync;
  childProcess.spawnSync = () => ({ status: 0, stdout: JSON.stringify({
    streams: [{ codec_type: 'audio' }], format: { duration: '12' },
  }) });
  syncBuiltinESMExports();
  try {
    mkdirSync(join(projectRoot, 'assets'));
    writeFileSync(join(projectRoot, 'assets/main.mp4'), 'probe fixture');
    writeFileSync(join(projectRoot, 'analysis.json'), JSON.stringify({ source: 'assets/main.mp4',
      transcript: [{ start: 0, end: 3, text: 'fixture' }] }));
    const temporaryDirectory = join(projectRoot, '.akari', 'render-tmp');
    const { edit, internal } = readRenderEdit(doc, temporaryDirectory, { projectRoot });
    const plan = buildPlan({ edit, internalEdit: internal, projectRoot,
      outputPath: join(projectRoot, 'out.mp4'), temporaryDirectory, resolvedEngine: engine,
      capabilities: { sourceInputs: [{ id: 'main', path: join(projectRoot, 'assets/main.mp4'),
        hasAudio: true, duration: 12 }], ffmpegCommand: 'ffmpeg', ffprobeCommand: 'ffprobe' },
    });
    const portable = value => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'string'
      ? item.replaceAll(projectRoot, '<project>').replaceAll('\\', '/') : item));
    return inspect({ edit, internal, plan, projectRoot, portable });
  } finally {
    childProcess.spawnSync = originalProbe;
    syncBuiltinESMExports();
    rmSync(projectRoot, { recursive: true, force: true });
  }
}
