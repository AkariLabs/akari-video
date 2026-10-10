const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

/** @param {unknown} tag @returns {string | null} Lowercase primary language or null. */
export function normalizeLanguage(tag) {
  if (typeof tag !== 'string' || !LANGUAGE_TAG.test(tag)) return null;
  return tag.split('-', 1)[0].toLowerCase();
}

/**
 * @param {{ cliLang?: unknown, intake?: { language?: unknown } | null, analysis?: { transcript_language?: unknown } | null }} [input]
 * @returns {{ language: string, source: 'cli' | 'intake' | 'transcript' | 'default' }}
 */
export function resolveContentLanguage({ cliLang, intake, analysis } = {}) {
  const candidates = [
    ['cli', cliLang],
    ['intake', intake?.language],
    ['transcript', analysis?.transcript_language],
  ];
  for (const [source, tag] of candidates) {
    const language = normalizeLanguage(tag);
    if (language) return { language, source };
  }
  return { language: 'ja', source: 'default' };
}

/** @param {string} language @param {string[]} available @returns {string | undefined} */
export function packLanguage(language, available) {
  if (available.includes(language)) return language;
  if (language === 'ja') return 'ja';
  return available.includes('en') ? 'en' : available[0];
}
