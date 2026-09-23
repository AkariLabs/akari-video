import { appendFile, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveAkariHome } from './env.mjs';

export function usagePath(env = process.env) {
  return path.join(resolveAkariHome(env), 'library-usage.jsonl');
}

export async function appendLibraryUsage({ category, id, project }, env = process.env) {
  if (![category, id].every(value => typeof value === 'string' && value && !/[\\/]/.test(value))) {
    throw new TypeError('素材の種類・名前が不正です');
  }
  const entry = { at: new Date().toISOString(), category, id, project: await realpath(project) };
  const target = usagePath(env);
  await mkdir(path.dirname(target), { recursive: true });
  await appendFile(target, `${JSON.stringify(entry)}\n`, 'utf8');
  return entry;
}

export function aggregateLibraryUsage(lines, isProject = () => true) {
  const result = {};
  for (const line of typeof lines === 'string' ? lines.split(/\r?\n/) : lines) {
    let row;
    try { row = typeof line === 'string' ? JSON.parse(line) : line; } catch { continue; }
    if (!row || typeof row !== 'object' || typeof row.category !== 'string' || !row.category
      || /[\\/]/.test(row.category) || typeof row.id !== 'string' || !row.id || /[\\/]/.test(row.id)
      || typeof row.project !== 'string'
      || !path.isAbsolute(row.project) || typeof row.at !== 'string' || !Number.isFinite(Date.parse(row.at))
      || !isProject(row.project)) continue;
    const key = `${row.category}/${row.id}`;
    const value = result[key] ??= { count: 0, lastUsedAt: '', projects: [] };
    value.count++;
    if (row.at > value.lastUsedAt) value.lastUsedAt = row.at;
    if (!value.projects.includes(row.project)) value.projects.push(row.project);
  }
  for (const value of Object.values(result)) value.projects.sort();
  return result;
}

export async function readLibraryUsage(env = process.env) {
  let lines = '';
  try { lines = await readFile(usagePath(env), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const projects = new Set();
  for (const line of lines.split(/\r?\n/)) {
    try {
      const project = JSON.parse(line)?.project;
      if (typeof project === 'string' && path.isAbsolute(project)) projects.add(project);
    } catch { /* invalid journal line */ }
  }
  const existing = new Set();
  await Promise.all([...projects].map(async project => {
    try { if ((await stat(project)).isDirectory()) existing.add(project); } catch { /* removed project */ }
  }));
  return aggregateLibraryUsage(lines, project => existing.has(project));
}
