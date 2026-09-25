// pvdrag の結果 JSON の要点だけを出す: node sum.mjs <json>
import { readFileSync } from 'node:fs';
const r = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify({ payload: r.payload, drop: r.drop, duringDrag: { layer: r.duringDrag?.layer?.length, dashed: r.duringDrag?.dashed, times: r.duringDrag?.times, svgs: r.duringDrag?.svgs, timelineGhost: r.duringDrag?.timelineGhost }, afterDropLayer: r.afterDrop?.layer?.length, newItems: r.newItems, newCaptions: r.newCaptions, audioAfter: r.audioAfter, newSources: r.newSources, tracksAfter: r.tracksAfter, notices: r.notices }, null, 1));
