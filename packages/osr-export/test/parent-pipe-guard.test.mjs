import { strict as assert } from "node:assert";
import { EventEmitter } from "node:events";
import test from "node:test";

import { installParentPipeGuard, isBrokenPipe } from "../src/parent-pipe-guard.mjs";

// 中止（親の kill）で書き出し Electron が「A JavaScript error occurred in the main
// process」ダイアログを出したまま残る事故の回帰テスト。ダイアログはモーダルなので、
// 出た時点でプロセスは二度と終了しない。安全網は例外を Electron 既定ハンドラへ
// 渡さず、必ず app.exit で終端しなければならない。

/** process のグローバルを汚さずに guard を検査するための最小スタブ。 */
function withStubbedProcess(run) {
  const original = {
    stdout: process.stdout,
    stderr: process.stderr,
    on: process.on,
    exit: process.exit,
  };
  const listeners = new Map();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  stderr.write = () => true;
  const exits = [];
  Object.defineProperty(process, "stdout", { value: stdout, configurable: true });
  Object.defineProperty(process, "stderr", { value: stderr, configurable: true });
  process.on = (event, listener) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
    return process;
  };
  process.exit = (code) => { exits.push(code); };
  try {
    return run({ listeners, stdout, stderr, exits, emit: (event, ...args) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    } });
  } finally {
    Object.defineProperty(process, "stdout", { value: original.stdout, configurable: true });
    Object.defineProperty(process, "stderr", { value: original.stderr, configurable: true });
    process.on = original.on;
    process.exit = original.exit;
  }
}

function fakeApp() {
  const exits = [];
  return { exits, exit: (code) => exits.push(code) };
}

test("isBrokenPipe: 親が消えた合図だけを真とする", () => {
  assert.equal(isBrokenPipe({ code: "EPIPE" }), true);
  assert.equal(isBrokenPipe({ code: "ERR_STREAM_DESTROYED" }), true);
  assert.equal(isBrokenPipe({ code: "ERR_STREAM_WRITE_AFTER_END" }), true);
  assert.equal(isBrokenPipe({ code: "ENOENT" }), false);
  assert.equal(isBrokenPipe(new Error("boom")), false);
  assert.equal(isBrokenPipe(undefined), false);
});

test("stdout の EPIPE で app.exit(1) する（未処理の 'error' として昇格させない）", () => {
  const app = fakeApp();
  withStubbedProcess(({ stdout }) => {
    installParentPipeGuard(app);
    // リスナーが付いていなければ EventEmitter は throw する。付いていることを兼ねて検査する。
    stdout.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
  });
  assert.deepEqual(app.exits, [1]);
});

test("uncaughtException を受けて app.exit(1) する（Electron 既定ダイアログへ渡さない）", () => {
  const app = fakeApp();
  withStubbedProcess(({ emit }) => {
    installParentPipeGuard(app);
    emit("uncaughtException", new Error("boom"));
  });
  assert.deepEqual(app.exits, [1]);
});

test("unhandledRejection も受けて app.exit(1) する", () => {
  const app = fakeApp();
  withStubbedProcess(({ emit }) => {
    installParentPipeGuard(app);
    emit("unhandledRejection", new Error("boom"));
  });
  assert.deepEqual(app.exits, [1]);
});

test("SIGTERM / SIGINT / SIGHUP で終端する（中止はプロセスグループ宛に飛んでくる）", () => {
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    const app = fakeApp();
    withStubbedProcess(({ emit }) => {
      installParentPipeGuard(app);
      emit(signal);
    });
    assert.deepEqual(app.exits, [1], `${signal} で終端しなかった`);
  }
});

test("二重終端しない（EPIPE が連続しても app.exit は 1 回）", () => {
  const app = fakeApp();
  withStubbedProcess(({ stdout, stderr, emit }) => {
    installParentPipeGuard(app);
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    stdout.emit("error", epipe);
    stderr.emit("error", epipe);
    emit("uncaughtException", epipe);
  });
  assert.deepEqual(app.exits, [1]);
});

test("app.exit が投げても process.exit へ落ちて必ず終端する", () => {
  const app = { exit: () => { throw new Error("app not ready"); } };
  const exits = withStubbedProcess(({ emit, exits: recorded }) => {
    installParentPipeGuard(app);
    emit("uncaughtException", new Error("boom"));
    return recorded;
  });
  assert.deepEqual(exits, [1]);
});
