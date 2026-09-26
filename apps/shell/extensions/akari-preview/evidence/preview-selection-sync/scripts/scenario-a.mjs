// (a) 0〜3 秒の素材を動かす → 6 秒へ → 6 秒に見えている別の素材をクリック。選べるか・選択状態のログ。
// 使い方: node scenario-a.mjs <project> <move: caption|placed|shape|photo|html> <click: photo|shape|caption|placed|html> <outDir> <label>
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { clearLog, clickOutput, dragOutput, hostCdp, installProbe, seek, shotStage, sleep, snapshot, viewCdp, Z } from './pss.mjs';

const [project, move, click, outDir, label] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });
const host = await hostCdp();
let view = await viewCdp();
const probe = await installProbe(view);
const steps = [];
const snap = async name => { const s = await snapshot(host, view, name); steps.push(s); return s; };
// 素材の中心（出力 px）を DOM から実測する
const centerOf = async kind => view.eval(`(() => {
    const stage = document.getElementById('preview-stage').getBoundingClientRect();
    const out = r => ({ x: (r.left + r.width / 2 - stage.left) / stage.width * 1280, y: (r.top + r.height / 2 - stage.top) / stage.height * 720 });
    const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const kind = ${JSON.stringify(kind)};
    if (kind === 'caption' || kind === 'placed') {
        const plates = [...document.querySelectorAll('.caption-row-plate')].filter(vis).map(p => ({ p, text: p.textContent || '' }));
        const hit = plates.find(x => kind === 'placed' ? /置いた文字/.test(x.text) : /字幕/.test(x.text) && !/置いた/.test(x.text));
        if (!hit) return null;
        const line = hit.p.querySelector('.akari-caption__line') || hit.p;
        return { ...out(line.getBoundingClientRect()), text: hit.text.trim() };
    }
    return null;
})()`);
const FIXED = { t1: { shape: [520, 240], photo: [220, 160], html: [1030, 120] }, t6: { shape: [520, 440], photo: [220, 420], html: [1030, 310] } };
const at = async (kind, t) => {
    if (kind === 'caption' || kind === 'placed') { const c = await centerOf(kind); if (!c) throw new Error(`${kind} not visible at ${t}`); return [c.x, c.y]; }
    return FIXED[t][kind];
};

await seek(host, project, 1);
await clearLog(view);
await snap('t1-before');
const from = await at(move, 't1');
const drag = await dragOutput(host, view, from, [from[0] + 40, from[1] + 30]);
await sleep(1200);
await snap('t1-after-move');
await shotStage(host, view, path.join(outDir, `${label}-1-moved.png`));
await clearLog(view);
await seek(host, project, 6);
await sleep(800);
await snap('t6-after-seek');
const target = await at(click, 't6');
await clearLog(view);
const clicked = await clickOutput(host, view, target[0], target[1]);
await sleep(900);
const after = await snap('t6-after-click');
await shotStage(host, view, path.join(outDir, `${label}-2-clicked.png`));
const z = await view.eval(Z);
await writeFile(path.join(outDir, `${label}.json`), `${JSON.stringify({ label, move, click, probe, from, drag, target, clicked, steps, z }, null, 1)}\n`);
console.log(JSON.stringify({ label, afterClick: { closure: after.closure, ix: after.ix, dom: after.dom, timeline: after.timeline, log: after.log } }, null, 1));
host.close(); view.cdp.close(); process.exit(0);
