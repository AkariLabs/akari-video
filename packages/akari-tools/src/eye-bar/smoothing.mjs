// smoothing.mjs — 決定論的な平滑化（移動平均 / One Euro）。引数固定で同一入力 → 同一出力。
// 呼び出し側（build-layer.mjs）が欠測（非検出フレーム）をホールドで埋めた「隙間なし」の
// 数値列を渡す前提（このモジュール自体は欠測を知らない — 平滑化と欠測処理の責務を分離する）。

/**
 * 角度列（度）を「連続な」列へ展開する（±180° 境界での急なジャンプを解消）。前の値との差が
 * 180° を超える分だけ 360° の倍数を足し引きする（numpy.unwrap と同じ考え方）。平滑化前に
 * 必ずこれを通す — でないと 179°→-179° のような瞬間移動を移動平均や One Euro が
 * 「速い動き」と誤認する。ffmpeg の rotate= は連続値をそのまま度→ラジアン変換して使えるため、
 * 展開後の値を巻き戻す必要はない。
 */
export function unwrapDegrees(values) {
  const out = [];
  let offset = 0;
  for (let i = 0; i < values.length; i += 1) {
    let value = values[i] + offset;
    if (i > 0) {
      const prev = out[i - 1];
      while (value - prev > 180) {
        offset -= 360;
        value -= 360;
      }
      while (value - prev < -180) {
        offset += 360;
        value += 360;
      }
    }
    out.push(value);
  }
  return out;
}

/**
 * 中心対称の移動平均。境界（列の先頭・末尾付近）は window をはみ出さない範囲で平均する
 * （折り返し・ゼロ埋めはしない — 存在する値だけの平均）。window は 1 以上の整数
 * （1 のときは恒等 = 平滑化なし）。
 */
export function movingAverage(values, window) {
  const w = Math.max(1, Math.floor(window));
  if (w <= 1) return values.slice();
  const half = Math.floor(w / 2);
  const out = new Array(values.length);
  for (let i = 0; i < values.length; i += 1) {
    const start = Math.max(0, i - half);
    const end = Math.min(values.length - 1, i + half);
    let sum = 0;
    for (let k = start; k <= end; k += 1) sum += values[k];
    out[i] = sum / (end - start + 1);
  }
  return out;
}

function lowPassFilter(value, previousFiltered, alpha) {
  return alpha * value + (1 - alpha) * previousFiltered;
}

function euroAlpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * One Euro フィルタ（Casiez et al. 2012）の標準形。times は昇順の秒。dt<=0（重複 t）の点は
 * 直前の平滑化値をそのまま持ち越す。minCutoff / beta / dCutoff は呼び出し側が固定値で渡す
 * （決定論のため乱数・時計依存の初期化は一切しない）。
 */
export function oneEuroFilter(values, times, { minCutoff = 1.0, beta = 0.0, dCutoff = 1.0 } = {}) {
  if (values.length === 0) return [];
  const out = [values[0]];
  let previousFiltered = values[0];
  let previousDerivative = 0;
  for (let i = 1; i < values.length; i += 1) {
    const dt = times[i] - times[i - 1];
    if (!(dt > 0)) {
      out.push(previousFiltered);
      continue;
    }
    const derivative = (values[i] - previousFiltered) / dt;
    const derivativeAlpha = euroAlpha(dCutoff, dt);
    const smoothedDerivative = lowPassFilter(derivative, previousDerivative, derivativeAlpha);
    const cutoff = minCutoff + beta * Math.abs(smoothedDerivative);
    const valueAlpha = euroAlpha(cutoff, dt);
    const filtered = lowPassFilter(values[i], previousFiltered, valueAlpha);
    out.push(filtered);
    previousFiltered = filtered;
    previousDerivative = smoothedDerivative;
  }
  return out;
}

/**
 * method: "moving-average" | "one-euro" | "none"。times は moving-average/none では未使用
 * （等間隔サンプル前提のため window は「サンプル数」で表す）だが、呼び出し側の型を揃えるため
 * 常に受け取る。
 */
export function smoothSeries(values, times, options) {
  const method = options?.method ?? "moving-average";
  if (method === "none") return values.slice();
  if (method === "one-euro") {
    return oneEuroFilter(values, times, options?.oneEuro);
  }
  return movingAverage(values, options?.window ?? 5);
}
