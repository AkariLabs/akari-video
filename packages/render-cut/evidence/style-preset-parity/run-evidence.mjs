import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const evidenceRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(evidenceRoot, '../../../..');
const fixtureRoot = join(evidenceRoot, 'fixture');
const resultsPath = join(evidenceRoot, 'results.json');
const scratchRoot = await mkdtemp(join(tmpdir(), 'akari-style-preset-parity-'));
const renderCli = join(repositoryRoot, 'packages/render-cut/bin/render-cut.mjs');
const lintCli = join(repositoryRoot, 'packages/edit-lint/bin/edit-lint.mjs');
const require = createRequire(join(repositoryRoot, 'package.json'));
const electronExecutable = require('electron');
const osrElectronMain = join(repositoryRoot, 'packages/osr-export/src/electron-main.mjs');
const electronAdapter = join(scratchRoot, 'electron-tier2-adapter.mjs');
await writeFile(electronAdapter, [
  '#!/usr/bin/env node',
  "import { spawnSync } from 'node:child_process';",
  `const result = spawnSync(${JSON.stringify(electronExecutable)}, [${JSON.stringify(osrElectronMain)}, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });`,
  'if (result.error) throw result.error;',
  'process.exit(result.status ?? 1);',
  '',
].join('\n'));
await chmod(electronAdapter, 0o755);

// OSR の offscreen paint は同居プロセスが多いマシンで散発的に空 bitmap を返す
// （`frame 0: offscreen paint returned an empty bitmap`）。書き出し内容とは無関係な
// 環境要因なので、同じ入力で数回まで焼き直す。framemd5 は決定的なので再試行しても
// 一致判定は緩まない。
const RENDER_ATTEMPTS = 5;

const results = {
  version: 1,
  fixture: {
    duration_seconds: 3,
    dimensions: { width: 640, height: 360 },
    fps: 30,
    presets: ['subtitle-standard', 'subtitle-variety', 'subtitle-news'],
    record_override: { id: 'c-0002', field: 'text_style.color', value: '#00ffff' },
  },
  commands: {
    render: 'node packages/render-cut/bin/render-cut.mjs <project> --out exports/render.mp4 --engine osr',
    render_environment: 'AKARI_OSR_ELECTRON=<temporary-tier2-adapter>',
    lint: 'node packages/edit-lint/bin/edit-lint.mjs <project> --json',
    framemd5: 'ffmpeg -v error -i <render.mp4> -f framemd5 -',
  },
  checks: {},
  verdict: 'fail',
};

try {
  const sourcePath = join(scratchRoot, 'source.mp4');
  const source = run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=#203040:s=640x360:r=30:d=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath,
  ]);
  if (source.status !== 0) throw new Error('fixture source generation failed');

  const projects = {};
  for (const [name, captionsFile] of [
    ['reference', 'captions-reference.json'],
    ['burned', 'captions-burned.json'],
    ['unknown', 'captions-unknown.json'],
  ]) {
    const project = join(scratchRoot, name);
    projects[name] = project;
    await mkdir(join(project, 'assets'), { recursive: true });
    await mkdir(join(project, '.akari'), { recursive: true });
    await mkdir(join(project, 'exports'), { recursive: true });
    await copyFile(join(fixtureRoot, 'edit.json'), join(project, 'edit.json'));
    await copyFile(join(fixtureRoot, captionsFile), join(project, 'captions.json'));
    await copyFile(sourcePath, join(project, 'assets/source.mp4'));
    await writeFile(join(project, '.akari/lint.json'), '{"version":1,"verdict":"pass"}\n');
  }

  const referenceRender = render(projects.reference);
  const burnedRender = render(projects.burned);
  const referencePath = join(projects.reference, 'exports/render.mp4');
  const burnedPath = join(projects.burned, 'exports/render.mp4');
  const referenceMd5 = frameMd5(referencePath);
  const burnedMd5 = frameMd5(burnedPath);
  results.checks.render_reference = renderResult(referenceRender, referencePath);
  results.checks.render_burned = renderResult(burnedRender, burnedPath);
  results.checks.framemd5 = {
    pass: referenceMd5.status === 0 && burnedMd5.status === 0 && referenceMd5.stdout === burnedMd5.stdout,
    reference_sha256: sha256(referenceMd5.stdout),
    burned_sha256: sha256(burnedMd5.stdout),
  };

  const lint = run(process.execPath, [lintCli, projects.unknown, '--json']);
  const lintResult = lint.status === 0 ? JSON.parse(lint.stdout) : null;
  const warnings = lintResult?.findings?.filter(item => item.severity === 'warning') ?? [];
  const errors = lintResult?.findings?.filter(item => item.severity === 'error') ?? [];
  results.checks.unknown_lint = {
    pass: lint.status === 0
      && warnings.length === 1
      && warnings[0]?.check === 'captions.style-preset-unknown'
      && errors.length === 0,
    warning_count: warnings.length,
    error_count: errors.length,
    checks: warnings.map(item => item.check),
  };
  const unknownRender = render(projects.unknown);
  results.checks.unknown_render = renderResult(
    unknownRender,
    join(projects.unknown, 'exports/render.mp4'),
  );
  results.verdict = Object.values(results.checks).every(check => check.pass) ? 'pass' : 'fail';
} catch (error) {
  results.error = error instanceof Error ? error.message : String(error);
} finally {
  await writeFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`, 'utf8');
  await rm(scratchRoot, { recursive: true, force: true });
}

if (results.verdict !== 'pass') process.exitCode = 1;

function render(project) {
  let execution = null;
  for (let attempt = 1; attempt <= RENDER_ATTEMPTS; attempt += 1) {
    execution = run(process.execPath, [
      renderCli,
      project,
      '--out', 'exports/render.mp4',
      '--engine', 'osr',
    ], {
      ...process.env,
      AKARI_OSR_ELECTRON: electronAdapter,
    });
    if (execution.status === 0) return execution;
    if (attempt < RENDER_ATTEMPTS) spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 15000)']);
  }
  return execution;
}

function frameMd5(path) {
  return run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', path, '-f', 'framemd5', '-']);
}

function run(command, args, env = process.env) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 300_000,
  });
}

function sha256(value) {
  return createHash('sha256').update(value ?? '').digest('hex');
}

function renderResult(execution, outputPath) {
  return {
    pass: execution.status === 0 && fileSize(outputPath) > 0,
    exit_code: execution.status,
    output_bytes: fileSize(outputPath),
    diagnostic: diagnostic(execution),
  };
}

function diagnostic(execution) {
  const raw = `${execution.stderr ?? ''}\n${execution.stdout ?? ''}`
    .replaceAll(repositoryRoot, '<repo>')
    .replaceAll(scratchRoot, '<temp>')
    .replaceAll(tmpdir(), '<tmp>');
  return raw.trim().split(/\r?\n/u).slice(-20).join(' / ');
}

function fileSize(path) {
  try {
    return Number(statSync(path).size);
  } catch {
    return 0;
  }
}
