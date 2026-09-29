import { pathToFileURL } from 'node:url';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const [projectDir, modulePath] = process.argv.slice(2);
const { previewAudioSidecarKey } = await import(pathToFileURL(modulePath).href);
const dir = join(projectDir, '.akari', 'cache', 'preview-audio');
const files = readdirSync(dir);
const meta = files.filter(f => /^[0-9a-f]{40}\.json$/.test(f)).map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const edit = JSON.parse(readFileSync(join(projectDir, 'edit.json'), 'utf8'));
const sources = Object.fromEntries(edit.sources.map(s => [s.id, s.path]));
const bgm = edit.tracks.filter(t => t.lane === 'audio').flatMap(t => t.items).filter(i => i.role === 'bgm');
const out = [];
for (const m of meta.filter(x => x.format === 'pcm-s16le')) {
  const match = [];
  for (const item of bgm) {
    const rel = sources[item.source.src]; const abs = join(projectDir, rel); const st = statSync(abs);
    const key = previewAudioSidecarKey({ sourcePath: abs, size: st.size, mtimeMs: st.mtimeMs, inSec: item.source.in, outSec: m.outSec, speed: 1, format: 'pcm-s16le' });
    if (key === m.key) match.push({ item: item.id, source: rel, sourceBytes: st.size, sourceMtimeMs: st.mtimeMs });
  }
  out.push({ key: m.key, file: `${m.key}.pcm`, format: m.format, sampleRate: m.sampleRate, channels: m.channels, frames: m.frames, bytes: m.bytes, inSec: m.inSec, outSec: m.outSec, recipe: m.recipe,
    currentSourceVersion: match.length ? match : 'stale (source replaced; key no longer matches current size+mtime)' });
}
console.log(JSON.stringify(out.sort((a, b) => String(a.currentSourceVersion[0]?.item ?? 'z').localeCompare(String(b.currentSourceVersion[0]?.item ?? 'z'))), null, 1));
