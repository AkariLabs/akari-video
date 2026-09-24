import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { deriveLicenseAxes } from './license-axes.mjs';

function usedSourceIds(edit) {
  const ids = new Set();
  for (const cut of edit.cuts ?? []) if (typeof cut?.src === 'string') ids.add(cut.src);
  const visit = item => {
    if (typeof item?.source?.src === 'string') ids.add(item.source.src);
    for (const child of item?.items ?? []) visit(child);
  };
  for (const track of edit.tracks ?? []) for (const item of track.items ?? []) visit(item);
  return ids;
}

async function readMeta(path) {
  let text;
  try { text = await readFile(path, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, value: null };
    return { exists: true, value: null };
  }
  try { return { exists: true, value: JSON.parse(text) }; }
  catch { return { exists: true, value: null }; }
}

async function creditFor(dir, meta) {
  try {
    const line = (await readFile(`${dir}/CREDIT.txt`, 'utf8')).split(/\r?\n/u)[0].trim();
    if (line) return line;
  } catch { /* metadata fallback */ }
  const title = typeof meta?.title === 'string' && meta.title.trim() ? meta.title.trim() : basename(dir);
  const author = typeof meta?.author === 'string' && meta.author.trim() ? ` — ${meta.author.trim()}` : '';
  const spdx = typeof meta?.license?.spdx === 'string' && meta.license.spdx.trim()
    ? `（${meta.license.spdx.trim()}）` : '';
  return `${title}${author}${spdx}`;
}

/** One finding per distinct used asset and applicable question. */
export async function collectLicenseFindings(edit, resolveSource) {
  const findings = [];
  const seen = new Set();
  const used = usedSourceIds(edit);
  for (const source of edit.sources ?? []) {
    if (!used.has(source?.id) || typeof source?.path !== 'string') continue;
    const parts = source.path.replaceAll('\\', '/').split('/');
    if (parts.length < 4 || parts[0] !== 'assets' || parts.slice(1).some(part => !part || part === '.' || part === '..')) continue;
    const key = `${parts[1]}/${parts[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const file = resolveSource(source.path);
    let dir = dirname(file);
    for (let depth = 4; depth < parts.length; depth += 1) dir = dirname(dir);
    const metadata = await readMeta(`${dir}/meta.json`);
    if (!metadata.exists) continue;
    const meta = metadata.value;
    const axes = deriveLicenseAxes(meta?.license);
    const name = typeof meta?.title === 'string' && meta.title.trim() ? meta.title.trim() : parts[2];
    const detail = { asset: key, name, credit: axes.attributionRequired === true ? await creditFor(dir, meta) : '' };
    const path = `edit.json#sources.${source.id}`;
    if (axes.commercial === 'prohibited') findings.push({
      severity: 'warning', check: 'license.non-commercial', message: `${name}: 商用利用できない素材です`, path, details: detail,
    });
    if (axes.commercial === 'unknown') findings.push({
      severity: 'info', check: 'license.unknown', message: `${name}: ライセンスが分かりません`, path, details: detail,
    });
    if (axes.attributionRequired === true) findings.push({
      severity: 'info', check: 'license.attribution', message: `${name}: 帰属表示が必要です`, path, details: detail,
    });
  }
  return findings;
}
