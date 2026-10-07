const COMMAND_VARIANTS = [
  ['閉じて', '閉じてください'],
  ['もう1枚', 'もう1枚にして', 'もう1枚ください'],
  ['今の画面を敷いて', '今の画面を敷いてください'],
  ['ペン', 'ペンにして', 'ペンにしてください'],
  ['矢印', '矢印にして', '矢印にしてください'],
  ['文字', '文字にして', '文字にしてください'],
  ['選ぶ', '選んで', '選んでください'],
  ['選んだものを消して', '選んだものを消してください'],
  ['タスクにして', 'タスクにしてください'],
  ['送って', '送ってください']
];

export function normalizeCommand(text) {
  return String(text ?? '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '');
}

export const DEFAULT_LEXICON = Object.freeze(COMMAND_VARIANTS.flat());

export function classifyUtterance(text, { paperOpen, lexicon = DEFAULT_LEXICON } = {}) {
  if (!paperOpen) return 'speech';
  const normalized = normalizeCommand(text);
  if (!normalized || normalized.length > 12) return 'speech';
  const entries = Array.isArray(lexicon) ? lexicon : Object.values(lexicon).flat();
  return entries.some(entry => normalizeCommand(entry) === normalized) ? 'command' : 'speech';
}
