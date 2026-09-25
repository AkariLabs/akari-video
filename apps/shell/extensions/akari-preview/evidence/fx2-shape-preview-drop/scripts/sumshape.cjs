// pvdrag の記録から図形の要約（中心 = transform + 寸法/2 と落とした点の差）を出す。使い方: node sumshape.cjs <rec.json>
const r = require(require('path').resolve(process.argv[2]));
const g = r.duringDrag?.dashed?.[0];
console.log(JSON.stringify({ ghost: g && { rect: g.rect, text: g.text }, times: r.duringDrag?.times?.map(t => t.text), editChanged: r.editChanged,
  drop: r.drop.outputPx, notices: r.notices,
  newItems: r.newItems.map(i => { const p = i.source?.params ?? {}; const c = i.transform && { x: i.transform.x + p.width / 2, y: i.transform.y + p.height / 2 };
    return { id: i.id, track: i.track, parent: i.parent, at: i.at, absAt: i.absAt, duration: i.duration, kind: i.source?.kind, shape: p.shape ?? p.preset, preset: p.preset, w: p.width, h: p.height, transform: i.transform, center: c,
      err: c && { x: +(c.x - r.drop.outputPx.x).toFixed(2), y: +(c.y - r.drop.outputPx.y).toFixed(2) } }; }),
  tracks: r.tracksAfter.map(t => t.id + ':' + t.items) }));
