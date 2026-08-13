const BASE_TABLE = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "a", き: "i", く: "u", け: "e", こ: "o",
  が: "a", ぎ: "i", ぐ: "u", げ: "e", ご: "o",
  さ: "a", し: "i", す: "u", せ: "e", そ: "o",
  ざ: "a", じ: "i", ず: "u", ぜ: "e", ぞ: "o",
  た: "a", ち: "i", つ: "u", て: "e", と: "o",
  だ: "a", ぢ: "i", づ: "u", で: "e", ど: "o",
  な: "a", に: "i", ぬ: "u", ね: "e", の: "o",
  は: "a", ひ: "i", ふ: "u", へ: "e", ほ: "o",
  ば: "a", び: "i", ぶ: "u", べ: "e", ぼ: "o",
  ぱ: "a", ぴ: "i", ぷ: "u", ぺ: "e", ぽ: "o",
  ま: "a", み: "i", む: "u", め: "e", も: "o",
  や: "a", ゆ: "u", よ: "o",
  ら: "a", り: "i", る: "u", れ: "e", ろ: "o",
  わ: "a", ゐ: "i", ゑ: "e", を: "o", ゔ: "u",
  ア: "a", イ: "i", ウ: "u", エ: "e", オ: "o",
  カ: "a", キ: "i", ク: "u", ケ: "e", コ: "o",
  ガ: "a", ギ: "i", グ: "u", ゲ: "e", ゴ: "o",
  サ: "a", シ: "i", ス: "u", セ: "e", ソ: "o",
  ザ: "a", ジ: "i", ズ: "u", ゼ: "e", ゾ: "o",
  タ: "a", チ: "i", ツ: "u", テ: "e", ト: "o",
  ダ: "a", ヂ: "i", ヅ: "u", デ: "e", ド: "o",
  ナ: "a", ニ: "i", ヌ: "u", ネ: "e", ノ: "o",
  ハ: "a", ヒ: "i", フ: "u", ヘ: "e", ホ: "o",
  バ: "a", ビ: "i", ブ: "u", ベ: "e", ボ: "o",
  パ: "a", ピ: "i", プ: "u", ペ: "e", ポ: "o",
  マ: "a", ミ: "i", ム: "u", メ: "e", モ: "o",
  ヤ: "a", ユ: "u", ヨ: "o",
  ラ: "a", リ: "i", ル: "u", レ: "e", ロ: "o",
  ワ: "a", ヲ: "o", ヴ: "u",
};

const SMALL_VOWELS = {
  ゃ: "a", ゅ: "u", ょ: "o", ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ャ: "a", ュ: "u", ョ: "o", ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o",
};

function romajiMorae(word) {
  const w = word.toLowerCase();
  const isVowel = (character) => "aiueo".includes(character);
  const moras = [];
  let index = 0;
  while (index < w.length) {
    const character = w[index];
    if (isVowel(character)) { moras.push(character); index += 1; continue; }
    if (character === "n") {
      if (index + 1 < w.length && isVowel(w[index + 1])) {
        moras.push(w[index + 1]); index += 2; continue;
      }
      moras.push("closed"); index += 1; continue;
    }
    if (index + 1 < w.length && w[index + 1] === character) {
      moras.push("closed"); index += 1; continue;
    }
    if (index + 1 < w.length && isVowel(w[index + 1])) {
      moras.push(w[index + 1]); index += 2; continue;
    }
    let next = index + 1;
    while (next < w.length && !isVowel(w[next]) && w[next] !== "n" && w[next] !== w[index]) next += 1;
    if (next < w.length && isVowel(w[next])) {
      moras.push(w[next]); index = next + 1; continue;
    }
    return null;
  }
  return moras;
}

export function moraeForWord(text) {
  const word = String(text ?? "").trim();
  if (word === "") return null;
  if (/^[A-Za-z]+$/.test(word)) return romajiMorae(word);
  if (!/^[ぁ-ゖァ-ヺー]+$/.test(word)) return null;

  const chars = Array.from(word);
  const moras = [];
  let index = 0;
  while (index < chars.length) {
    const character = chars[index];
    if (character === "ん" || character === "ン" || character === "っ" || character === "ッ") {
      moras.push("closed"); index += 1; continue;
    }
    if (character === "ー") {
      moras.push(moras.length > 0 ? moras.at(-1) : "closed"); index += 1; continue;
    }
    if (SMALL_VOWELS[character]) {
      moras.push(SMALL_VOWELS[character]); index += 1; continue;
    }
    if (!BASE_TABLE[character]) return null;
    if (index + 1 < chars.length && SMALL_VOWELS[chars[index + 1]]) {
      moras.push(SMALL_VOWELS[chars[index + 1]]); index += 2; continue;
    }
    moras.push(BASE_TABLE[character]); index += 1;
  }
  return moras;
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeWord(value, label) {
  if (!record(value)) throw new Error(`${label} は object である必要があります`);
  if (typeof value.text !== "string") throw new Error(`${label}.text は文字列である必要があります`);
  if (!Number.isFinite(value.start) || !Number.isFinite(value.end)) {
    throw new Error(`${label}.start / end は有限の秒数である必要があります`);
  }
  if (value.end <= value.start) throw new Error(`${label}.end は start より大きい必要があります`);
  return { start: value.start, end: value.end, text: value.text };
}

export function parseTranscript(parsedJson) {
  let entries;
  let captionsRoot = false;
  if (Array.isArray(parsedJson)) entries = parsedJson;
  else if (record(parsedJson) && Array.isArray(parsedJson.captions)) {
    entries = parsedJson.captions;
    captionsRoot = true;
  }
  else throw new Error("transcript は配列または captions 配列を持つ object である必要があります");

  const captionsFormat = captionsRoot || entries.some((entry) => (
    record(entry) && Object.prototype.hasOwnProperty.call(entry, "words")
  ));
  const words = [];
  if (captionsFormat) {
    entries.forEach((caption, captionIndex) => {
      if (!record(caption)) throw new Error(`captions[${captionIndex}] は object である必要があります`);
      if (caption.words === undefined) return;
      if (!Array.isArray(caption.words)) throw new Error(`captions[${captionIndex}].words は配列である必要があります`);
      caption.words.forEach((word, wordIndex) => {
        words.push(normalizeWord(word, `captions[${captionIndex}].words[${wordIndex}]`));
      });
    });
  } else {
    entries.forEach((word, index) => words.push(normalizeWord(word, `words[${index}]`)));
  }
  return words.map((word, index) => ({ word, index }))
    .sort((left, right) => left.word.start - right.word.start || left.index - right.index)
    .map(({ word }) => word);
}

export function buildVowelTimeline({ words, frameCount, fps }) {
  const timeline = Array(frameCount).fill(null);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / fps;
    const word = words.find((candidate) => candidate.start <= time && time < candidate.end);
    if (!word) continue;
    const moras = moraeForWord(word.text);
    const duration = word.end - word.start;
    if (moras === null || moras.length === 0 || duration <= 0) continue;
    const localTime = time - word.start;
    const moraIndex = Math.min(moras.length - 1, Math.max(0, Math.floor((localTime / duration) * moras.length)));
    timeline[frame] = moras[moraIndex];
  }
  return timeline;
}

export function resolveMouthStates({ vowelTimeline, volumeStates }) {
  if (vowelTimeline.length !== volumeStates.length) throw new Error("母音列と音量状態列の長さが一致しません");
  return volumeStates.map((volumeState, frame) => {
    if (volumeState === "closed") return "closed";
    return vowelTimeline[frame] ?? "a";
  });
}
