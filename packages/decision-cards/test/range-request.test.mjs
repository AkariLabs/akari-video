// レポート内に動画を埋めるための HTTP レンジ配信の実測。
// iOS Safari は <video> に対してまず `Range: bytes=0-1` を投げ、206 が返らないと再生を諦めるため、
// ここが通らないとスマホでレポート内の動画が再生できない。
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const helperPath = path.join(packageDirectory, "report-helper.mjs");

const CLIP_SIZE = 8_192;
const CLIP_BYTES = Buffer.alloc(CLIP_SIZE);
for (let index = 0; index < CLIP_SIZE; index += 1) {
  CLIP_BYTES[index] = index % 256;
}

function waitForHelperUrl(child) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`helper did not start: ${stdout}${stderr}`));
    }, 10_000);

    function cleanup() {
      clearTimeout(timer);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("exit", onExit);
    }

    function onStdout(chunk) {
      stdout += chunk.toString();
      const match = /HELPER: (http:\/\/localhost:\d+)\//.exec(stdout);
      if (match) {
        cleanup();
        resolve(match[1]);
      }
    }

    function onStderr(chunk) {
      stderr += chunk.toString();
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`helper exited with ${code}: ${stdout}${stderr}`));
    }

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("exit", onExit);
  });
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
}

async function withHelper(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "akari-range-"));
  const reportPath = path.join(directory, "report.html");
  let child = null;
  try {
    await writeFile(
      reportPath,
      '<!doctype html><meta charset="utf-8"><title>t</title>' +
        '<video src="clip.mp4" controls></video>\n',
      "utf8",
    );
    await writeFile(path.join(directory, "clip.mp4"), CLIP_BYTES);
    await writeFile(path.join(directory, "take.mov"), CLIP_BYTES);
    await writeFile(path.join(directory, "empty.mp4"), Buffer.alloc(0));

    child = spawn(process.execPath, [helperPath, reportPath, "--port", "0"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const baseUrl = await waitForHelperUrl(child);
    await run(baseUrl);
  } finally {
    if (child !== null) await stopProcess(child);
    await rm(directory, { recursive: true, force: true });
  }
}

test("iOS Safari の先頭プローブ bytes=0-1 に 206 で答える", async () => {
  await withHelper(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/clip.mp4`, {
      headers: { Range: "bytes=0-1" },
    });

    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-type"), "video/mp4");
    assert.equal(
      response.headers.get("content-range"),
      `bytes 0-1/${CLIP_SIZE}`,
    );
    assert.equal(response.headers.get("content-length"), "2");
    assert.equal(response.headers.get("accept-ranges"), "bytes");

    const body = Buffer.from(await response.arrayBuffer());
    assert.deepEqual(body, CLIP_BYTES.subarray(0, 2));
  });
});

test("レンジ無しの取得は 200 + accept-ranges で全体を返す", async () => {
  await withHelper(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/clip.mp4`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-length"), String(CLIP_SIZE));

    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.length, CLIP_SIZE);
    assert.deepEqual(body, CLIP_BYTES);
  });
});

test("途中シーク（bytes=N-）と末尾指定（bytes=-N）を正しく切り出す", async () => {
  await withHelper(async (baseUrl) => {
    const openEnded = await fetch(`${baseUrl}/clip.mp4`, {
      headers: { Range: "bytes=4096-" },
    });
    assert.equal(openEnded.status, 206);
    assert.equal(
      openEnded.headers.get("content-range"),
      `bytes 4096-${CLIP_SIZE - 1}/${CLIP_SIZE}`,
    );
    assert.deepEqual(
      Buffer.from(await openEnded.arrayBuffer()),
      CLIP_BYTES.subarray(4096),
    );

    const suffix = await fetch(`${baseUrl}/clip.mp4`, {
      headers: { Range: "bytes=-100" },
    });
    assert.equal(suffix.status, 206);
    assert.equal(
      suffix.headers.get("content-range"),
      `bytes ${CLIP_SIZE - 100}-${CLIP_SIZE - 1}/${CLIP_SIZE}`,
    );
    assert.deepEqual(
      Buffer.from(await suffix.arrayBuffer()),
      CLIP_BYTES.subarray(CLIP_SIZE - 100),
    );
  });
});

test("範囲外は 416、壊れた指定は 200 全体配信へフォールバックする", async () => {
  await withHelper(async (baseUrl) => {
    const unsatisfiable = await fetch(`${baseUrl}/clip.mp4`, {
      headers: { Range: `bytes=${CLIP_SIZE}-${CLIP_SIZE + 10}` },
    });
    assert.equal(unsatisfiable.status, 416);
    assert.equal(
      unsatisfiable.headers.get("content-range"),
      `bytes */${CLIP_SIZE}`,
    );

    for (const malformed of ["bytes=abc", "items=0-1", "bytes=0-1,4-5"]) {
      const response = await fetch(`${baseUrl}/clip.mp4`, {
        headers: { Range: malformed },
      });
      assert.equal(response.status, 200, `fallback failed for ${malformed}`);
      assert.equal(response.headers.get("content-length"), String(CLIP_SIZE));
    }
  });
});

test("動画の Content-Type を octet-stream ではなく実型で返す", async () => {
  await withHelper(async (baseUrl) => {
    const mp4 = await fetch(`${baseUrl}/clip.mp4`, {
      headers: { Range: "bytes=0-1" },
    });
    assert.equal(mp4.headers.get("content-type"), "video/mp4");

    const mov = await fetch(`${baseUrl}/take.mov`, {
      headers: { Range: "bytes=0-1" },
    });
    assert.equal(mov.headers.get("content-type"), "video/quicktime");
  });
});

test("空ファイルはレンジ要求でも 200 / 長さ 0 で壊れない", async () => {
  await withHelper(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/empty.mp4`, {
      headers: { Range: "bytes=0-1" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), "0");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });
});

// fetch / WHATWG URL は `..` も `%2e%2e` セグメントもクライアント側で正規化して消してしまい、
// 生のパスがサーバーへ届かない。トラバーサルの検査は node:http で経路を素通しして行う。
function rawGet(baseUrl, rawPath) {
  const { port } = new URL(baseUrl);
  return new Promise((resolvePromise, rejectPromise) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port: Number(port),
        method: "GET",
        path: rawPath,
        headers: { Range: "bytes=0-1" },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolvePromise(response.statusCode));
      },
    );
    request.on("error", rejectPromise);
    request.end();
  });
}

test("レンジ対応後もパストラバーサルは 403 のまま", async () => {
  await withHelper(async (baseUrl) => {
    for (const attack of [
      "/../../etc/passwd",
      "/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "/%2e%2e/%2e%2e/etc/passwd",
    ]) {
      const status = await rawGet(baseUrl, attack);
      assert.equal(status, 403, `traversal not blocked: ${attack}`);
    }
  });
});
