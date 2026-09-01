import assert from 'node:assert/strict';
import test from 'node:test';

import { formatDoctorReport } from '../src/doctor-command.mjs';
import { resolveGpuExportAvailability } from '../src/runtime-diagnostics.mjs';

test('GPU doctor reports the resolved tier on every platform', async () => {
  assert.deepEqual(await resolveGpuExportAvailability({
    platform: 'darwin',
    resolveGpuLauncher: async () => ({ tier: 2, kind: 'npm-electron' }),
  }), {
    available: true,
    reason: 'npm-electron launcher tier 2',
    launcher_tier: 2,
  });
  assert.deepEqual(await resolveGpuExportAvailability({
    platform: 'win32',
    gpuLauncher: { tier: 2, kind: 'npm-electron' },
  }), {
    available: true,
    reason: 'npm-electron launcher tier 2',
    launcher_tier: 2,
  });
  assert.deepEqual(await resolveGpuExportAvailability({
    platform: 'linux',
    gpuLauncher: { tier: 3, reason: 'Electron launcher unavailable' },
  }), {
    available: false,
    reason: 'Electron launcher unavailable',
    launcher_tier: 3,
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
    gpu_export: { available: true, reason: 'tier 2', launcher_tier: 2 },
    path: { on_path: true, cli_shim_dir: '/bin' },
    verdict: 'ok',
    next_steps: [],
  });
  assert.match(output, /gpu_export\s+ok\s+tier 2/u);
  assert.match(output, /判定: ok/u);
});
