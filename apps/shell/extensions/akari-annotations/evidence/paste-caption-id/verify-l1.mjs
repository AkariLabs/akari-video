// L1: Electron + CDP で「字幕を ⌘C → ⌘V したとき id が c-NNNN になり、保存後検証が赤くならない」ことを実機確認する。
// Usage: node verify-l1.mjs <fieldtest root>. 元の fieldtest は読むだけ（素材を作業場へ複製して使う）。
//
// 規律（harness/wrapper-codex.md「L1 の後始末」「証跡に作業機のパスを残さない」）:
//   - Electron は detached にしない。1 回の L1 で同時に起動するのは 1 本だけ
//   - try/finally で PID を指名して kill し、--user-data-dir のパスで孤児 0 件を確認する
//   - 証跡は <WORKTREE> / <HOME> / <TMP> へ置換してから書く
//   - 本物の ~/.akari は読むだけ。AKARI_HOME は一時ディレクトリへ向ける
// CDP 呼び出しは全て時間制限を付ける（前面を取られると captureScreenshot が返らないことがある）。
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets } from '../t4-track-height-resize/scripts/cdp-lib.mjs';
import { createFixtureProject } from './fixture.mjs';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(evidence, '../../../..');
const worktree = path.resolve(shell, '../..');
const fieldtestRoot = process.argv[2];
assert.ok(fieldtestRoot, 'usage: node verify-l1.mjs <fieldtest root>');

const PORT = await (async () => {
    for (let candidate = 49453; candidate < 49473; candidate++) {
        try {
            await fetch(`http://127.0.0.1:${candidate}/json/version`, { signal: AbortSignal.timeout(1500) });
        } catch { return candidate; }
    }
    throw new Error('CDP 用の空きポートが無い');
})();
const scratch = await mkdtemp(path.join(tmpdir(), 'akari-paste-caption-id-l1-'));
const profile = path.join(scratch, 'profile');
const akariHome = path.join(scratch, 'akari-home');
const project = path.join(scratch, 'caption-paste-fixture');
const captionsPath = path.join(project, 'captions.json');
const editPath = path.join(project, 'edit.json');
const results = [];
const MOD = { none: 0, alt: 1, meta: 4, shift: 8 };

const sanitize = value => String(value)
    .split(scratch).join('<TMP>')
    .split(tmpdir()).join('<TMP>')
    .split(worktree).join('<WORKTREE>')
    .split(homedir()).join('<HOME>');

const t0 = Date.now();
const log = message => process.stderr.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${message}\n`);
const heartbeat = setInterval(() => log('heartbeat'), 15_000);
heartbeat.unref();
const record = (scenario, detail) => { log(`record: ${scenario}`); results.push({ scenario, ...detail, pass: true }); };

// ---------------------------------------------------------------- CDP helpers

const withTimeout = (promise, ms, label) => Promise.race([
    promise, sleep(ms).then(() => { throw new Error(`CDP timeout: ${label}`); })
]);
const ev = (cdp, expression, ms = 20_000) => withTimeout(evalOn(cdp, expression), ms, 'Runtime.evaluate');
const send = (cdp, method, params = {}, ms = 20_000) => withTimeout(cdp.send(method, params), ms, method);

async function move(cdp, x, y, modifiers = 0) {
    await send(cdp, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', modifiers });
}

async function click(cdp, x, y, modifiers = 0) {
    await move(cdp, x, y, modifiers);
    await send(cdp, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await sleep(40);
    await send(cdp, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1, modifiers });
    await sleep(220);
}

const KEYS = {
    c: { key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 },
    v: { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 }
};

async function press(cdp, name, modifiers = MOD.meta) {
    log(`press: ${name}`);
    const key = KEYS[name];
    await send(cdp, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key, modifiers });
    await sleep(50);
    await send(cdp, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key, modifiers });
    await sleep(250);
}

// パネル直下の最後の <div> がフッター（並びは toolbar / viewport / scrollbar / notice / footer）。
const FOOTER = `(() => {
    const panel = document.querySelector('[data-akari-ui="panel:timeline"]');
    return Array.from(panel.children).filter(el => el.tagName === 'DIV').at(-1);
})()`;
const footerText = cdp => ev(cdp, `${FOOTER}.textContent ?? ''`);
const clearFooter = cdp => ev(cdp, `(() => { ${FOOTER}.textContent = ''; return true; })()`);
/** 通知バナー（notice）はフッターの 1 つ前の div。赤の出所を両方見る。 */
const noticeText = cdp => ev(cdp, `(() => {
    const panel = document.querySelector('[data-akari-ui="panel:timeline"]');
    const divs = Array.from(panel.children).filter(el => el.tagName === 'DIV');
    return divs.at(-2)?.textContent ?? '';
})()`);

const revealExpression = selector => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const strip = document.querySelector('.akari-annotations-strip');
    const scroll = strip.parentElement;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const contentTop = rect.top - strip.getBoundingClientRect().top;
    const max = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    scroll.scrollTop = Math.max(0, Math.min(max, contentTop + rect.height / 2 - scroll.clientHeight / 2));
    return true;
})()`;

const measureExpression = selector => `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const scroll = document.querySelector('.akari-annotations-strip').parentElement;
    const view = scroll.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    const y = Math.round(Math.min(Math.max(r.top + r.height / 2, view.top + 4), view.bottom - 4));
    return { x: Math.round(r.left + r.width / 2), y,
        left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
        visible: r.top < view.bottom - 2 && r.bottom > view.top + 2 };
})()`;

async function rectOf(cdp, selector) {
    if (!(await ev(cdp, revealExpression(selector)))) return null;
    await sleep(450);
    const rect = await ev(cdp, measureExpression(selector));
    return rect?.visible ? rect : null;
}

const chipSelector = id => `.akari-annotations-strip [data-akari-item-id="${id}"]`;
const chipRect = (cdp, id) => rectOf(cdp, chipSelector(id));

async function waitChip(cdp, id) {
    for (let attempt = 0; attempt < 120; attempt++) {
        const rect = await chipRect(cdp, id);
        if (rect) return rect;
        if (attempt % 20 === 19) log(`waiting chip ${id} (${attempt + 1})`);
        await sleep(500);
    }
    await shot(cdp, 'zz-chip-missing.png');
    assert.fail(`チップが出ない: ${id}`);
}

const stripRect = cdp => ev(cdp, measureExpression('.akari-annotations-strip'));
const rulerRect = cdp => ev(cdp, `(() => {
    const strip = document.querySelector('.akari-annotations-strip');
    const ruler = strip.parentElement.parentElement.firstElementChild;
    const r = ruler.getBoundingClientRect();
    return { y: Math.round(r.top + r.height / 2), left: Math.round(r.left), right: Math.round(r.right) };
})()`);

const TIMESTAMP = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

/** ルーラーをクリックして再生ヘッドを置き、フッターの実測時刻（秒）を返す（選択は解除される）。 */
async function seekAt(cdp, x) {
    let text = '';
    for (let round = 0; round < 5; round++) {
        const ruler = await rulerRect(cdp);
        await clearFooter(cdp);
        await click(cdp, x, ruler.y);
        for (let attempt = 0; attempt < 16; attempt++) {
            text = await footerText(cdp);
            const match = TIMESTAMP.exec(text);
            if (match) return Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
            await sleep(250);
        }
    }
    await shot(cdp, 'zz-seek-failure.png');
    assert.fail(`再生ヘッドの時刻がフッターに出ない（フッター: ${JSON.stringify(text.slice(0, 160))}）`);
}

/** 2 点の実測から x ↔ 秒 の線形写像を作り、狙った秒へ再生ヘッドを置く。 */
async function movePlayhead(cdp, seconds) {
    log(`movePlayhead: ${seconds}`);
    const strip = await stripRect(cdp);
    const x1 = strip.left + Math.round((strip.right - strip.left) * 0.2);
    const x2 = strip.left + Math.round((strip.right - strip.left) * 0.8);
    const t1 = await seekAt(cdp, x1);
    const t2 = await seekAt(cdp, x2);
    assert.ok(Math.abs(t2 - t1) > 1e-6, 'strip の時間軸を校正できない');
    const x = Math.round(x1 + (seconds - t1) * (x2 - x1) / (t2 - t1));
    assert.ok(x > strip.left && x < strip.right, `狙った時刻 ${seconds} が表示範囲の外`);
    const actual = await seekAt(cdp, x);
    assert.ok(Math.abs(actual - seconds) < 0.25, `再生ヘッドが合わない: 狙い ${seconds} / 実測 ${actual}`);
    return actual;
}

const selectedIds = cdp => ev(cdp, `Array.from(document.querySelectorAll(
    '.akari-annotations-strip .akari-annotations-selected')).map(el => el.dataset.akariItemId)`);

async function hitPoint(cdp, selector, rect) {
    for (const ratio of [0.5, 0.28, 0.72, 0.15, 0.85]) {
        const x = Math.round(rect.left + (rect.right - rect.left) * ratio);
        const ok = await ev(cdp, `(() => {
            const target = document.querySelector(${JSON.stringify(selector)});
            const el = document.elementFromPoint(${x}, ${rect.y});
            return !!target && !!el && (el === target || target.contains(el) || el.closest('[data-akari-item-id]') === target);
        })()`);
        if (ok) return { x, y: rect.y };
    }
    return { x: rect.x, y: rect.y };
}

async function select(cdp, id) {
    log(`select: ${id}`);
    let selected = [];
    for (let round = 0; round < 4; round++) {
        const rect = await waitChip(cdp, id);
        const point = await hitPoint(cdp, chipSelector(id), rect);
        await click(cdp, point.x, point.y);
        selected = await selectedIds(cdp);
        if (selected.includes(id)) return selected;
        await sleep(500);
    }
    await shot(cdp, 'zz-select-failure.png');
    assert.fail(`選択できていない: 狙い ${id} / 実測 ${JSON.stringify(selected)}`);
}

/** ⌘C はフッターの「N 件をコピーしました。」まで見る。 */
async function copySelection(cdp, count) {
    await clearFooter(cdp);
    await press(cdp, 'c');
    let text = '';
    for (let attempt = 0; attempt < 20; attempt++) {
        text = await footerText(cdp);
        if (/件をコピーしました/.test(text)) {
            assert.equal(text, `${count} 件をコピーしました。`, 'コピー件数が違う');
            return text;
        }
        await sleep(250);
    }
    assert.fail(`⌘C が効いていない（フッター: ${JSON.stringify(text.slice(0, 160))}）`);
}

async function waitFileChange(file, before, timeoutMs = 40_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const latest = await readFile(file, 'utf8');
        if (latest !== before) { await sleep(700); return await readFile(file, 'utf8'); }
        await sleep(400);
    }
    assert.fail(`${path.basename(file)} が変わらなかった`);
}

async function shot(cdp, file) {
    log(`shot: ${file}`);
    let last;
    for (let attempt = 0; attempt < 6; attempt++) {
        try {
            await send(cdp, 'Page.bringToFront', {}, 8_000).catch(() => {});
            await sleep(700);
            const { data } = await send(cdp, 'Page.captureScreenshot', { format: 'png', fromSurface: attempt % 2 === 0 }, 20_000);
            last = Buffer.from(data, 'base64');
            if (last.length > 50_000) { await writeFile(path.join(evidence, file), last); return file; }
        } catch { /* 前面化できない機体では次の試行へ */ }
        await sleep(1000);
    }
    if (last) { await writeFile(path.join(evidence, file), last); return file; }
    return `${file} (capture unavailable)`;
}

const captionsOf = source => {
    const root = JSON.parse(source);
    return Array.isArray(root) ? root : root.captions;
};

/** 実物の edit-lint CLI を作業場のプロジェクトに当て、captions 系の指摘を数える。 */
function runEditLint() {
    const bin = path.join(worktree, 'packages/edit-lint/bin/edit-lint.mjs');
    try {
        const stdout = execFileSync(process.execPath, [bin, '--json', editPath],
            { encoding: 'utf8', env: { ...process.env, AKARI_HOME: akariHome } });
        return { exitCode: 0, ...summarizeLint(stdout) };
    } catch (error) {
        return { exitCode: error.status ?? null, ...summarizeLint(String(error.stdout ?? '')) };
    }
}

function summarizeLint(stdout) {
    try {
        const parsed = JSON.parse(stdout);
        const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
        return {
            captionSchemaFindings: findings.filter(finding => finding.check === 'captions.schema')
                .map(finding => sanitize(`[${finding.check}] ${finding.message}`)),
            errorFindings: findings.filter(finding => finding.severity === 'error')
                .map(finding => sanitize(`[${finding.check}] ${finding.message}`))
        };
    } catch {
        return { captionSchemaFindings: null, errorFindings: null, raw: sanitize(stdout.slice(0, 400)) };
    }
}

// ---------------------------------------------------------------- session

let electron;
let exited;
let output = '';
let cdp;
let closed;
let orphanCheck = 'not-run';

/** postbuild の resign-electron が直すのは apps/shell 側なので、あればそちらを優先する。 */
function electronBinary() {
    const candidates = [
        path.resolve(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
        path.resolve(worktree, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    ];
    return candidates.find(candidate => existsSync(candidate)) ?? candidates[1];
}

async function startElectron() {
    electron = spawn(
        electronBinary(),
        [shell, project, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox'],
        { cwd: shell, env: { ...process.env, THEIA_CONFIG_DIR: path.join(scratch, 'config'), AKARI_HOME: akariHome },
            stdio: ['ignore', 'pipe', 'pipe'] }
    );
    electron.stdout.on('data', data => { output += data; });
    electron.stderr.on('data', data => { output += data; });
    closed = new Promise(resolve => electron.once('exit', (code, signal) => {
        exited = { code, signal };
        resolve();
    }));
    log(`electron spawned on port ${PORT}`);
    let connected = false;
    for (let attempt = 0; attempt < 240; attempt++) {
        if (exited) throw new Error(`Electron exited before UI startup: ${JSON.stringify(exited)}`);
        try {
            const target = (await listTargets(PORT)).find(entry => entry.type === 'page' && String(entry.url).includes(shell));
            if (target) {
                cdp = new CDP(target.webSocketDebuggerUrl);
                await withTimeout(cdp.connect(), 10_000, 'connect');
                if (await ev(cdp, '!!window.theia?.container', 10_000)) { connected = true; break; }
                cdp.close();
                cdp = undefined;
            }
        } catch { /* startup is not ready yet */ }
        await sleep(500);
    }
    assert.ok(connected, 'Theia UI did not become ready');
    const commandRegistry = `(() => {
        const container = window.theia.container;
        const key = [...container._bindingDictionary._map.keys()].find(key =>
            typeof key === 'function' && key.prototype?.executeCommand && key.prototype?.registerCommand);
        return key ? container.get(key) : undefined;
    })()`;
    let ready = false;
    for (let attempt = 0; attempt < 240 && !ready; attempt++) {
        ready = await ev(cdp, `!!${commandRegistry}?.getAllCommands().find(c => c.id === 'akari.annotations.open')`);
        if (!ready) { if (attempt % 20 === 19) log(`waiting command registry (${attempt + 1})`); await sleep(500); }
    }
    assert.ok(ready, 'akari.annotations.open did not get registered');
    let started = false;
    for (let attempt = 0; attempt < 240 && !started; attempt++) {
        started = await ev(cdp, `(() => {
            const el = document.querySelector('.theia-preload');
            if (!el) return true;
            const style = getComputedStyle(el);
            return style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0;
        })()`);
        if (!started) { if (attempt % 20 === 19) log(`waiting preload gone (${attempt + 1})`); await sleep(500); }
    }
    assert.ok(started, 'Theia frontend did not finish starting');
    log('preload gone; opening timeline');
    await ev(cdp, `(() => { void ${commandRegistry}.executeCommand('akari.annotations.open'); return true; })()`);
}

try {
    await mkdir(akariHome, { recursive: true });
    // 本物の ~/.akari は読むだけ。ポインタだけ写して first-run 面が割り込まないようにする。
    await copyFile(path.join(homedir(), '.akari/creator-root.json'), path.join(akariHome, 'creator-root.json'))
        .catch(() => undefined);
    await createFixtureProject(project, fieldtestRoot);
    log('fixture ready');
    await startElectron();
    log('electron ready');
    await waitChip(cdp, 'c-0001');
    log('caption chip visible');
    await sleep(2000);
    const beforeCaptions = await readFile(captionsPath, 'utf8');
    record('初期状態（c-0001..c-0006 の字幕チップ）', {
        captionIds: captionsOf(beforeCaptions).map(caption => caption.id),
        footer: await footerText(cdp),
        screenshot: await shot(cdp, '00-initial.png')
    });

    // 字幕 1 件を ⌘C → 再生ヘッドを 8.0 秒へ → ⌘V
    await select(cdp, 'c-0001');
    const copyFooter = await copySelection(cdp, 1);
    const playhead = await movePlayhead(cdp, 8.0);
    await press(cdp, 'v');
    const afterCaptions = await waitFileChange(captionsPath, beforeCaptions);
    const before = captionsOf(beforeCaptions);
    const after = captionsOf(afterCaptions);
    const added = after.filter(caption => !before.some(entry => entry.id === caption.id));
    assert.equal(added.length, 1, `貼り付けで 1 行増えていない: ${JSON.stringify(after.map(c => c.id))}`);
    assert.equal(added[0].id, 'c-0007', `新しい字幕の id が c-0007 でない: ${added[0].id}`);
    assert.ok(after.every(caption => /^c-\d{4}$/.test(caption.id)),
        `c-NNNN でない id がある: ${JSON.stringify(after.map(c => c.id))}`);
    assert.equal(new Set(after.map(caption => caption.id)).size, after.length, 'id が重複している');

    // 保存後検証（deferred lint）の結果がフッター / 通知に出るのを待ってから読む。
    await sleep(12_000);
    const footer = await footerText(cdp);
    const notice = await noticeText(cdp);
    const screenshot = await shot(cdp, '01-caption-paste.png');
    const lint = runEditLint();
    assert.ok(!/captions\.schema/.test(footer), `フッターに captions.schema の赤: ${JSON.stringify(footer)}`);
    assert.ok(!/captions\.schema/.test(notice), `通知に captions.schema の赤: ${JSON.stringify(notice)}`);
    assert.ok(!/保存後の検証で問題が見つかりました/.test(`${footer}${notice}`),
        `保存後検証が赤: footer=${JSON.stringify(footer)} notice=${JSON.stringify(notice)}`);
    assert.deepEqual(lint.captionSchemaFindings, [], `edit-lint に captions.schema の指摘: ${JSON.stringify(lint)}`);
    record('字幕 1 件を ⌘C → ⌘V すると c-0007 になり保存後検証が赤くならない', {
        playhead, copyFooter, footer, notice,
        beforeIds: before.map(caption => caption.id),
        afterIds: after.map(caption => caption.id),
        added: added.map(caption => ({ id: caption.id, start: caption.start, end: caption.end,
            time_domain: caption.time_domain ?? caption.timeDomain ?? null })),
        editLint: lint,
        screenshot
    });
    await writeFile(path.join(evidence, 'captions-after-paste.json'), sanitize(afterCaptions));
} catch (error) {
    let snapshot;
    try {
        snapshot = {
            footer: cdp ? await footerText(cdp).catch(() => null) : null,
            notice: cdp ? await noticeText(cdp).catch(() => null) : null,
            captions: captionsOf(await readFile(captionsPath, 'utf8')).map(caption => caption.id)
        };
    } catch { snapshot = null; }
    results.push({ pass: false, error: sanitize(error?.stack ?? error), snapshot });
    process.exitCode = 1;
} finally {
    cdp?.close();
    if (electron && !exited) {
        try { process.kill(electron.pid, 'SIGTERM'); } catch { /* already gone */ }
    }
    if (closed) await Promise.race([closed, sleep(15_000)]);
    if (electron && !exited) {
        try { process.kill(electron.pid, 'SIGKILL'); } catch { /* already gone */ }
        await Promise.race([closed ?? sleep(0), sleep(5_000)]);
    }
    for (let attempt = 0; attempt < 20; attempt++) {
        const lines = execFileSync('/bin/ps', ['-eo', 'pid,ppid,args'], { encoding: 'utf8' })
            .split('\n').filter(line => line.includes(profile) || line.includes(`${shell}/lib/backend/main.js`));
        orphanCheck = lines.length === 0 ? 'ok: 0 processes' : `残 ${lines.length} 件: ${sanitize(lines.join(' | '))}`;
        if (lines.length === 0) break;
        await sleep(1000);
    }
    results.push({ scenario: 'L1 後始末（孤児プロセス）', orphanCheck, pass: orphanCheck.startsWith('ok') });
    if (!orphanCheck.startsWith('ok')) process.exitCode = 1;
    await writeFile(path.join(evidence, 'electron.log'), sanitize(output));
    await writeFile(path.join(evidence, 'l1-checks.json'), sanitize(JSON.stringify(results, null, 2)) + '\n');
    clearInterval(heartbeat);
    await rm(scratch, { recursive: true, force: true });
    console.log(orphanCheck);
}
