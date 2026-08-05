import { readFile } from 'node:fs/promises';

import { TEMPO_VOCABULARY, TONE_VOCABULARY } from './bgm-suggest.mjs';

function tableCells(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
    return null;
  }

  const cells = [];
  let cell = '';
  for (let i = 1; i < trimmed.length - 1; i += 1) {
    const char = trimmed[i];
    if (char === '\\' && i + 1 < trimmed.length - 1) {
      cell += char + trimmed[++i];
      continue;
    }
    if (char === '|') {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

/** decision-log.md の最新の (direction, tone) 行から機械可読の方針を読む。 */
export async function readToneDecision(filePath) {
  let markdown;
  try {
    markdown = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`decision-log ファイルが見つかりません: ${filePath}`);
    }
    throw new Error(`decision-log を読めません: ${filePath}（${error.message}）`);
  }

  let columns = null;
  let latest = null;
  for (const line of markdown.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (!cells) continue;

    const category = cells.indexOf('category');
    const subject = cells.indexOf('subject');
    const decision = cells.indexOf('決定');
    if (category >= 0 && subject >= 0 && decision >= 0) {
      columns = { category, subject, decision };
      continue;
    }
    if (
      columns
      && cells[columns.category] === 'direction'
      && cells[columns.subject] === 'tone'
    ) {
      latest = { line, decision: cells[columns.decision] ?? '' };
    }
  }

  if (!latest) {
    throw new Error('decision-log に (direction, tone) の方針行が見つかりません');
  }

  const code = /^`([^`]*)`(?:\s|$)/.exec(latest.decision.trim());
  if (!code) {
    throw new Error('decision-log の (direction, tone) 行で、決定セル先頭の tone JSON が見つかりません');
  }

  let value;
  try {
    value = JSON.parse(code[1]);
  } catch (error) {
    throw new Error(`decision-log の (direction, tone) 行の tone JSON が壊れています（${error.message}）`);
  }

  if (!value || !Array.isArray(value.tone) || value.tone.length === 0 || value.tone.some((tone) => typeof tone !== 'string')) {
    throw new Error('decision-log の tone JSON の形式が不正です（tone は 1 個以上の文字列配列で指定してください）');
  }
  const invalidTones = value.tone.filter((tone) => !TONE_VOCABULARY.includes(tone));
  if (invalidTones.length > 0) {
    throw new Error(`decision-log の tone が語彙外です: ${invalidTones.join(' / ')}（使える値: ${TONE_VOCABULARY.join(' / ')}）`);
  }

  const hasTempo = Object.hasOwn(value, 'tempo');
  if (hasTempo && (typeof value.tempo !== 'string' || !TEMPO_VOCABULARY.includes(value.tempo))) {
    throw new Error(`decision-log の tempo が語彙外です: ${String(value.tempo)}（使える値: ${TEMPO_VOCABULARY.join(' / ')}）`);
  }

  return { tones: value.tone, tempo: hasTempo ? value.tempo : null, line: latest.line };
}
