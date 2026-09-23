import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainModule } from "../bin/is-main-module.mjs";

const skillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function runCli(cliPath, nodeOptions = []) {
  const result = spawnSync(process.execPath, [...nodeOptions, cliPath], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("transcribe-cloud.mjs runs identically through a symlink", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "analyze-footage-entrypoint-"));
  try {
    const realPath = join(skillRoot, "bin", "transcribe-cloud.mjs");
    const linkedPath = join(temporary, "transcribe-cloud.mjs");
    await symlink(realPath, linkedPath);

    for (const nodeOptions of [[], ["--preserve-symlinks"]]) {
      const expected = runCli(realPath, nodeOptions);
      assert.notEqual(expected.stdout || expected.stderr, "");
      assert.deepEqual(runCli(linkedPath, nodeOptions), expected);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("analyze-footage entrypoint detection fails open when realpath resolution fails", () => {
  assert.equal(isMainModule(import.meta.url, "/path/that/does/not/exist"), true);
});

test('配布先の cloud transcription は鍵を読む時点で creator-root を解決する', t => {
  const scratch = mkdtempSync(join(tmpdir(), 'akari-transcribe-distribution-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const source = join(skillRoot, 'bin');
  const target = join(scratch, 'bin');
  mkdirSync(target);
  for (const name of ['transcribe-cloud.mjs', 'is-main-module.mjs']) copyFileSync(join(source, name), join(target, name));
  const entry = join(target, 'transcribe-cloud.mjs');
  const project = join(scratch, 'project');
  mkdirSync(join(project, '.akari'), { recursive: true });
  writeFileSync(join(project, '.akari', 'connections.json'), JSON.stringify({ providers: [] }));
  const repo = resolve(skillRoot, '..', '..');
  const env = { ...process.env, AKARI_MONOREPO: repo, AKARI_INSTALL_DIR: join(scratch, 'missing-app'), AKARI_HOME: join(scratch, 'home') };
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[2])', join(target, 'is-main-module.mjs'), pathToFileURL(entry).href], { env, encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  const args = [entry, '--decision-card', '--project-root', project, '--duration', '10'];
  const run = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const missing = spawnSync(process.execPath, args, { env: { ...env, AKARI_MONOREPO: '' }, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /セットアップするには/);
  assert.doesNotMatch(missing.stdout, /ERR_MODULE_NOT_FOUND/);
});
