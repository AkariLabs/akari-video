export const FILLER_LEXICON = Object.freeze([
  "えー", "えーと", "えっと", "あー", "あの", "あのー", "その", "そのー",
  "まあ", "まぁ", "なんか", "うーん", "んー", "ええと",
]);

export const FILLER_PREFIX = new RegExp(`^[、,\\s]*(${[...FILLER_LEXICON].sort((a, b) => b.length - a.length).join("|")})[、,]*`, "u");
export const comparisonText = (text) => String(text ?? "").replace(/[、。！？,.!?\s]/gu, "");
export const isFiller = (text) => FILLER_LEXICON.includes(comparisonText(text));

const FILLERS_LONGEST_FIRST = [...FILLER_LEXICON].sort((a, b) => b.length - a.length);

export function findFillerSpans(text) {
  const original = String(text ?? "");
  const meaningful = [];
  const indices = [];
  // Keep UTF-16 offsets so the spans can be passed directly to text.slice().
  for (let index = 0; index < original.length; index += 1) {
    const char = comparisonText(original[index]);
    if (!char) continue;
    meaningful.push(char);
    indices.push(index);
  }
  const normalized = meaningful.join("");
  const spans = [];
  for (let index = 0; index < normalized.length;) {
    const filler = FILLERS_LONGEST_FIRST.find((word) => normalized.startsWith(word, index));
    if (filler) {
      const from = indices[index];
      let to = indices[index + filler.length - 1] + 1;
      while (to < original.length && /[、,]/u.test(original[to])) to += 1;
      spans.push({ from, to, filler });
    }
    index += filler?.length ?? 1;
  }
  return spans;
}

export function countFillerHits(text) { return findFillerSpans(text).length; }
