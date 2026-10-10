import captionDefaults from './caption-defaults.json' with { type: 'json' };

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

// Netflix English (USA) Timed Text Style Guide: 42 characters/line; 20 CPS adult, 17 CPS child.
// https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977-English-USA-Timed-Text-Style-Guide
// Netflix Subtitle Templates guide: 17 CPS adult template limit.
// https://partnerhelp.netflixstudios.com/hc/en-us/articles/219375728-Timed-Text-Style-Guide-Subtitle-Templates
// English portrait 24 characters is an AKARI screen-width adaptation; the 1 s floor preserves the previous value.
export function captionLanguageDefaults(language) {
  return captionDefaults[packLanguage(normalizeLanguage(language) ?? 'en', ['ja', 'en'])];
}
