// ハードウェア H.264 エンコーダが使えなかったときの日本語 1 行（gpu 契約 §8.1 / osr 契約 §11.7 裁定 10）。
// 「どの GPU に載ったか・なぜ切り替えなかったか・次に何をするか」を 1 行・改行なしで伝え、末尾に元の英語エラーを添える。
// render-cut は `render-cut execution error: <この 1 行>` を stderr の最終行に出すので、shell のバナーはそのまま拾える。

export const HARDWARE_ENCODER_UNSUPPORTED_MARKER = "WebCodecs H.264 config is unsupported";
export const GPU_DIAGNOSTICS_MARKER = "AKARI_GPU_DIAGNOSTICS:";
const UNKNOWN_GPU = "不明な GPU";

export function describeHardwareEncoderFailure({ adapters = null, renderer = null, gpuPreference = null, cause = null } = {}) {
  const rendererName = rendererString(renderer);
  const preference = gpuPreference && typeof gpuPreference === "object" ? gpuPreference : {};
  let body;
  if (!adapters || typeof adapters !== "object") {
    // f. devices が取れなかった: renderer 文字列だけで e 相当
    body = `この GPU（${rendererName ?? UNKNOWN_GPU}）にはハードウェア H.264 エンコーダがありません。--engine osr で再実行してください（GPU 情報は取得できませんでした）`;
  } else if (!adapters.hybrid) {
    // e. hybrid でない
    body = `この GPU（${adapters.active_device ?? rendererName ?? UNKNOWN_GPU}）にはハードウェア H.264 エンコーダがありません。--engine osr で再実行してください`;
  } else if (adapters.active_is_high_performance) {
    // d. dGPU に載ったのに unsupported
    body = `高パフォーマンス GPU（${adapters.active_device ?? rendererName ?? UNKNOWN_GPU}）で動作していますがハードウェア H.264 エンコーダが応答しません。GPU ドライバの更新、または --engine osr で再実行してください`;
  } else {
    const activeDevice = adapters.active_device ?? rendererName ?? UNKNOWN_GPU;
    const prefix = `ハードウェア H.264 エンコーダが使えません。書き出しプロセスは内蔵 GPU（${activeDevice}）で動作しています。`;
    if (preference.reason === "user-preference-respected") {
      // a. 利用者が省電力に固定している
      body = `${prefix}Windows の「グラフィックスの設定」でこのアプリが省電力に固定されているため自動切り替えしませんでした。高パフォーマンスへ変更するか、AKARI_EXPORT_GPU_PREFERENCE=force（render-cut --gpu-preference force）で再実行してください`;
    } else if (preference.reason === "policy-off") {
      // b. 自動切替が off
      body = `${prefix}高パフォーマンス GPU（${adapters.high_performance_device ?? UNKNOWN_GPU}）への自動切り替えが off です。AKARI_EXPORT_GPU_PREFERENCE=auto で再実行してください`;
    } else if (preference.applied === true) {
      // c. 書いたのに iGPU
      body = `${prefix}GPU 設定（${preference.executable ?? "実行ファイル"}）を書き込みましたが反映されませんでした。Windows の「グラフィックスの設定」でこの実行ファイルを高パフォーマンスにしてください`;
    } else {
      // 判定表に無い理由（soft / already-high-performance / registry 不可 等）でも次の一手は同じ
      const reason = preference.reason ? `（${preference.reason}）` : "";
      body = `${prefix}自動切り替えは行われませんでした${reason}。Windows の「グラフィックスの設定」でこの実行ファイル${preference.executable ? `（${preference.executable}）` : ""}を高パフォーマンスにしてください`;
    }
  }
  const causeLine = firstLine(cause);
  return singleLine(causeLine ? `${body}（原因: ${causeLine}）` : body);
}

// run.json の error（stack 文字列）から元の英語エラー 1 行を取り出す（`Error: ` 接頭辞と診断 marker は外す）。
export function firstLine(text) {
  if (typeof text !== "string") return null;
  const line = stripGpuDiagnosticsMarker(text).split(/\r?\n/u, 1)[0].replace(/^Error:\s*/u, "").trim();
  return line === "" ? null : line;
}

// renderer 側は executeJavaScript の reject で main へ渡るとき Error の付随プロパティが落ちる（captionMeasureDiffs と同じ経路）ため、
// メッセージ末尾に marker + encodeURIComponent(JSON) を添える。main はプロパティ → marker の順で拾い、記録からは marker を外す。
export function extractGpuDiagnostics(error) {
  if (error?.gpuDiagnostics && typeof error.gpuDiagnostics === "object") return normalizeGpuDiagnostics(error.gpuDiagnostics);
  const message = String(error?.stack ?? error?.message ?? error ?? "");
  const start = message.indexOf(GPU_DIAGNOSTICS_MARKER);
  if (start < 0) return null;
  const encoded = message.slice(start + GPU_DIAGNOSTICS_MARKER.length).split(/\s/u, 1)[0];
  try { return normalizeGpuDiagnostics(JSON.parse(decodeURIComponent(encoded))); }
  catch { return null; }
}

export function stripGpuDiagnosticsMarker(text) {
  return String(text ?? "").replace(new RegExp(`\\s*${GPU_DIAGNOSTICS_MARKER}\\S*`, "gu"), "");
}

function normalizeGpuDiagnostics(value) {
  const renderer = value?.renderer && typeof value.renderer === "object"
    && typeof value.renderer.vendor === "string" && typeof value.renderer.renderer === "string"
    ? { vendor: value.renderer.vendor, renderer: value.renderer.renderer }
    : null;
  const support = value?.encoder_support && typeof value.encoder_support === "object"
    && typeof value.encoder_support["prefer-hardware"] === "boolean" && typeof value.encoder_support["prefer-software"] === "boolean"
    ? { "prefer-hardware": value.encoder_support["prefer-hardware"], "prefer-software": value.encoder_support["prefer-software"] }
    : null;
  return { renderer, encoder_support: support };
}

function rendererString(renderer) {
  if (typeof renderer === "string") return renderer.trim() === "" ? null : renderer.trim();
  if (renderer && typeof renderer === "object" && typeof renderer.renderer === "string" && renderer.renderer.trim() !== "") {
    return renderer.renderer.trim();
  }
  return null;
}

function singleLine(text) {
  return String(text).replace(/\s*[\r\n]+\s*/gu, " ").trim();
}
