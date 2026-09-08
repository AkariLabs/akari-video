export const FILLER_LEXICON = Object.freeze([
  "えー", "えーと", "えっと", "あー", "あの", "あのー", "その", "そのー",
  "まあ", "まぁ", "なんか", "うーん", "んー", "ええと",
]);

export const FILLER_PREFIX = new RegExp(`^[、,\\s]*(${[...FILLER_LEXICON].sort((a, b) => b.length - a.length).join("|")})[、,]*`, "u");
export const comparisonText = (text) => String(text ?? "").replace(/[、。！？,.!?\s]/gu, "");
export const isFiller = (text) => FILLER_LEXICON.includes(comparisonText(text));

const FILLERS_LONGEST_FIRST = [...FILLER_LEXICON].sort((a, b) => b.length - a.length);

export function countFillerHits(text) {
  const normalized = comparisonText(text);
  let hits = 0;
  for (let index = 0; index < normalized.length;) {
    const filler = FILLERS_LONGEST_FIRST.find((word) => normalized.startsWith(word, index));
    if (filler) hits += 1;
    index += filler?.length ?? 1;
  }
  return hits;
}
