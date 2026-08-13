import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveFfmpeg, resolveFfprobe } from "../src/index.mjs";

// システムに ffmpeg/ffprobe が入っていても影響を受けないよう、実行の度に
// AKARI_*_BIN / FFMPEG_PATH を明示的に undefined へ倒したベース env を組み立てる。
function baseEnv(overrides = {}) {
  return {
    ...process.env,
    AKARI_FFMPEG_BIN: undefined,
    AKARI_FFPROBE_BIN: undefined,
    FFMPEG_PATH: undefined,
    ...overrides,
  };
}

// PATH からシステムの ffmpeg/ffprobe を外し、vendor/ 同梱バイナリへの
// フォールバックだけが効く状態を作る（task.md 記載の `env PATH=/usr/bin:/bin` と同じ狙い）。
const STRIPPED_PATH_ENV = baseEnv({ PATH: "/usr/bin:/bin" });

async function withFixtureFile(run) {
  const dir = await mkdtemp(path.join(tmpdir(), "akari-media-bin-"));
  const filePath = path.join(dir, "fake-ffmpeg");
  await writeFile(filePath, "#!/bin/sh\nexit 0\n");
  await chmod(filePath, 0o755);
  try {
    await run(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("resolveFfmpeg: AKARI_FFMPEG_BIN の実在する絶対パスが最優先で使われる", async () => {
  await withFixtureFile(async (fakeFfmpeg) => {
    const resolved = resolveFfmpeg({ env: baseEnv({ AKARI_FFMPEG_BIN: fakeFfmpeg }) });
    assert.equal(resolved, fakeFfmpeg);
  });
});

test("resolveFfmpeg: AKARI_FFMPEG_BIN の存在しない絶対パスは従来のエラーになる", () => {
  assert.throws(
    () => resolveFfmpeg({ env: baseEnv({ AKARI_FFMPEG_BIN: "/no/such/ffmpeg-binary" }) }),
    {
      message: "AKARI_FFMPEG_BIN で指定されたファイルがありません: /no/such/ffmpeg-binary",
    },
  );
});

test("resolveFfmpeg: AKARI_FFMPEG_BIN のコマンド名を PATH で解決する", () => {
  const resolved = resolveFfmpeg({ env: baseEnv({ AKARI_FFMPEG_BIN: "node" }) });
  assert.equal(resolved, "node");
});

test("resolveFfprobe: AKARI_FFPROBE_BIN のコマンド名を PATH で解決する", () => {
  const resolved = resolveFfprobe({ env: baseEnv({ AKARI_FFPROBE_BIN: "node" }) });
  assert.equal(resolved, "node");
});

test("resolveFfprobe: PATH にない明示コマンドは原因と次の一手を案内する", () => {
  assert.throws(
    () =>
      resolveFfprobe({
        env: baseEnv({ AKARI_FFPROBE_BIN: "akari-command-that-does-not-exist" }),
      }),
    (error) => {
      assert.match(error.message, /AKARI_FFPROBE_BIN.*明示指定/);
      assert.match(error.message, /akari-command-that-does-not-exist が PATH に見つかりません/);
      assert.match(error.message, /絶対パスを指定するか PATH を確認/);
      return true;
    },
  );
});

test("resolveFfprobe: バックスラッシュを含む値は PATH 探索せず従来のエラーになる", () => {
  assert.throws(
    () =>
      resolveFfprobe({
        env: baseEnv({ AKARI_FFPROBE_BIN: "missing\\ffprobe.exe" }),
      }),
    {
      message: "AKARI_FFPROBE_BIN で指定されたファイルがありません: missing\\ffprobe.exe",
    },
  );
});

test("resolveFfmpeg: 既存互換の FFMPEG_PATH は AKARI_FFMPEG_BIN が無いときだけ使われる", async () => {
  await withFixtureFile(async (fakeFfmpeg) => {
    const resolved = resolveFfmpeg({ env: baseEnv({ FFMPEG_PATH: fakeFfmpeg }) });
    assert.equal(resolved, fakeFfmpeg);
  });
});

test("resolveFfmpeg: 既存互換の FFMPEG_PATH もコマンド名を PATH で解決する", () => {
  const resolved = resolveFfmpeg({ env: baseEnv({ FFMPEG_PATH: "node" }) });
  assert.equal(resolved, "node");
});

test("resolveFfmpeg: FFMPEG_PATH の存在しない絶対パスは従来のエラーになる", () => {
  assert.throws(
    () => resolveFfmpeg({ env: baseEnv({ FFMPEG_PATH: "/no/such/legacy-ffmpeg-binary" }) }),
    {
      message: "FFMPEG_PATH で指定されたファイルがありません: /no/such/legacy-ffmpeg-binary",
    },
  );
});

test("resolveFfmpeg: PATH にない FFMPEG_PATH のコマンド名も明示指定エラーになる", () => {
  assert.throws(
    () =>
      resolveFfmpeg({
        env: baseEnv({ FFMPEG_PATH: "akari-command-that-does-not-exist" }),
      }),
    (error) => {
      assert.match(error.message, /FFMPEG_PATH.*明示指定/);
      assert.match(error.message, /akari-command-that-does-not-exist が PATH に見つかりません/);
      assert.match(error.message, /絶対パスを指定するか PATH を確認/);
      return true;
    },
  );
});

test("resolveFfmpeg: AKARI_FFMPEG_BIN が FFMPEG_PATH より優先される", async () => {
  await withFixtureFile(async (preferred) => {
    await withFixtureFile(async (legacy) => {
      const resolved = resolveFfmpeg({
        env: baseEnv({ AKARI_FFMPEG_BIN: preferred, FFMPEG_PATH: legacy }),
      });
      assert.equal(resolved, preferred);
    });
  });
});

test("resolveFfmpeg: PATH に ffmpeg があればコマンド名を返す", () => {
  // このリポの開発環境は ffmpeg が入っている前提（task.md item4 の非退行確認と同じ前提）。
  const resolved = resolveFfmpeg({ env: baseEnv() });
  assert.equal(resolved, "ffmpeg");
});

test("resolveFfmpeg: PATH から外すと vendor 同梱バイナリへフォールバックし、実行できる", () => {
  const resolved = resolveFfmpeg({ env: STRIPPED_PATH_ENV });
  assert.notEqual(resolved, "ffmpeg");
  assert.ok(path.isAbsolute(resolved), `絶対パスのはず: ${resolved}`);

  const result = spawnSync(resolved, ["-version"], { stdio: "pipe", encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ffmpeg version/);
});

test("resolveFfprobe: PATH から外すと vendor 同梱バイナリへフォールバックし、実行できる", () => {
  const resolved = resolveFfprobe({ env: STRIPPED_PATH_ENV });
  assert.notEqual(resolved, "ffprobe");
  assert.ok(path.isAbsolute(resolved), `絶対パスのはず: ${resolved}`);

  const result = spawnSync(resolved, ["-version"], { stdio: "pipe", encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /ffprobe version/);
});

test("resolveFfprobe: AKARI_FFPROBE_BIN が最優先で使われる", async () => {
  await withFixtureFile(async (fakeFfprobe) => {
    const resolved = resolveFfprobe({ env: baseEnv({ AKARI_FFPROBE_BIN: fakeFfprobe }) });
    assert.equal(resolved, fakeFfprobe);
  });
});
