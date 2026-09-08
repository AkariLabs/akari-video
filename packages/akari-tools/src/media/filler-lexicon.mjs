export const FILLER_LEXICON = Object.freeze([
  "えー", "えーと", "えっと", "あー", "あの", "あのー", "その", "そのー",
  "まあ", "まぁ", "なんか", "うーん", "んー", "ええと",
]);

export const FILLER_PREFIX = new RegExp(`^[、,\\s]*(${[...FILLER_LEXICON].sort((a, b) => b.length - a.length).join("|")})[、,]*`, "u");
export const comparisonText = (text) => String(text ?? "").replace(/[、。！？,.!?\s]/gu, "");
export const isFiller = (text) => FILLER_LEXICON.includes(comparisonText(text));
