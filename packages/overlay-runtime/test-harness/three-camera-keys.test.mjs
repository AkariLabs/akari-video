// three-runtime.js の宣言的カメラキーフレーム（camera.keys）を Node で検証する。
//
//   - キーより前・キー間・キーより後・キー 1 個の保持
//   - linear / easeInOut の 2 語彙（ease はそのキーへ入る区間に効く）
//   - t が昇順でない宣言はソートせずエラー（理由に両方の t を出す）
//   - camera.fromModel との併用は keys を優先し、警告を 1 行返す
//   - 同じ t は常に同じ姿勢（決定論）
//
// three-runtime.js はブラウザ IIFE なので、window だけ差して読み込み、公開した純関数を叩く。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(resolve(HERE, "../src/three-runtime.js"), "utf8");
const context = { window: {} };
runInNewContext(SOURCE, context, { filename: "three-runtime.js" });
const runtime = context.window.akari.threeRuntime;

const keys = (...entries) => runtime.validateCameraKeys(entries);
// vm の別レルムで作られた配列を、このレルムの素の配列へ写して比較する。
const cameraKeysAt = (camera, seconds) => {
  const pose = runtime.cameraKeysAt(camera, seconds);
  return { position: Array.from(pose.position), lookAt: Array.from(pose.lookAt) };
};
const close = (actual, expected, epsilon = 1e-9) => Array.isArray(expected)
  && Array.isArray(actual)
  && expected.length === actual.length
  && expected.every((value, index) => Math.abs(actual[index] - value) <= epsilon);

const key = (t, position, lookAt, ease) => ({
  t,
  position,
  lookAt,
  ...(ease === undefined ? {} : { ease }),
});

test("camera.keys: 最初のキーより前は最初のキーで保持", () => {
  const camera = keys(
    key(1, [1, 2, 3], [4, 5, 6]),
    key(3, [7, 8, 9], [10, 11, 12]),
  );
  assert.deepEqual(cameraKeysAt(camera, 0), {
    position: [1, 2, 3],
    lookAt: [4, 5, 6],
  });
  assert.deepEqual(cameraKeysAt(camera, -5), {
    position: [1, 2, 3],
    lookAt: [4, 5, 6],
  });
});

test("camera.keys: キー間は position / lookAt を成分ごとに linear 補間", () => {
  const camera = keys(
    key(0, [0, 0, 0], [0, 0, 0]),
    key(2, [2, 4, 6], [10, 0, -2]),
  );
  assert.deepEqual(cameraKeysAt(camera, 0.5), {
    position: [0.5, 1, 1.5],
    lookAt: [2.5, 0, -0.5],
  });
  assert.deepEqual(cameraKeysAt(camera, 1), {
    position: [1, 2, 3],
    lookAt: [5, 0, -1],
  });
});

test("camera.keys: 最後のキーより後は最後のキーで保持", () => {
  const camera = keys(
    key(0, [0, 0, 0], [0, 0, 0]),
    key(2, [2, 4, 6], [10, 0, -2]),
  );
  assert.deepEqual(cameraKeysAt(camera, 99), {
    position: [2, 4, 6],
    lookAt: [10, 0, -2],
  });
});

test("camera.keys: キー 1 個はその固定値", () => {
  const camera = keys(key(5, [1, 2, 3], [4, 5, 6]));
  for (const seconds of [0, 5, 100]) {
    assert.deepEqual(cameraKeysAt(camera, seconds), {
      position: [1, 2, 3],
      lookAt: [4, 5, 6],
    });
  }
});

test("camera.keys: easeInOut は linear と違い、両端で 0/1 に張り付く", () => {
  const eased = keys(
    key(0, [0, 0, 0], [0, 0, 0]),
    key(2, [8, 0, 0], [8, 0, 0], "easeInOut"),
  );
  const linear = keys(
    key(0, [0, 0, 0], [0, 0, 0]),
    key(2, [8, 0, 0], [8, 0, 0]),
  );
  // u = 0.2 → easeInOut = 4 * 0.2^3 = 0.032
  assert.equal(close(cameraKeysAt(eased, 0.4).position, [0.256, 0, 0]), true);
  assert.equal(close(cameraKeysAt(linear, 0.4).position, [1.6, 0, 0]), true);
  assert.deepEqual(cameraKeysAt(eased, 2).position, [8, 0, 0]);
  assert.deepEqual(cameraKeysAt(eased, 0).position, [0, 0, 0]);
});

test("camera.keys: ease は「そのキーへ入る区間」に効く（開始キーの ease は使わない）", () => {
  const camera = keys(
    key(0, [0, 0, 0], [0, 0, 0], "easeInOut"),
    key(2, [8, 0, 0], [8, 0, 0]),
  );
  assert.deepEqual(cameraKeysAt(camera, 0.4).position, [1.6, 0, 0]);
});

test("camera.keys: t が昇順でない宣言はソートせずエラー（両方の t を理由に出す）", () => {
  assert.throws(
    () => keys(
      key(2, [0, 0, 0], [0, 0, 0]),
      key(1, [1, 0, 0], [1, 0, 0]),
    ),
    /camera\.keys は t の昇順である必要があります.*camera\.keys\[1\]\.t=1.*camera\.keys\[0\]\.t=2/u,
  );
  assert.throws(
    () => keys(
      key(1, [0, 0, 0], [0, 0, 0]),
      key(1, [1, 0, 0], [1, 0, 0]),
    ),
    /camera\.keys は t の昇順である必要があります/u,
  );
});

test("camera.keys: 形の誤りは理由つきで拒否", () => {
  assert.throws(() => keys(), /1 個以上/u);
  assert.throws(() => keys(key(Number.NaN, [0, 0, 0], [0, 0, 0])), /\.t は有限数/u);
  assert.throws(() => keys(key(0, [0, 0], [0, 0, 0])), /\.position は \[x, y, z\]/u);
  assert.throws(() => keys(key(0, [0, 0, 0], [0, 0, 0], "out-cubic")), /\.ease は linear または easeInOut/u);
  assert.throws(() => keys({ ...key(0, [0, 0, 0], [0, 0, 0]), lookat: [0, 0, 0] }), /未対応キー.*lookat/u);
});

test("camera.keys: 同じ t は常に同じ姿勢（決定論）", () => {
  const camera = keys(
    key(0, [0, 1, 5], [0, 0, 0], "easeInOut"),
    key(1.5, [3, 2, 8], [1, 0, 0]),
    key(3, [-2, 0, 4], [0, 1, 0], "easeInOut"),
  );
  for (const seconds of [0.1, 0.7, 1.5, 2.2, 2.9]) {
    assert.deepEqual(cameraKeysAt(camera, seconds), cameraKeysAt(camera, seconds));
  }
});

test("camera.fromModel と camera.keys の併用は keys 優先の警告を 1 行返す", () => {
  const message = runtime.cameraKeysConflictWarning({
    fromModel: "ShotCam",
    keys: [key(0, [0, 0, 0], [0, 0, 0])],
  });
  assert.equal(typeof message, "string");
  assert.match(message, /camera\.keys/u);
  assert.match(message, /camera\.fromModel/u);
  assert.match(message, /優先/u);
  assert.equal(runtime.cameraKeysConflictWarning({ fromModel: "ShotCam" }), null);
  assert.equal(runtime.cameraKeysConflictWarning({ keys: [] }), null);
  assert.equal(runtime.cameraKeysConflictWarning(undefined), null);
});
