import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
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

test("a newer legacy cached helper cannot replace the source-versioned helper", async (t) => {
  if (process.platform !== "darwin") return t.skip("SpeechAnalyzer is macOS-only");
  const root = await mkdtemp(path.join(os.tmpdir(), "transcribe-sa-version-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const cache = path.join(root, "akari-speech-analyzer");
  await mkdir(bin);
  await mkdir(cache);
  const input = path.join(root, "input.wav");
  const legacy = path.join(cache, "speechanalyzer-helper");
  const template = path.join(root, "current-helper");
  const buildLog = path.join(root, "build.log");
  const outputLog = path.join(root, "output.log");
  await writeFile(input, "fixture");
  await writeFile(legacy, "#!/bin/sh\necho 'usage: speechanalyzer-helper INPUT_AUDIO' >&2\nexit 1\n");
  await chmod(legacy, 0o755);
  const newer = new Date(Date.now() + 60_000);
  await utimes(legacy, newer, newer);
  await writeFile(template, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.length !== 2) process.exit(2);
process.stdout.write(JSON.stringify({locale:args[1],segments:[{start:0,end:1,text:args[1],words:[]}]}) + "\\n");
`);
  await chmod(template, 0o755);
  await writeFile(path.join(bin, "sw_vers"), "#!/bin/sh\necho 26.2\n");
  await writeFile(path.join(bin, "swiftc"), `#!/bin/sh
if [ "$1" = "-version" ]; then echo "swiftc mock"; exit 0; fi
printf 'built\\n' >> "$FAKE_BUILD_LOG"
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    printf '%s\\n' "$2" >> "$FAKE_OUTPUT_LOG"
    cp "$FAKE_HELPER_TEMPLATE" "$2"
    if [ "$FAKE_BUILD_FAIL" = "1" ]; then exit 1; fi
    chmod +x "$2"
    exit 0
  fi
  shift
done
exit 2
`);
  await chmod(path.join(bin, "sw_vers"), 0o755);
  await chmod(path.join(bin, "swiftc"), 0o755);
  const script = path.join(directory, "transcribe-sa.mjs");
  const env = { ...process.env, TMPDIR: root, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_HELPER_TEMPLATE: template, FAKE_BUILD_LOG: buildLog, FAKE_OUTPUT_LOG: outputLog, FAKE_BUILD_FAIL: "0" };
  const invoke = (extraEnv = {}) => spawnSync(process.execPath, [script, "--input", input, "--helper-bin", legacy, "--locale", "en-US"], { encoding: "utf8", env: { ...env, ...extraEnv } });
  const source = await readFile(path.join(directory, "speechanalyzer-helper.swift"));
  const hash = createHash("sha256").update(source).digest("hex").slice(0, 16);
  const finalName = `speechanalyzer-helper-${hash}`;
  const failed = invoke({ FAKE_BUILD_FAIL: "1" });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.match(JSON.parse(failed.stdout).reason, /^swiftc build failed:/);
  assert.deepEqual(await readdir(cache), ["speechanalyzer-helper"]);
  for (let index = 0; index < 2; index += 1) {
    const result = invoke();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).locale, "en-US");
  }
  assert.deepEqual((await readFile(buildLog, "utf8")).trim().split("\n"), ["built", "built"]);
  const names = await readdir(cache);
  assert.deepEqual(names.sort(), ["speechanalyzer-helper", finalName].sort());
  const outputPaths = (await readFile(outputLog, "utf8")).trim().split("\n");
  assert.equal(outputPaths.length, 2);
  for (const outputPath of outputPaths) {
    assert.equal(path.dirname(outputPath), cache);
    assert.match(path.basename(outputPath), new RegExp(`^${finalName}\\.tmp-`));
  }
});

test("an explicit unmanaged helper is built when missing or older than its source", async (t) => {
  if (process.platform !== "darwin") return t.skip("SpeechAnalyzer is macOS-only");
  const root = await mkdtemp(path.join(os.tmpdir(), "transcribe-sa-explicit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const input = path.join(root, "input.wav");
  const helper = path.join(root, "custom-helper");
  const template = path.join(root, "helper-template");
  const buildLog = path.join(root, "build.log");
  await writeFile(input, "fixture");
  await writeFile(template, "#!/bin/sh\nprintf '%s\\n' '{\"locale\":\"en-US\",\"segments\":[{\"start\":0,\"end\":1,\"text\":\"hello\",\"words\":[]}]}'\n");
  await chmod(template, 0o755);
  await writeFile(path.join(bin, "sw_vers"), "#!/bin/sh\necho 26.2\n");
  await writeFile(path.join(bin, "swiftc"), `#!/bin/sh
if [ "$1" = "-version" ]; then echo "swiftc mock"; exit 0; fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-o" ]; then
    printf '%s\\n' "$2" >> "$FAKE_BUILD_LOG"
    cp "$FAKE_HELPER_TEMPLATE" "$2"
    chmod +x "$2"
    exit 0
  fi
  shift
done
exit 2
`);
  await chmod(path.join(bin, "sw_vers"), 0o755);
  await chmod(path.join(bin, "swiftc"), 0o755);
  const script = path.join(directory, "transcribe-sa.mjs");
  const env = { ...process.env, TMPDIR: root, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_HELPER_TEMPLATE: template, FAKE_BUILD_LOG: buildLog };
  const invoke = () => {
    const result = spawnSync(process.execPath, [script, "--input", input, "--helper-bin", helper, "--locale", "en-US"], { encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).locale, "en-US");
  };
  invoke();
  const sourceMtime = (await stat(path.join(directory, "speechanalyzer-helper.swift"))).mtimeMs;
  await writeFile(helper, "#!/bin/sh\nexit 1\n");
  await chmod(helper, 0o755);
  const older = new Date(sourceMtime - 10_000);
  await utimes(helper, older, older);
  invoke();
  const newer = new Date(sourceMtime + 10_000);
  await utimes(helper, newer, newer);
  invoke();
  assert.deepEqual((await readFile(buildLog, "utf8")).trim().split("\n"), [helper, helper]);
});
