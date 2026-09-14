import { clampAdjacentSegments, detectSpeechChunks, fitWordsIntoWindow, snapSegmentsToWords, snapWordsToSpeech } from "../media/speech-align.mjs";

export function retimeCaptionsToSpeech(captions, { silences, duration, source } = {}) {
  const rows = Array.isArray(captions) ? captions : [];
  const selected = rows.filter((row) => (!source || row.src === undefined || row.src === source)
    && row.time_domain !== "output" && Array.isArray(row.words) && row.words.length)
    .toSorted((left, right) => left.start - right.start);
  const chunks = detectSpeechChunks({ silences, duration });
  const flatWords = selected.flatMap((row) => row.words);
  const snapped = snapWordsToSpeech(flatWords, chunks);
  let offset = 0;
  let fittedWords = 0;
  const aligned = [];
  for (const row of selected) {
    const words = snapped.words.slice(offset, offset + row.words.length);
    offset += row.words.length;
    const [withBounds] = snapSegmentsToWords([{ ...row, words }]);
    if (row.edited === true) {
      const fitted = fitWordsIntoWindow(withBounds.words, { start: row.start, end: row.end });
      fittedWords += fitted.fitted;
      aligned.push({ ...withBounds, words: fitted.words, start: row.start, end: row.end, fixed: true });
    } else aligned.push({ ...withBounds, fixed: false });
  }
  const clamped = clampAdjacentSegments(aligned);
  const replacements = new Map(selected.map((row, index) => {
    const { fixed: _fixed, ...replacement } = clamped.segments[index];
    return [row, replacement];
  }));
  return {
    captions: rows.map((row) => replacements.get(row) ?? row),
    moved: snapped.moved,
    total: snapped.total,
    fitted_words: fittedWords,
    clamped_pairs: clamped.clamped_pairs,
    overlaps_left: clamped.overlaps_left,
  };
}
