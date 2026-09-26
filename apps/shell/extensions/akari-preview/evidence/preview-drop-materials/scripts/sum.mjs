// drag.mjs の記録を 1 行に要約（落とした点と置かれたものの中心の差も）: node sum.mjs <rec.json>...
import { readFileSync } from 'node:fs';
for (const file of process.argv.slice(2)) {
  const r = JSON.parse(readFileSync(file, 'utf8'));
  const out = { file: file.split('/').pop(), card: r.cardSpec, drop: r.dropSpec, layer: r.layerSeenDuringDrag, dropOnLayer: r.dropReachedLayer,
    ghost: r.duringDrag?.ghost?.map(g => g.text), commands: r.commands?.map(c => c.id), edit: r.editChanged, captions: r.captionsChanged, notices: r.notices,
    expect: r.drop?.clampedOutputPx && { x: +r.drop.clampedOutputPx.x.toFixed(2), y: +r.drop.clampedOutputPx.y.toFixed(2) } };
  const out2 = r.stage?.output;
  out.items = (r.newItems || []).map(i => {
    const o = { id: i.id, track: i.track, at: i.at, duration: i.duration };
    if (i.transform && out2) {
      const w = i.source?.params?.width, h = i.source?.params?.height;
      const c = w && h ? { x: i.transform.x + w / 2, y: i.transform.y + h / 2 } : { x: i.transform.x + out2.width / 2, y: i.transform.y + out2.height / 2 };
      o.center = { x: +c.x.toFixed(2), y: +c.y.toFixed(2) };
      if (out.expect) o.err = { x: +(c.x - out.expect.x).toFixed(2), y: +(c.y - out.expect.y).toFixed(2) };
      if (i.transform.scale) o.scale = +i.transform.scale.toFixed(4);
    }
    return o;
  });
  out.newCaptions = (r.newCaptions || []).map(c => ({ id: c.id, start: c.start, end: c.end, style_preset: c.style_preset, x: c.x ?? c.position?.x, y: c.y ?? c.position?.y, anchor: c.text_anchor }));
  const before = r.audioBefore?.sfx?.length ?? 0; const after = r.audioAfter?.sfx ?? [];
  if (after.length > before) out.newSfx = after.slice(before).map(s => ({ id: s.id, path: s.path, t: s.t }));
  if (r.newSources?.length) out.newSources = r.newSources.map(s => s.path);
  console.log(JSON.stringify(out));
}
