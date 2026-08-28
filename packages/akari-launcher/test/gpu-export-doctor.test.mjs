import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDoctorReport } from '../src/doctor-command.mjs';
import { resolveGpuExportAvailability } from '../src/runtime-diagnostics.mjs';

test('GPU doctor requires macOS and a tier 1/2 Electron launcher', async () => {
  assert.deepEqual(await resolveGpuExportAvailability({ platform: 'linux' }), {
    available: false,
    reason: 'GPU hardware export v0 is available on macOS only',
    launcher_tier: null,
  });
  assert.deepEqual(await resolveGpuExportAvailability({
    platform: 'darwin',
    resolveGpuLauncher: async () => ({ tier: 2, kind: 'npm-electron' }),
  }), {
    available: true,
    reason: 'npm-electron launcher tier 2',
    launcher_tier: 2,
  });
});

test('doctor text includes the GPU export row without changing verdict', () => {
  const output = formatDoctorReport({
    cli: { version: '1', entry_path: 'akari' },
    app_managed: { status: 'valid', path: '/app', version: '1' },
    app_bundle: { found: true, path: '/bundle', version: '1' },
    render_cut: { origin: 'monorepo', path: '/render-cut' },
    edit_lint: { origin: 'monorepo', path: '/edit-lint' },
    ffmpeg: { origin: 'path', path: '/ffmpeg' },
    ffprobe: { origin: 'path', path: '/ffprobe' },
    chrome: { found: true, path: '/chrome' },
    gpu_export: { available: true, reason: 'tier 2', launcher_tier: 2 },
    path: { on_path: true, cli_shim_dir: '/bin' },
    verdict: 'ok',
    next_steps: [],
  });
  assert.match(output, /gpu_export\s+ok\s+tier 2/u);
  assert.match(output, /判定: ok/u);
});
