import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, unlink, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { BINARY_MANIFEST, WHISPER_CPP_SOURCE, currentTarget, vendorBinaryPath } from "../src/binary-manifest.mjs";
import { resolveWhisperCli } from "../src/index.mjs";

// 実ネットワークを叩かないユニットテスト（manifest の形式検証 + resolveWhisperCli の分岐）。
// build-whisper.mjs（cmake ソースビルド）自体はここではテストしない — cmake の有無に
// 依存するため、実測確認は task の「ローカル実証」手順（report.md 参照）で行う。

function baseEnv(overrides = {}) {
  return {
    ...process.env,
    AKARI_WHISPER_BIN: undefined,
    ...overrides,
  };
}

const STRIPPED_PATH_ENV = baseEnv({ PATH: "/usr/bin:/bin" });

async function withFixtureFile(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "akari-media-bin-whisper-"));
  const filePath = path.join(dir, "fake-whisper-cli");
  await writeFile(filePath, "#!/bin/sh\nexit 0\n");
  await chmod(filePath, 0o755);
  try {
    await run(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("binary-manifest: win32-x64 の whisper-cli エントリが4条件どおりの形式を満たす", () => {
  const win32 = BINARY_MANIFEST["win32-x64"];
  assert.ok(win32, "win32-x64 ターゲットが manifest に存在する");
  const entry = win32.entries["whisper-cli"];
  assert.ok(entry, "win32-x64.entries.whisper-cli が存在する");

  assert.match(entry.url, /^https:\/\/github\.com\/ggml-org\/whisper\.cpp\/releases\/download\/v[\d.]+\/.+\.zip$/);
  assert.match(entry.sha256, /^[0-9a-f]{64}$/, "sha256 は64桁16進");
  assert.match(entry.member, /^Release\/whisper-cli\.exe$/);
  assert.ok(Array.isArray(entry.extraMembers) && entry.extraMembers.length > 0, "companion DLL 群がある");
  for (const extra of entry.extraMembers) {
    assert.match(extra, /^Release\/.+\.dll$/, `extraMember は Release/ 配下の .dll のはず: ${extra}`);
  }
  // whisper-cli の直接依存（objdump -p 実測: whisper.dll -> ggml.dll -> ggml-base.dll）は必須
  for (const required of ["Release/whisper.dll", "Release/ggml.dll", "Release/ggml-base.dll"]) {
    assert.ok(entry.extraMembers.includes(required), `${required} が同梱されているはず`);
  }
  assert.match(entry.license ?? "", /MIT/);
});

test("binary-manifest: WHISPER_CPP_SOURCE（macOS ソースビルド用の版固定）が sha256 検証可能な形式", () => {
  assert.match(WHISPER_CPP_SOURCE.tag, /^v\d+\.\d+\.\d+$/);
  assert.match(WHISPER_CPP_SOURCE.url, /^https:\/\/github\.com\/ggml-org\/whisper\.cpp\/archive\/refs\/tags\/.+\.tar\.gz$/);
  assert.match(WHISPER_CPP_SOURCE.sha256, /^[0-9a-f]{64}$/);
  assert.match(WHISPER_CPP_SOURCE.license, /MIT/);
});

test("resolveWhisperCli: AKARI_WHISPER_BIN の実在する絶対パスが最優先で使われる", async () => {
  await withFixtureFile(async (fakeWhisper) => {
    const resolved = resolveWhisperCli({ env: baseEnv({ AKARI_WHISPER_BIN: fakeWhisper }) });
    assert.equal(resolved, fakeWhisper);
  });
});

test("resolveWhisperCli: AKARI_WHISPER_BIN の存在しない絶対パスは従来のエラーになる", () => {
  assert.throws(
    () => resolveWhisperCli({ env: baseEnv({ AKARI_WHISPER_BIN: "/no/such/whisper-cli-binary" }) }),
    {
      message: "AKARI_WHISPER_BIN で指定されたファイルがありません: /no/such/whisper-cli-binary",
    },
  );
});

test("resolveWhisperCli: AKARI_WHISPER_BIN のコマンド名を PATH で解決する", () => {
  const resolved = resolveWhisperCli({ env: baseEnv({ AKARI_WHISPER_BIN: "node" }) });
  assert.equal(resolved, "node");
});

test("resolveWhisperCli: PATH にない明示コマンドは原因と次の一手を案内する", () => {
  assert.throws(
    () =>
      resolveWhisperCli({
        env: baseEnv({ AKARI_WHISPER_BIN: "akari-command-that-does-not-exist" }),
      }),
    (error) => {
      assert.match(error.message, /AKARI_WHISPER_BIN.*明示指定/);
      assert.match(error.message, /akari-command-that-does-not-exist が PATH に見つかりません/);
      return true;
    },
  );
});

test("resolveWhisperCli: 同梱バイナリが存在すれば PATH の探索より先に返す（vendor 優先の順序）", async () => {
  const target = currentTarget();
  const vendorPath = vendorBinaryPath("whisper-cli", target);
  // 実 vendor/ に既に本物があれば上書きしない（build-whisper.mjs の成果物を壊さないため）。
  const alreadyReal = existsSync(vendorPath);
  if (alreadyReal) {
    // 既に本物がある環境では「vendor が返る」こと自体は自明に検証できるので、そのまま検証する。
    const resolved = resolveWhisperCli({ env: baseEnv() });
    assert.equal(resolved, vendorPath);
    return;
  }
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(vendorPath), { recursive: true });
  await writeFile(vendorPath, "#!/bin/sh\nexit 0\n");
  await chmod(vendorPath, 0o755);
  try {
    // PATH は素の env のまま（PATH 上に whisper-cli があってもなくても、vendor 優先なら
    // canRun(PATH) を試す前に vendor を返すはず — 順序そのものを検証する）。
    const resolved = resolveWhisperCli({ env: baseEnv() });
    assert.equal(resolved, vendorPath);
  } finally {
    await unlink(vendorPath).catch(() => {});
  }
});

test("resolveWhisperCli: env・vendor・PATH のいずれも無ければ有益なエラーになる", () => {
  const target = currentTarget();
  const vendorPath = vendorBinaryPath("whisper-cli", target);
  if (existsSync(vendorPath)) {
    // このマシンで既に build-whisper.mjs が成功している場合はこのケースを再現できないため skip 相当。
    return;
  }
  assert.throws(
    () => resolveWhisperCli({ env: STRIPPED_PATH_ENV }),
    (error) => {
      assert.match(error.message, /whisper-cli が見つかりませんでした/);
      assert.match(error.message, /AKARI_WHISPER_BIN/);
      assert.match(error.message, /同梱バイナリ/);
      // env → 同梱バイナリ → PATH の順序であることをメッセージでも確認する
      assert.match(error.message, /同梱バイナリ（.*） → PATH/);
      return true;
    },
  );
});
