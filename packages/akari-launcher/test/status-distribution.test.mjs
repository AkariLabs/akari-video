import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createIntegrityFixture } from "./helpers/integrity-fixture.mjs";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const PACKAGE_ROOT = join(REPO_ROOT, "packages", "akari-launcher");

test("generated plugin mirror has byte-identical file-list and SHA parity", () => {
  const checked = command(process.execPath, ["scripts/gen-status-core-mirror.mjs", "--check"], REPO_ROOT);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /byte-identical/u);
});

test("checkout, npm tarball, and copied plugin emit byte-identical canonical fast status", async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), "akari-status-distribution-"));
  try {
    const project = join(temporary, "fixture-project");
    await mkdir(join(project, ".akari"), { recursive: true });
    await writeFile(join(project, ".akari", "connections.json"), '{"version":1}\n', "utf8");
    await writeFile(join(project, ".akari", "intake.json"), '{"version":1,"status":"draft"}\n', "utf8");

    const checkout = command(process.execPath, [
      join(PACKAGE_ROOT, "bin", "akari.mjs"),
      "status",
      project,
      "--json",
    ], REPO_ROOT);
    assert.equal(checkout.status, 0, checkout.stderr);

    const pack = command("npm", ["pack", "--json", "--pack-destination", temporary], PACKAGE_ROOT);
    assert.equal(pack.status, 0, pack.stderr || pack.stdout);
    const packed = JSON.parse(pack.stdout);
    const archive = join(temporary, packed[0].filename);
    const unpacked = join(temporary, "unpacked");
    await mkdir(unpacked);
    const extracted = command("tar", ["-xzf", archive, "-C", unpacked], REPO_ROOT);
    assert.equal(extracted.status, 0, extracted.stderr);
    const packageDirectory = join(unpacked, "package");
    const tarball = command(process.execPath, [
      join(packageDirectory, "bin", "akari.mjs"),
      "status",
      project,
      "--json",
    ], temporary);
    assert.equal(tarball.status, 0, tarball.stderr);

    const copiedPlugin = join(temporary, "copied-plugin");
    await cp(join(REPO_ROOT, "plugin"), copiedPlugin, { recursive: true });
    const plugin = command(process.execPath, [
      join(copiedPlugin, "hooks", "scripts", "session-start.mjs"),
      "--status-json",
      project,
    ], temporary);
    assert.equal(plugin.status, 0, plugin.stderr);
    assert.equal(tarball.stdout, checkout.stdout);
    assert.equal(plugin.stdout, checkout.stdout);
    const checkoutFull = command(process.execPath, [
      join(PACKAGE_ROOT, "bin", "akari.mjs"), "status", project, "--full", "--json",
    ], REPO_ROOT);
    const tarballFull = command(process.execPath, [
      join(packageDirectory, "bin", "akari.mjs"), "status", project, "--full", "--json",
    ], temporary);
    const pluginFull = command(process.execPath, [
      join(copiedPlugin, "hooks", "scripts", "session-start.mjs"), "--status-json", project, "--full",
    ], temporary);
    assert.equal(checkoutFull.status, 0, checkoutFull.stderr);
    assert.equal(tarballFull.status, 0, tarballFull.stderr);
    assert.equal(pluginFull.status, 0, pluginFull.stderr);
    assert.equal(tarballFull.stdout, checkoutFull.stdout);
    assert.equal(pluginFull.stdout, checkoutFull.stdout);
    assert.ok(await readFile(join(packageDirectory, "src", "status-core", "status.mjs"), "utf8"));

    const lutProject = join(temporary, "lut-project");
    await mkdir(lutProject);
    await createIntegrityFixture(lutProject, { usePresetLut: true });
    const checkoutLutFull = command(process.execPath, [
      join(PACKAGE_ROOT, "bin", "akari.mjs"), "status", lutProject, "--full", "--json",
    ], REPO_ROOT);
    const pluginLutFull = command(process.execPath, [
      join(copiedPlugin, "hooks", "scripts", "session-start.mjs"), "--status-json", lutProject, "--full",
    ], temporary);
    assert.equal(checkoutLutFull.status, 0, checkoutLutFull.stderr);
    assert.equal(pluginLutFull.status, 0, pluginLutFull.stderr);
    assert.equal(pluginLutFull.stdout, checkoutLutFull.stdout);
    assert.equal(JSON.parse(pluginLutFull.stdout).release.state, "ready_for_acceptance");

    const fontProject = join(temporary, "caption-font-project");
    await mkdir(fontProject);
    await createIntegrityFixture(fontProject, { fullRoleInputs: true });
    const checkoutFontFull = command(process.execPath, [
      join(PACKAGE_ROOT, "bin", "akari.mjs"), "status", fontProject, "--full", "--json",
    ], REPO_ROOT);
    const tarballFontFull = command(process.execPath, [
      join(packageDirectory, "bin", "akari.mjs"), "status", fontProject, "--full", "--json",
    ], temporary);
    const pluginFontFull = command(process.execPath, [
      join(copiedPlugin, "hooks", "scripts", "session-start.mjs"), "--status-json", fontProject, "--full",
    ], temporary);
    assert.equal(checkoutFontFull.status, 0, checkoutFontFull.stderr);
    assert.equal(tarballFontFull.status, 0, tarballFontFull.stderr);
    assert.equal(pluginFontFull.status, 0, pluginFontFull.stderr);
    assert.equal(tarballFontFull.stdout, checkoutFontFull.stdout);
    assert.equal(pluginFontFull.stdout, checkoutFontFull.stdout);
    assert.equal(JSON.parse(pluginFontFull.stdout).release.state, "ready_for_acceptance");
    const canonicalFont = await readFile(join(REPO_ROOT, "assets", "font", "noto-sans-jp", "NotoSansJP-Variable.ttf"));
    assert.deepEqual(await readFile(join(
      packageDirectory, "vendor", "assets", "font", "noto-sans-jp", "NotoSansJP-Variable.ttf",
    )), canonicalFont);
    const copiedPluginFont = join(
      copiedPlugin, "runtime", "assets", "font", "noto-sans-jp", "NotoSansJP-Variable.ttf",
    );
    assert.deepEqual(await readFile(copiedPluginFont), canonicalFont);
    await writeFile(copiedPluginFont, "mutated copied plugin font\n", "utf8");
    const tamperedPluginFont = command(process.execPath, [
      join(copiedPlugin, "hooks", "scripts", "session-start.mjs"), "--status-json", fontProject, "--full",
    ], temporary);
    assert.equal(tamperedPluginFont.status, 0, tamperedPluginFont.stderr);
    const tamperedStatus = JSON.parse(tamperedPluginFont.stdout);
    assert.equal(tamperedStatus.release.accepted, false);
    assert.notEqual(tamperedStatus.release.state, "ready_for_acceptance");
    assert.equal(tamperedStatus.state_health, "inconclusive");

    const samples = [];
    const baseline = [];
    const overhead = [];
    for (let index = 0; index < 10; index += 1) {
      const beforeStarted = performance.now();
      const before = command(process.execPath, ["-e", ""], temporary);
      const beforeElapsed = performance.now() - beforeStarted;
      assert.equal(before.status, 0, before.stderr);

      const hookStarted = performance.now();
      const hook = command(process.execPath, [join(copiedPlugin, "hooks", "scripts", "session-start.mjs")], temporary, {
        input: JSON.stringify({ cwd: project }),
      });
      const hookElapsed = performance.now() - hookStarted;
      samples.push(hookElapsed);
      assert.equal(hook.status, 0, hook.stderr);
      const output = JSON.parse(hook.stdout);
      assert.match(output.hookSpecificOutput.additionalContext, /Canonical status JSON/u);

      const afterStarted = performance.now();
      const after = command(process.execPath, ["-e", ""], temporary);
      const afterElapsed = performance.now() - afterStarted;
      assert.equal(after.status, 0, after.stderr);
      baseline.push((beforeElapsed + afterElapsed) / 2);
      overhead.push(hookElapsed - (beforeElapsed + afterElapsed) / 2);
    }
    // 絶対時間の閾値は「機械の node spawn 速度」を測ってしまう（初回スキャン・セキュリティ
    // スキャン等で素の `node -e ""` が 350ms を超える環境がある）。hook 固有のコストだけを
    // 判定するため、同条件で測った素の node spawn との中央値差分で SLO を課す。
    // hook 群と baseline 群を別バッチにすると、高負荷時の時間ドリフトを hook 固有コストへ
    // 誤算入する。各 hook を直前・直後の bare node で挟み、その局所 baseline との差を測る。
    samples.sort((left, right) => left - right);
    baseline.sort((left, right) => left - right);
    overhead.sort((left, right) => left - right);
    const median = (list) => list[Math.floor(list.length / 2)];
    if (median(baseline) >= 500) {
      t.diagnostic(
        `SessionStart SLO measurement omitted because bare-node median is overloaded: ${median(baseline)}ms`,
      );
    } else {
      assert.ok(
        median(overhead) < 350,
        `SessionStart median overhead exceeded 350ms: overhead=${overhead.join(", ")} / hook=${samples.join(", ")} / local bare-node=${baseline.join(", ")}`,
      );
    }

    await rm(join(copiedPlugin, "runtime", "status-core"), { recursive: true, force: true });
    const unsupported = command(process.execPath, [
      join(copiedPlugin, "hooks", "scripts", "session-start.mjs"),
      "--status-json",
      project,
    ], temporary);
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /unsupported: canonical plugin status-core is unavailable/u);
    const safeHook = command(process.execPath, [join(copiedPlugin, "hooks", "scripts", "session-start.mjs")], temporary, {
      input: JSON.stringify({ cwd: project }),
    });
    assert.equal(safeHook.status, 0);
    assert.match(JSON.parse(safeHook.stdout).hookSpecificOutput.additionalContext, /状態取得不能/u);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

function command(executable, argumentsList, cwd, options = {}) {
  return spawnSync(executable, argumentsList, {
    cwd,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, NO_COLOR: "1", npm_config_cache: join(tmpdir(), "akari-launcher-npm-cache") },
  });
}
