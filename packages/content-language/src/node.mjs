import { readFile, readdir } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeLanguage, resolveContentLanguage } from './index.mjs';

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function readJsonSync(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function transcriptLength(analysis) {
  return Array.isArray(analysis?.transcript)
    ? analysis.transcript.reduce((length, segment) => length + (typeof segment?.text === 'string' ? segment.text.length : 0), 0)
    : 0;
}

function longestTranscript(analyses) {
  let selected = null;
  let longest = -1;
  for (const analysis of analyses) {
    if (!normalizeLanguage(analysis?.transcript_language)) continue;
    const length = transcriptLength(analysis);
    if (length > longest) {
      selected = analysis;
      longest = length;
    }
  }
  return selected;
}

async function sidecarFiles(directory) {
  const files = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (!entry.isDirectory()) continue;
      const child = join(current, entry.name);
      if (entry.name.endsWith('.analysis')) files.push(join(child, 'analysis.json'));
      else await walk(child);
    }
  }
  await walk(directory);
  return files;
}

function sidecarFilesSync(directory) {
  const files = [];
  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
      if (!entry.isDirectory()) continue;
      const child = join(current, entry.name);
      if (entry.name.endsWith('.analysis')) files.push(join(child, 'analysis.json'));
      else walk(child);
    }
  }
  walk(directory);
  return files;
}

/**
 * @param {string} projectRoot
 * @param {{ cliLang?: unknown }} [options]
 * @returns {Promise<{ language: string, source: 'cli' | 'intake' | 'transcript' | 'default' }>}
 */
export async function readContentLanguage(projectRoot, { cliLang } = {}) {
  const intake = await readJson(join(projectRoot, '.akari', 'intake.json'))
    ?? await readJson(join(projectRoot, 'intake.json'));
  const files = [join(projectRoot, 'analysis.json'), ...await sidecarFiles(join(projectRoot, '.akari', 'sidecars', 'assets'))];
  const analysis = longestTranscript(await Promise.all(files.map(readJson)));
  return resolveContentLanguage({ cliLang, intake, analysis });
}

/** Synchronous counterpart for deterministic lint functions. */
export function readContentLanguageSync(projectRoot, { cliLang } = {}) {
  const intake = readJsonSync(join(projectRoot, '.akari', 'intake.json'))
    ?? readJsonSync(join(projectRoot, 'intake.json'));
  const files = [join(projectRoot, 'analysis.json'), ...sidecarFilesSync(join(projectRoot, '.akari', 'sidecars', 'assets'))];
  const analysis = longestTranscript(files.map(readJsonSync));
  return resolveContentLanguage({ cliLang, intake, analysis });
}
