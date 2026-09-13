import { detectSpeechChunks, snapSegmentsToWords, snapWordsToSpeech } from "../media/speech-align.mjs";

export function retimeCaptionsToSpeech(captions, { silences, duration, source } = {}) {
  const rows = Array.isArray(captions) ? captions : [];
  const selected = rows.filter((row) => (!source || row.src === undefined || row.src === source)
    && row.time_domain !== "output" && Array.isArray(row.words) && row.words.length);
  const chunks = detectSpeechChunks({ silences, duration });
  const flatWords = selected.flatMap((row) => row.words);
  const snapped = snapWordsToSpeech(flatWords, chunks);
  let offset = 0;
  const replacements = new Map();
  for (const row of selected) {
    const words = snapped.words.slice(offset, offset + row.words.length);
    offset += row.words.length;
    const [withBounds] = snapSegmentsToWords([{ ...row, words }]);
    replacements.set(row, row.edited === true
      ? { ...withBounds, start: row.start, end: row.end }
      : withBounds);
  }
  return {
    captions: rows.map((row) => replacements.get(row) ?? row),
    moved: snapped.moved,
    total: snapped.total,
  };
}
