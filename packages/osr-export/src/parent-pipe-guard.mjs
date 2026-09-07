// 親（CLI）を失った書き出し Electron が「静かに死ぬ」ための安全網。
//
// 書き出し Electron（OSR / GPU）はフレームごとに親のパイプへ PROGRESS 行を書く。
// 書き出しを中止して親が殺されるとパイプの読み口が消え、次の write が EPIPE を
// 投げる。この例外を誰も受けないと Electron 既定の
// 「A JavaScript error occurred in the main process」モーダルが出て、モーダルな
// ので子プロセスは永久に終了しない（＝実測の「中止するとエラーが出続けて
// プロセスが残る」）。ここで一括して受け、ダイアログを出さずに終了する。
//
// 注意: electron-main の他のどの import よりも先に効かせたいので、
// electron-main.mjs の先頭で installParentPipeGuard(app) を呼ぶこと。

/** 親が消えた合図。異常ではないので黙って終わる。 */
export function isBrokenPipe(error) {
  const code = error?.code;
  return code === "EPIPE" || code === "ERR_STREAM_DESTROYED" || code === "ERR_STREAM_WRITE_AFTER_END";
}

export function installParentPipeGuard(app, { label = "export Electron" } = {}) {
  let exiting = false;
  const exitQuietly = (code) => {
    if (exiting) return;
    exiting = true;
    try { app.exit(code); }
    catch { process.exit(code); }
  };

  // EPIPE はストリームの 'error' として飛んでくる。リスナーが無いと
  // uncaughtException へ昇格する。付けたうえで「親が消えた」なら即終了する。
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (error) => { if (isBrokenPipe(error)) exitQuietly(1); });
  }

  // それでも漏れた例外・拒否はここで受ける。Electron の既定ダイアログには
  // 絶対に渡さない（モーダルで固まるとプロセスが残るため）。
  process.on("uncaughtException", (error) => {
    if (!isBrokenPipe(error)) {
      try { process.stderr.write(`${label} uncaught: ${String(error?.stack ?? error)}\n`); } catch { /* 親が居ない */ }
    }
    exitQuietly(1);
  });
  process.on("unhandledRejection", (reason) => {
    if (!isBrokenPipe(reason)) {
      try { process.stderr.write(`${label} unhandled rejection: ${String(reason?.stack ?? reason)}\n`); } catch { /* 親が居ない */ }
    }
    exitQuietly(1);
  });

  // 中止のシグナル（プロセスグループ宛の SIGTERM を含む）を受けたら終わる。
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(signal, () => exitQuietly(1));
  }

  return { exitQuietly };
}
