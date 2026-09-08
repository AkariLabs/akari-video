// L1 harness (wrapper-authored, verification-only; not product source).
// task 2026-09-08-cuts-default-off-and-daihon-button 指示 4（L1: ボタンの SS と
// 押下後にカットタブが前面の SS）。
//
// 使い方:
//   node run-l1.mjs <ラベル> <CDP ポート>
//
// 隔離ワークスペースはこのスクリプトが mkdtemp して自前で組む（templates/project-default
// を複製し、edit.json / captions.json / .akari/sidecars/.../cuts.json を置く）。
// HOME / THEIA_CONFIG_DIR / --user-data-dir はすべて一時プロファイル配下に向けてあり、
// 実利用の ~/.theia ~/.akari ~/.config/akari-video は読み書きしない。
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../../..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(REPO, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const [, , labelRaw, portRaw] = process.argv;
const label = labelRaw ?? 'run';
const port = Number(portRaw ?? 21993);
const outDir = process.env.AKARI_L1_OUT ?? path.join(tmpdir(), 'akari-l1-cuts-button-out');
mkdirSync(outDir, { recursive: true });

// ---- 隔離ワークスペース ---------------------------------------------------
const workspace = mkdtempSync(path.join(tmpdir(), 'akari-l1-cuts-ws-'));
cpSync(path.join(REPO, 'templates/project-default'), workspace, { recursive: true });
const MATERIAL = 'assets/take-01.mp4';
mkdirSync(path.join(workspace, 'assets'), { recursive: true });
// realpath が通ればよい（実デコードはしない）
writeFileSync(path.join(workspace, MATERIAL), 'dummy material for L1 fixture\n');
writeFileSync(path.join(workspace, 'edit.json'), JSON.stringify({
    version: 2,
    output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'take-01', path: MATERIAL }],
    tracks: [{
        id: 'v-main', lane: 'visual', name: '本編',
        items: [{ id: 'clip-0', at: 0, duration: 30, source: { kind: 'media', src: 'take-01', in: 0, out: 30 } }]
    }]
}, null, 2) + '\n');
writeFileSync(path.join(workspace, 'captions.json'), JSON.stringify(
    Array.from({ length: 6 }, (_, i) => ({
        id: `c-${String(i + 1).padStart(4, '0')}`, start: i * 5, end: i * 5 + 4,
        text: `これは ${i + 1} 行目の字幕です`,
        speaker: null, sourceRef: null, edited: false, time_domain: 'source'
    })), null, 2) + '\n');

const cutsPath = path.join(workspace, '.akari/sidecars', `${MATERIAL}.analysis`, 'cuts.json');
mkdirSync(path.dirname(cutsPath), { recursive: true });
/** ON 件数を指定して 22 件の候補を持つ cuts.json を書く（新既定 = 全部 default_on:false）。 */
const writeCuts = onCount => {
    const kinds = ['filler', 'redo', 'silence', 'unrecognized'];
    const candidates = Array.from({ length: 22 }, (_, i) => {
        const kind = kinds[i % kinds.length];
        const start = 0.5 + i * 1.2;
        return {
            id: `${kind}-${start.toFixed(1)}`, kind, start, end: start + 0.4,
            text: kind === 'filler' ? 'えー、' : kind === 'redo' ? 'で、で、' : null,
            on: i < onCount, default_on: false,
            reason: 'L1 fixture'
        };
    });
    writeFileSync(cutsPath, JSON.stringify({
        version: 1, generated_at: '2026-09-08T00:00:00Z', basis: 'cloud-scribe',
        rules: { filler: 'off', redo: 'off', silence_min_sec: 1.5, silence_keep_sec: 0.5, silence_break_sec: 3, unrecognized: 'off' },
        candidates, hand_edited: []
    }, null, 2) + '\n');
};
writeCuts(3);

// ---- Electron 起動 --------------------------------------------------------
const profile = mkdtempSync(path.join(tmpdir(), 'akari-l1-cuts-'));
const log = [];
const child = spawn(ELECTRON, [SHELL, workspace, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-sandbox'], {
    env: { ...process.env, HOME: profile, THEIA_CONFIG_DIR: path.join(profile, '.theia'), ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', d => log.push(String(d)));
child.stderr.on('data', d => log.push(String(d)));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const text = () => log.join('');
const killAll = () => {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
    for (const needle of [profile, `${SHELL} ${workspace}`]) {
        try { execFileSync('/usr/bin/pkill', ['-9', '-f', needle], { stdio: 'ignore' }); } catch { /* none left */ }
    }
};

/** 右ドックのタブ（台本 / カット）と、台本ヘッダの「カット候補へ」ボタンを読む。 */
const readState = page => page.evaluate(() => {
    const rectOf = node => {
        const r = node.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const tabs = [...document.querySelectorAll('#theia-right-content-panel .lm-TabBar-tab')]
        .map(tab => ({
            id: (tab.id || '').replace(/^shell-tab-/, ''),
            title: tab.getAttribute('title') || tab.textContent.trim(),
            current: tab.classList.contains('lm-mod-current'),
            rect: rectOf(tab)
        }))
        .filter(t => t.id && !t.id.endsWith('-hidden') && !t.id.startsWith('tab-key-') && t.rect.w > 0);
    const button = document.querySelector('.akari-daihon-cuts');
    const daihon = document.querySelector('.akari-daihon-widget');
    const cuts = document.querySelector('[data-akari-cuts="true"]');
    const visible = node => !!node && !node.classList.contains('lm-mod-hidden') && node.getBoundingClientRect().width > 0;
    const headerOrder = [...(document.querySelector('.akari-daihon-head')?.children ?? [])]
        .map(n => (n.className || '').toString().split(' ')[0] || n.tagName.toLowerCase());
    return {
        rightTabs: tabs,
        rightTabOrder: tabs.map(t => t.id),
        currentRightTab: tabs.find(t => t.current)?.id ?? null,
        cutsButton: button ? { text: button.textContent, title: button.title, className: button.className, rect: rectOf(button) } : null,
        headerOrder,
        daihonVisible: visible(daihon),
        cutsWidgetVisible: visible(cuts),
        cutsWidgetRows: cuts ? cuts.textContent.slice(0, 160) : null,
        preloadVisible: !!document.querySelector('.theia-preload')
    };
});

const shot = async (page, name, selector) => {
    await page.screenshot({ path: path.join(outDir, `${label}-${name}.png`) }).catch(() => undefined);
    if (selector) {
        const node = await page.$(selector);
        if (node) await node.screenshot({ path: path.join(outDir, `${label}-${name}-crop.png`) }).catch(() => undefined);
    }
};

const measurements = { label, workspace, cutsPath, steps: [] };
const finish = async code => {
    measurements.reachedReady = text().includes("to 'ready'");
    measurements.failedToStart = text().includes('Failed to start the frontend application.');
    measurements.profile = profile;
    killAll();
    await sleep(500);
    writeFileSync(path.join(outDir, `${label}-log.txt`), text());
    writeFileSync(path.join(outDir, `measurements-${label}.json`), JSON.stringify(measurements, null, 2));
    console.log(JSON.stringify(measurements, null, 2));
    process.exit(code);
};

let browser;
try {
    for (let i = 0; i < 90 && !browser; i++) {
        await sleep(1000);
        try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { /* not up yet */ }
    }
    if (!browser) throw new Error('CDP connect failed');
    const context = browser.contexts()[0];
    let page = context.pages().find(p => !p.url().startsWith('devtools://'));
    for (let i = 0; i < 30 && !page; i++) { await sleep(1000); page = context.pages()[0]; }
    page.on('pageerror', e => log.push(`[pageerror] ${e.message}\n`));
    await page.waitForSelector('#theia-app-shell', { timeout: 180000 });
    // 台本タブが右ドックに attach され、cuts.json を読み終えるまで待つ
    for (let i = 0; i < 40; i++) {
        await sleep(3000);
        const state = await readState(page);
        if (state.cutsButton && /\d+ \/ \d+/.test(state.cutsButton.text) && !/（0 \/ 0）/.test(state.cutsButton.text)) break;
    }
    // ① 台本タブを前面にしてヘッダのボタンを撮る
    const daihonTab = await page.$('#theia-right-content-panel .lm-TabBar-tab[id="shell-tab-akari-daihon-widget"]');
    // タブを押した直後は Theia のホバー（popover="hint"）が右ドックの上に残り、
    // ボタンのクリックを横取りする。ポインタを画面左へ逃がして消えるのを待つ。
    const away = async () => { await page.mouse.move(20, 600); await sleep(2500); };
    if (daihonTab) { await daihonTab.click({ timeout: 8000 }).catch(() => undefined); await away(); }
    measurements.steps.push({ step: '1-daihon-front', ...await readState(page) });
    await shot(page, '01-daihon-header', '.akari-daihon-head');

    // ② ボタンを押す → カットタブが前面に来るか
    const button = await page.$('.akari-daihon-cuts');
    if (!button) throw new Error('.akari-daihon-cuts が見つかりません');
    await button.click({ timeout: 20000 });
    await sleep(3000);
    measurements.steps.push({ step: '2-after-click', ...await readState(page) });
    await shot(page, '02-cuts-front', '#theia-right-content-panel');

    // ③ cuts.json を書き換えて（ON 3 → 7）ラベルが watch で追随するか
    //    台本タブへ戻してから書き換え、ラベルの更新を待つ
    if (daihonTab) { await daihonTab.click({ timeout: 8000 }).catch(() => undefined); await away(); }
    writeCuts(7);
    let updated = null;
    for (let i = 0; i < 30; i++) {
        await sleep(2000);
        updated = await readState(page);
        if (updated.cutsButton && updated.cutsButton.text.includes('7 / 22')) break;
    }
    measurements.steps.push({ step: '3-after-cuts-json-change', ...updated });
    await shot(page, '03-label-updated', '.akari-daihon-head');
    await finish(0);
} catch (error) {
    measurements.error = String((error && error.stack) || error);
    await finish(1);
}
