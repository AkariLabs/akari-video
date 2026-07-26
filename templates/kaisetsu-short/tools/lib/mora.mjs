// VOICEVOX audio_query -> フラットな mora 列（累積タイミング付き）に変換する共有ライブラリ。
//
// リバースエンジニアリング結果（原型実制作の golden 検証で確定・内部リポに記録）:
//   - 各 mora の開始時刻 (mora_start) は prePhonemeLength を起点に
//     consonant_length + vowel_length を累積して求める（speedScale=1.0 前提）。
//   - accent_phrase の pause_mora（"、"や"。"のポーズ）も同列の1 mora として扱う
//     （vowel="pau"）。
//   - mora_start は「そのビートの音声先頭からの秒数」に一致する
//     （= beat.start に加算するとグローバル絶対秒になる）。
//
// この mora_start が timeline-v3.json の mouth / sentences の起点と厳密一致することを
// 実データ（narration-v2/*.query.json vs work/timeline-v3.json）で検証済み（mouth は
// 903/903 完全一致）。

/**
 * @param {object} query VOICEVOX /audio_query のレスポンス JSON
 * @returns {{ moras: Array<{text:string, vowel:string, consonant:string|null, moraStart:number, dur:number}>, totalDuration: number }}
 */
export function flattenMoras(query) {
  const moras = [];
  let t = query.prePhonemeLength || 0;
  for (const ap of query.accent_phrases) {
    for (const mo of ap.moras) {
      const clen = mo.consonant_length != null ? mo.consonant_length : 0;
      const vlen = mo.vowel_length;
      moras.push({ text: mo.text, vowel: mo.vowel, consonant: mo.consonant, moraStart: t, dur: clen + vlen });
      t += clen + vlen;
    }
    if (ap.pause_mora) {
      const vlen = ap.pause_mora.vowel_length;
      moras.push({ text: ap.pause_mora.text, vowel: ap.pause_mora.vowel, consonant: null, moraStart: t, dur: vlen });
      t += vlen;
    }
  }
  const totalDuration = t + (query.postPhonemeLength || 0);
  return { moras, totalDuration };
}

// 母音種別 -> 口形状の対応（golden timeline-v3.json との突き合わせで確定。全 903 keys 一致）。
//   a/o/e -> open（大きく開く母音）
//   i/u/I/U（大文字は無声化）-> half（狭母音・半開き）
//   N（撥音「ん」）/ pau（無音・ポーズ）/ cl（促音「っ」の声門閉鎖）-> closed
export const VOWEL_TO_MOUTH_STATE = {
  a: "open", o: "open", e: "open",
  i: "half", u: "half", I: "half", U: "half",
  N: "closed", pau: "closed", cl: "closed",
};

export function mouthStateForVowel(vowel) {
  const st = VOWEL_TO_MOUTH_STATE[vowel];
  if (!st) throw new Error(`未知の母音種別: ${vowel}（VOWEL_TO_MOUTH_STATE に追加が必要）`);
  return st;
}

/**
 * ビート内の neutral 表情区間（複数可）に含まれる mora だけを対象に、口形状キーフレームを
 * 生成する。非 neutral 表情中はアバターが静止画（表情固定）になるため口パクは描画されず、
 * golden データでもその区間の mora は一切キーフレーム化されていない（beat-relative time で
 * フィルタする）。
 *
 * @param {Array} moras flattenMoras() の出力
 * @param {Array<{t0:number, t1:number}>} neutralWindowsRel beat開始からの相対秒 [t0,t1)
 * @param {number} beatStart このビートの絶対開始秒（グローバルタイムラインオフセット）
 * @returns {Array<{t:number, state:string}>} 絶対秒でソート済みのキーフレーム列
 */
export function mouthKeyframesForBeat(moras, neutralWindowsRel, beatStart) {
  const inWindow = (t) => neutralWindowsRel.some((w) => t >= w.t0 && t < w.t1);
  const out = [];
  for (const m of moras) {
    if (!inWindow(m.moraStart)) continue;
    out.push({ t: round3(beatStart + m.moraStart), state: mouthStateForVowel(m.vowel) });
  }
  return out;
}

export function round3(x) {
  return Math.round(x * 1000) / 1000;
}
