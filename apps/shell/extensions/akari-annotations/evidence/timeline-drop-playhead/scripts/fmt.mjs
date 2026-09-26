// batch.sh の出力（1 行 = 名前 + 要約 JSON）を短く整形する
let s = ''; process.stdin.on('data', d => s += d).on('end', () => {
  for (const l of s.trim().split('\n')) { const i = l.indexOf('{'); if (i < 0) { console.log(l); continue; }
    const j = JSON.parse(l.slice(i)); if (j.error) { console.log(l.slice(0, i), 'ERROR', j.error); continue; }
    console.log(l.slice(0, i), JSON.stringify({ reset: j.resetToZero, endMoved: j.endMoved, end: j.end, min: j.minPlayhead, zeroRecv: j.zeroTicks?.length, stale: j.staleTicks, ref: j.refreshes?.length, items: j.newItems, caps: j.newCaptions, sfx: j.newSfx, wv: j.webview?.label })); }
});
