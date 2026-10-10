import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("helper without a locale keeps ja-JP, and wrapper forwards an optional locale", async () => {
  const swift = await readFile(path.join(directory, "speechanalyzer-helper.swift"), "utf8");
  const wrapper = await readFile(path.join(directory, "transcribe-sa.mjs"), "utf8");
  assert.match(swift, /CommandLine\.arguments\.count == 3 \? CommandLine\.arguments\[2\] : "ja-JP"/);
  assert.match(wrapper, /\.\.\.\(locale \? \[locale\] : \[\]\)/);
  assert.match(wrapper, /argument === "--locale"/);
});

test("transcribe-sa forwards only input without --locale and forwards en-US when given", async (t) => {
  const script = path.join(directory, "transcribe-sa.mjs");
  const check = spawnSync(process.execPath, [script, "--check"], { encoding: "utf8" });
  if (check.status !== 0 || JSON.parse(check.stdout).available !== true) return t.skip("SpeechAnalyzer prerequisites unavailable");

  const root = await mkdtemp(path.join(os.tmpdir(), "transcribe-sa-locale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = path.join(root, "input.wav");
  const helper = path.join(root, "fake-helper");
  await writeFile(input, "fixture");
  await writeFile(helper, `#!/bin/sh
exec node -e 'const a=process.argv.slice(1); const text=JSON.stringify(a); process.stdout.write(JSON.stringify({engine:"macOS SpeechAnalyzer/SpeechTranscriber",locale:a[1]??"ja-JP",input:a[0],assetStatusBefore:"installed",assetStatusAfter:"installed",assetInstallationSeconds:0,transcript:text,segments:[{start:0,end:1,text,words:[]}],words:[]})+"\\n")' -- "$@"
`);
  await chmod(helper, 0o755);
  const swiftMtime = (await stat(path.join(directory, "speechanalyzer-helper.swift"))).mtimeMs;
  const newer = new Date(swiftMtime + 10_000);
  await utimes(helper, newer, newer);

  const invoke = (extra) => {
    const result = spawnSync(process.execPath, [script, "--input", input, "--helper-bin", helper, ...extra], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout);
  };
  const legacy = invoke([]);
  assert.equal(legacy.locale, "ja-JP");
  assert.deepEqual(JSON.parse(legacy.segments[0].text), [input]);
  const english = invoke(["--locale", "en-US"]);
  assert.equal(english.locale, "en-US");
  assert.deepEqual(JSON.parse(english.segments[0].text), [input, "en-US"]);
});
