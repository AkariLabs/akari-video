// r1: 連続お試しの計測。棚を開いた状態で候補カードを順に実クリックし、各回の
// [akari-swap-trial] ログ（再読込・再生要求・送り直し）とタイムラインの再生ヘッドを記録する。
// Usage: node r1-trials.mjs <out.json> <key1> <key2> ...   Env: CDP_PORT, MS (1 回の観測窓の上限, 既定 45000)
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { connectMain, evalMain, realClick } from './cdp-lib.mjs';
// [akari-swap-trial] は Theia がバックエンドのログへ転送するので、Electron の stdout ログ（LOG）を読む
const LOG = process.env.LOG || '/tmp/swap-l1/electron.log';
const readLogs = (from) => readFileSync(LOG).subarray(from).toString('utf8').split('\n').filter(l => l.includes('[akari-swap-trial] '))
  .map(l => { try { return { wall: Date.parse(l.slice(0, 24)), ...JSON.parse(l.split('[akari-swap-trial] ')[1]) }; } catch { return null; } }).filter(Boolean);
const cdp = await connectMain(Number(process.env.CDP_PORT || 9395));
const ev = expr => evalMain(cdp, expr, 30000);
const PH = `(() => { const e=[...document.querySelector('.akari-annotations-widget').querySelectorAll('div')].find(e=>{const r=e.getBoundingClientRect(); return r.width>0&&r.width<=4&&r.height>150&&e.style.left.endsWith('%')}); return e ? parseFloat(e.style.left) : null; })()`;
const toast = `[...document.querySelectorAll('.theia-notification-list-item, .theia-notification-message, [class*=toast]')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,3)`;
const [out, ...keys] = process.argv.slice(2);
const rows = [];
for (const [i, key] of keys.entries()) {
  const sel = `document.querySelector('[data-akari-swap-candidate=${JSON.stringify(key)}]')`;
  if (!(await ev(`(() => { const c=${sel}; if(!c) return false; c.scrollIntoView({block:'center'}); return true; })()`))) { rows.push({ n: i + 1, key, error: 'card not found' }); console.log(JSON.stringify({ n: i + 1, key, error: 'card not found' })); continue; }
  await sleep(400); // スクロールが落ち着いてから座標を測る
  const pos = await ev(`(() => { const r=${sel}.getBoundingClientRect(); return [r.left+r.width/2, r.top+Math.min(40, r.height/3)]; })()`);
  if (!pos) { rows.push({ n: i + 1, key, error: 'card not found' }); continue; }
  const cachedBefore = existsSync(`${process.env.WS || '/tmp/swap-l1/ws'}/assets/${key}`);
  const logStart = statSync(LOG).size;
  const t0 = Date.now();
  await realClick(cdp, pos[0], pos[1]);
  const samples = [];
  let startedAt = null; let prev = null; let run = 0;
  let resultAt = null;
  while (Date.now() - t0 < Number(process.env.MS || 45000)) {
    if (resultAt === null && readLogs(logStart).some(l => l.event === 'trial_playback_result' || l.event === 'trial_playback_error')) resultAt = Date.now() - t0;
    if (resultAt !== null && (startedAt !== null || Date.now() - t0 - resultAt > 4000) && Date.now() - t0 - resultAt > 1500) break;
    const v = await ev(PH); const t = Date.now() - t0; samples.push([t, v]);
    if (prev !== null && v !== null && v > prev && v - prev < 1.0) { run++; if (run >= 2 && startedAt === null) startedAt = samples[samples.length - 3][0]; } else run = 0;
    prev = v;
    await sleep(150);
  }
  await sleep(300); const mine = readLogs(logStart);
  const tokens = [...new Set(mine.filter(l => l.event === 'trial_start').map(l => l.token))];
  const tl = mine.filter(l => tokens.includes(l.token));
  const at = ev_ => tl.find(l => l.event === ev_);
  const applied = at('trial_applied');
  const row = {
    n: i + 1, key, token: tokens.join(','), clickWall: t0,
    reloads: tl.filter(l => l.event === 'reload_start').length,
    playRequests: tl.filter(l => l.event === 'play_request').length,
    retries: tl.filter(l => l.event === 'play_retry').length,
    readyFallback: tl.filter(l => l.event === 'ready_fallback').length,
    result: tl.filter(l => l.event === 'trial_playback_result').map(l => l.result ?? l.outcome ?? l.status ?? JSON.stringify(l)).join(','),
    appliedMs: applied ? applied.wall - t0 : null,
    playbackStartMs: startedAt,
    logPlayingMs: (() => { const r = tl.find(l => l.event === 'playback_state' && l.playing); return r ? r.wall - t0 : null; })(),
    cachedBefore,
    startAfterAppliedMs: startedAt !== null && applied ? startedAt - (applied.wall - t0) : null,
    firstPlayRequestMs: at('play_request') ? at('play_request').wall - t0 : null,
    toasts: await ev(toast),
    samples, log: tl,
  };
  rows.push(row);
  console.log(JSON.stringify({ n: row.n, key, cachedBefore, reloads: row.reloads, playRequests: row.playRequests, retries: row.retries, appliedMs: row.appliedMs, logPlayingMs: row.logPlayingMs, playbackStartMs: startedAt, startAfterApplied: row.startAfterAppliedMs,
    logPlayingMs: (() => { const r = tl.find(l => l.event === 'playback_state' && l.playing); return r ? r.wall - t0 : null; })(),
    cachedBefore, result: row.result, toasts: row.toasts }));
  await sleep(700);
}
writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
process.exit(0);
