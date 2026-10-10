import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveContentLanguage } from './index.mjs';

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * @param {string} projectRoot
 * @param {{ cliLang?: unknown }} [options]
 * @returns {Promise<{ language: string, source: 'cli' | 'intake' | 'transcript' | 'default' }>}
 */
export async function readContentLanguage(projectRoot, { cliLang } = {}) {
  const intake = await readJson(join(projectRoot, '.akari', 'intake.json'))
    ?? await readJson(join(projectRoot, 'intake.json'));
  const analysis = await readJson(join(projectRoot, 'analysis.json'));
  return resolveContentLanguage({ cliLang, intake, analysis });
}
