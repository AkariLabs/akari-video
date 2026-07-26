// ビートの台本テキストを文単位に分割し、audio_query の pause_mora 列と突き合わせて
// 各文の開始秒（t0）を音声実測ベースで求める。
//
// 分割規則: 「。」「！」「？」（全角/半角）を文末とみなし、区切り文字は直前の文に含める。
// 「、」は文中のポーズとしてカウントするだけで文は割らない。
//
// タイミング解決規則（narration 実測ベース・決定論的）:
//   - 文 0 の t0 = beat.start + prePhonemeLength（音声先頭の無音を挟んだ最初の実音）
//   - 文 i (i>0) の t0 = 「直前の文の終端句読点までに現れた読点+句点の総数」番目の
//     pause_mora の終了時刻（= 次の mora の開始時刻）
//   - 文の t1 = 次の文の t0（テロップは次の文が来るまで保持表示される仕様。v3 の
//     captionAt() 実装と同じ「保持キャプション」方式）。最後の文の t1 = beat.end -
//     postPhonemeLength
//
// 注記（report.md に明記のうえ「意図的差分」として扱う）: v3 の timeline-v3.json に
// 保存されている文境界の秒数は、本ロジックの純計算値と厳密には一致しない（最大で
// 数百 ms のズレが確認できる箇所がある）。当時は司令塔がリアルタイムに手動調整した
// 値と推測され、決定論的に再現する記録が残っていない。本ツールは「決定論的かつ
// 音声実測から独立に再現可能」なことを優先し、上記の純フォノロジー規則を正本とする。

const SENTENCE_END_RE = /[。！？!?]/;
const PAUSE_RE = /[、。！？!?]/;

/**
 * @param {string} text ビートの全文
 * @returns {{ sentenceTexts: string[], boundaryPauseCounts: number[] }}
 *   boundaryPauseCounts[i] = sentenceTexts[i] の終端までに現れた「、+句点類」の累積個数
 */
export function splitSentenceTexts(text) {
  const sentenceTexts = [];
  const boundaryPauseCounts = [];
  let cur = "";
  let pauseCount = 0;
  for (const ch of text) {
    cur += ch;
    if (PAUSE_RE.test(ch)) {
      pauseCount += 1;
      if (SENTENCE_END_RE.test(ch)) {
        sentenceTexts.push(cur);
        boundaryPauseCounts.push(pauseCount);
        cur = "";
      }
    }
  }
  if (cur.trim().length) {
    // 終端句読点を持たない残りテキスト（想定外だが救済する）
    sentenceTexts.push(cur);
    boundaryPauseCounts.push(pauseCount);
  }
  return { sentenceTexts, boundaryPauseCounts };
}

/**
 * @param {Array} moras flattenMoras() の出力（mora.mjs）
 * @param {string} text ビート全文
 * @param {number} beatStart このビートの絶対開始秒
 * @param {number} beatEnd このビートの絶対終了秒（実wav長ベース）
 * @param {number} postPhonemeLength query.postPhonemeLength
 * @returns {Array<{text:string, t0:number, t1:number}>}
 */
export function resolveSentences(moras, text, beatStart, beatEnd, postPhonemeLength) {
  const { sentenceTexts, boundaryPauseCounts } = splitSentenceTexts(text);
  const pauses = moras.filter((m) => m.vowel === "pau");

  const t0s = [beatStart + moras[0].moraStart]; // sentence 0 は常に最初の実 mora から
  for (let i = 1; i < sentenceTexts.length; i += 1) {
    const pauseIdx = boundaryPauseCounts[i - 1] - 1; // 0-based
    const pause = pauses[pauseIdx];
    if (!pause) {
      throw new Error(
        `文境界 ${i} に対応する pause_mora が見つからない（pauseIdx=${pauseIdx}, 検出ポーズ数=${pauses.length}）。台本の句読点と VOICEVOX 出力のポーズ数が一致していない可能性がある。`,
      );
    }
    t0s.push(beatStart + pause.moraStart + pause.dur);
  }

  const round3 = (x) => Math.round(x * 1000) / 1000;
  const out = [];
  for (let i = 0; i < sentenceTexts.length; i += 1) {
    const t0 = round3(t0s[i]);
    const t1 = i < sentenceTexts.length - 1 ? round3(t0s[i + 1]) : round3(beatEnd - postPhonemeLength);
    out.push({ text: sentenceTexts[i], t0, t1 });
  }
  return out;
}
