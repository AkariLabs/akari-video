// public/app.js から逐語移動。描画に依存しない整形・署名関数（F-69）。

export async function editSaveErrorMessage(res) {
  try {
    const body = await res.json();
    if (Array.isArray(body.findings) && body.findings.length) {
      // warning が先頭に混ざると真因が埋もれる — error のみ表示（P2-5）。
      // error が無い異常応答では従来どおり全 findings にフォールバック
      const errors = body.findings.filter((f) => f.severity === 'error');
      const shown = errors.length ? errors : body.findings;
      return shown.map((f) => f.message || f.check).filter(Boolean).join(' / ');
    }
    return body.error || `保存に失敗しました (HTTP ${res.status})`;
  } catch {
    return `保存に失敗しました (HTTP ${res.status})`;
  }
}

export function resolveMediaUrl(pathOrSrc) {
  if (!pathOrSrc) return null;
  if (/^(https?:|blob:)/.test(pathOrSrc)) return pathOrSrc;
  return `/${String(pathOrSrc).replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`;
}

// 断片の「顔ぶれ」— これが変わらない限り DOM は作り直さない（位置や見た目の変更は貼り直しで足りる）
export function overlaySignature(s) {
  return JSON.stringify((s?.overlays || []).map(o => [String(o.id), o.html, o.start, o.duration]));
}

export function fmtRange(sec) {
  const m = Math.floor(sec / 60), s2 = (sec % 60).toFixed(1).padStart(4, '0');
  return `${m}:${s2}`;
}

export async function apiReadError(response, label) {
  try {
    const body = await response.json();
    if (body?.error) return body.error;
  } catch {}
  return `${label}: HTTP ${response.status}`;
}

// 辺あたり倍率。座標・時刻・ツマミ値は等倍の書き出しと共有する。
export function normalizeVgpuPreviewScale(value) {
  return value === 1 || value === 0.5 || value === 0.25 ? value : 0.5;
}
