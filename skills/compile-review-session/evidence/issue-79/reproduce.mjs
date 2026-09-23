import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const skillRoot = fileURLToPath(new URL('../..', import.meta.url));
const repoRoot = path.resolve(skillRoot, '../..');
const realStore = path.join(repoRoot, 'packages/edit-store/lib/index.js');
const fixtureProject = path.join(skillRoot, 'dev-fixtures/fixture-project');

async function writeModule(root, version, old) {
  await fs.mkdir(path.join(root, 'packages/akari-launcher'), { recursive: true });
  await fs.writeFile(path.join(root, 'packages/akari-launcher/package.json'), JSON.stringify({ version }));
  const storeDir = path.join(root, 'packages/edit-store/lib');
  await fs.mkdir(storeDir, { recursive: true });
  const source = old
    ? `const real = require(${JSON.stringify(realStore)});
module.exports = { ...real, readInternalEdit(value) {
  const item = value?.tracks?.[0]?.items?.[2];
  if (item && Object.hasOwn(item, 'adjust')) throw new Error('edit.json v2 が不正です (edit.json.tracks[0].items[2]): 未定義キーを使用できません: adjust。案内: 旧版の語彙');
  return real.readInternalEdit(value);
} };
`
    : `module.exports = require(${JSON.stringify(realStore)});\n`;
  await fs.writeFile(path.join(storeDir, 'index.js'), source);
}

export async function runFixture({ before = false, unknown = false, badType = false } = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-79-'));
  try {
    const project = path.join(home, 'project');
    const copy = path.join(project, '.claude/skills/compile-review-session');
    await fs.cp(skillRoot, copy, { recursive: true, filter: (source) =>
      !source.includes(`${path.sep}dev-fixtures`) && !source.includes(`${path.sep}test`) && !source.includes(`${path.sep}evidence`) });
    await fs.cp(fixtureProject, project, { recursive: true });
    if (before) {
      const mapping = path.join(copy, 'bin/core/time-mapping.mjs');
      const source = await fs.readFile(mapping, 'utf8');
      await fs.writeFile(mapping, source
        .replaceAll('resolveNewestPackageFile', 'resolvePackageFile')
        .replace('const unknown = attempt < 64 ? unknownKeysFromError(error) : null;', 'const unknown = null;'));
    }
    const sessionDir = path.join(project, 'review/sessions/s-0010');
    const snapshotPath = path.join(sessionDir, 'edit.snapshot.json');
    const snapshot = JSON.parse(await fs.readFile(snapshotPath, 'utf8'));
    const item = {
      id: 'c4', at: badType ? '534' : 1500, duration: 210,
      source: { kind: 'media', src: 'main', in: 0, out: 7.0 },
      adjust: { basic: { saturation: -1 } },
    };
    if (unknown) item.zzz_unknown = true;
    snapshot.tracks[0].items.push(item);
    const snapshotBytes = Buffer.from(JSON.stringify(snapshot, null, 2));
    await fs.writeFile(snapshotPath, snapshotBytes);
    await fs.writeFile(path.join(sessionDir, 'transcript.json'), JSON.stringify({
      version: 1, backend: 'fixture',
      segments: [{ start: 2, end: 3, text: 'このカットを削除してください', words: [{ start: 2, end: 3, text: 'このカットを削除してください' }] }],
    }));

    const oldRoot = path.join(home, '.akari/app');
    const resources = path.join(home, 'Desktop/Resources');
    await writeModule(oldRoot, '0.1.40', true);
    await writeModule(resources, '0.1.79', false);
    const shimDir = path.join(home, '.akari/cli/bin');
    await fs.mkdir(shimDir, { recursive: true });
    await fs.writeFile(path.join(shimDir, 'akari'), `#!/bin/sh\nexec node "${path.join(resources, 'packages/akari-launcher/bin/akari.mjs')}" "$@"\n`);
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    delete env.AKARI_MONOREPO;
    delete env.AKARI_INSTALL_DIR;
    let stdout;
    let stderr;
    try {
      ({ stdout, stderr } = await execFileAsync(process.execPath, [
        path.join(copy, 'bin/compile-review-session.mjs'), project,
        '--session', 's-0010', '--prepare-only', '--json',
      ], { env }));
    } catch (error) {
      stdout = error.stdout;
      stderr = error.stderr;
    }
    return {
      result: JSON.parse(stdout).results[0], stderr,
      snapshotUnchanged: snapshotBytes.equals(await fs.readFile(snapshotPath)),
      report: await fs.readFile(path.join(sessionDir, 'compile-report.md'), 'utf8'),
    };
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const [name, options] of [
    ['BEFORE', { before: true }], ['AFTER', {}],
    ['UNKNOWN', { unknown: true }], ['BAD_TYPE', { badType: true }],
  ]) {
    const outcome = await runFixture(options);
    process.stdout.write(`${name}: ${JSON.stringify({ status: outcome.result.status, reason: outcome.result.reason, snapshotWarning: outcome.report.match(/edit\.snapshot\.json の未定義キーを無視しました: [^\n]+/u)?.[0] ?? null, snapshotUnchanged: outcome.snapshotUnchanged })}\n`);
  }
}
