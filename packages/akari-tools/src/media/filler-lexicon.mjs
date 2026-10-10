import { packLanguage } from "../../../content-language/src/index.mjs";

export const FILLER_LEXICON = Object.freeze([
  "えー", "えーと", "えっと", "あー", "あの", "あのー", "その", "そのー",
  "まあ", "まぁ", "なんか", "うーん", "んー", "ええと",
]);
export const FILLER_PACKS = Object.freeze({
  ja: FILLER_LEXICON,
  en: Object.freeze([
    ...["um", "uh", "erm", "uhm", "hmm"].map((text) => Object.freeze({ text, confidence: "high" })),
    ...["like", "you know", "I mean", "sort of", "kind of"].map((text) => Object.freeze({ text, confidence: "low" })),
  ]),
});
export const fillerPackLanguage = (language) => packLanguage(language, Object.keys(FILLER_PACKS));

export const FILLER_PREFIX = new RegExp(`^[、,\\s]*(${[...FILLER_LEXICON].sort((a, b) => b.length - a.length).join("|")})[、,]*`, "u");
export const comparisonText = (text) => String(text ?? "").replace(/[、。！？,.!?\s]/gu, "");
export const isFiller = (text, language = "ja") => fillerPackLanguage(language) === "ja"
  ? FILLER_LEXICON.includes(comparisonText(text))
  : findFillerSpans(text, language).some((span) => String(text).slice(span.from, span.to).trim().length === String(text).trim().length);

const FILLERS_LONGEST_FIRST = [...FILLER_LEXICON].sort((a, b) => b.length - a.length);

export function findFillerSpans(text, language = "ja") {
  if (fillerPackLanguage(language) === "en") return findEnglishFillerSpans(text);
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

function findEnglishFillerSpans(text) {
  const original = String(text ?? "");
  const result = [];
  for (const { text: phrase, confidence } of FILLER_PACKS.en) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu");
    for (const match of original.matchAll(pattern)) {
      result.push({ from: match.index, to: match.index + match[0].length, filler: phrase, confidence });
    }
  }
  return result.sort((a, b) => a.from - b.from || b.to - a.to).filter((span, index, spans) => !spans.slice(0, index).some((prior) => prior.to > span.from));
}

export function countFillerHits(text, language = "ja") { return findFillerSpans(text, language).length; }
