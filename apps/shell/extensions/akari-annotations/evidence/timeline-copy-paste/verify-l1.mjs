// L1: Electron + CDP でタイムラインのコピー / 切り取り / 貼り付け / Option ドラッグ複製を実機確認する。
// Usage: node verify-l1.mjs <fieldtest root>. 元の fieldtest は読むだけ（素材を作業場へ複製して使う）。
//
// 規律（harness/wrapper-codex.md「L1 の後始末」）:
//   - Electron は detached にしない。1 回の L1 で同時に起動するのは 1 本だけ
//   - try/finally で PID を指名して kill し、--user-data-dir のパスで孤児 0 件を確認する
//   - 証跡に作業機の絶対パスを残さない（<WORKTREE> / <HOME> / <TMP> へ置換してから書く）
// CDP 呼び出しは全て時間制限を付ける。並走レーンの Electron に前面を取られると
// Page.captureScreenshot が返らないことがあり、素の await だとレーンごと固まるため。
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets } from '../t4-track-height-resize/scripts/cdp-lib.mjs';
import { createFixtureProject, FPS } from './fixture.mjs';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(evidence, '../../../..');
const worktree = path.resolve(shell, '../..');
const fieldtestRoot = process.argv[2];
assert.ok(fieldtestRoot, 'usage: node verify-l1.mjs <fieldtest root>');

const PORT = await (async () => {
    for (let candidate = 49413; candidate < 49433; candidate++) {
        try {
            await fetch(`http://127.0.0.1:${candidate}/json/version`, { signal: AbortSignal.timeout(1500) });
        } catch { return candidate; }
    }
    throw new Error('CDP 用の空きポートが無い');
})();
const scratch = await mkdtemp(path.join(tmpdir(), 'akari-timeline-clipboard-l1-'));
const profile = path.join(scratch, 'profile');
const project = path.join(scratch, 'clipboard-fixture');
const editPath = path.join(project, 'edit.json');
const results = [];
const MOD = { none: 0, alt: 1, meta: 4, shift: 8 };

const sanitize = value => String(value)
    .split(scratch).join('<TMP>')
    .split(tmpdir()).join('<TMP>')
    .split(worktree).join('<WORKTREE>')
    .split(homedir()).join('<HOME>');

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

async function drag(cdp, from, to, modifiers = 0) {
    await move(cdp, from.x, from.y, modifiers);
    await send(cdp, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1, modifiers });
    await sleep(80);
    for (let step = 1; step <= 12; step++) {
        const x = Math.round(from.x + (to.x - from.x) * (step / 12));
        const y = Math.round(from.y + (to.y - from.y) * (step / 12));
        await send(cdp, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1, modifiers });
        await sleep(26);
    }
    await sleep(120);
    await send(cdp, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1, modifiers });
    await sleep(300);
}

const KEYS = {
    c: { key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67 },
    x: { key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88 },
    v: { key: 'v', code: 'KeyV', windowsVirtualKeyCode: 86 },
    z: { key: 'z', code: 'KeyZ', windowsVirtualKeyCode: 90 }
};

async function press(cdp, name, modifiers = MOD.meta) {
    log(`press: ${name}`);
    const key = KEYS[name];
    await send(cdp, 'Input.dispatchKeyEvent', { type: 'keyDown', ...key, modifiers });
    await sleep(50);
    await send(cdp, 'Input.dispatchKeyEvent', { type: 'keyUp', ...key, modifiers });
    await sleep(250);
}

// パネル直下の最後の <div> がフッター（並びは toolbar / viewport / scrollbar / notice / footer、
// 末尾の <style> は div ではない）。
const FOOTER = `(() => {
    const panel = document.querySelector('[data-akari-ui="panel:timeline"]');
    return Array.from(panel.children).filter(el => el.tagName === 'DIV').at(-1);
})()`;
const footerText = cdp => ev(cdp, `${FOOTER}.textContent ?? ''`);
const clearFooter = cdp => ev(cdp, `(() => { ${FOOTER}.textContent = ''; return true; })()`);

/**
 * タイムラインの段は下パネルの高さ（実測 110px）より背が高く、はみ出した段はクリックしても
 * 別のウィジェットに当たる。測る前に縦スクロールで可視域へ入れ、可視域に入ったことを確かめる。
 * ヘッダー列は stripScroll の scrollTop で translateY されるので、同じ操作で両方が動く。
 */
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

/** strip 内のチップ（トラックヘッダー側の同 id 行と混ざらないよう scope を切る）。 */
const chipRect = (cdp, id) => rectOf(cdp, `.akari-annotations-strip [data-akari-item-id="${id}"]`);
/** cuts のチップは data-akari-item-id が段内の index なので、安定した data-akari-ui で引く。 */
const cutRect = (cdp, index) => rectOf(cdp, `.akari-annotations-strip [data-akari-ui="timeline:cut:${index}"]`);

async function waitChip(cdp, id) {
    for (let attempt = 0; attempt < 120; attempt++) {
        const rect = await chipRect(cdp, id);
        if (rect) return rect;
        if (attempt % 20 === 19) log(`waiting chip ${id} (${attempt + 1})`);
        await sleep(500);
    }
    assert.fail(`チップが出ない: ${id}`);
}

const stripRect = cdp => ev(cdp, measureExpression('.akari-annotations-strip'));
/** ルーラー帯（timelineBody の先頭の子）。チップが無いので再生ヘッド移動に使う。 */
const rulerRect = cdp => ev(cdp, `(() => {
    const strip = document.querySelector('.akari-annotations-strip');
    const ruler = strip.parentElement.parentElement.firstElementChild;
    const r = ruler.getBoundingClientRect();
    return { y: Math.round(r.top + r.height / 2), left: Math.round(r.left), right: Math.round(r.right) };
})()`);

async function pasteTargetRect(cdp, trackId) {
    const selector = `[data-akari-paste-target="${trackId}"]`;
    const rect = await rectOf(cdp, selector);
    if (!rect) return null;
    const pressed = await ev(cdp, `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') ?? null`);
    return { ...rect, pressed };
}

const trackRows = cdp => ev(cdp, `Array.from(document.querySelectorAll('[data-akari-paste-target]')).map(el => {
    const r = el.getBoundingClientRect();
    return { trackId: el.dataset.akariPasteTarget, pressed: el.getAttribute('aria-pressed'),
        y: Math.round(r.top + r.height / 2) };
})`);

const TIMESTAMP = /(\d{2}):(\d{2}):(\d{2})\.(\d{3})/;

/** ルーラーをクリックして再生ヘッドを置き、フッターの実測時刻（秒）を返す（選択は解除される）。 */
async function seekAt(cdp, x) {
    let text = '';
    // 直前のチップ操作で suppressNextStripClick が立っていると 1 回目のクリックは捨てられる。
    // フッターに時刻が出るまで数回クリックし直す。
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
    assert.fail(`再生ヘッドの時刻がフッターに出ない（フッター: ${JSON.stringify(text.slice(0, 160))} / クリック点: x=${x}）`);
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

/**
 * チップ中央は再生ヘッドの当たり判定（akari-playhead-line-hit）と重なることがある。
 * 実際にそのチップが最前面に来る x を選び直してから押す。
 */
async function hitPoint(cdp, selector, rect) {
    const ratios = [0.5, 0.28, 0.72, 0.15, 0.85];
    for (const ratio of ratios) {
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

async function select(cdp, ids) {
    log(`select: ${JSON.stringify(ids)}`);
    const expected = ids.map(id => String(id)).sort();
    let selected = [];
    // 貼り付け直後は再描画でチップのノードが差し替わり、押下と解放の間に listener が消えて
    // 選択が落ちることがある。狙いどおりになるまで数回押し直す。
    for (let round = 0; round < 4; round++) {
        for (const [index, id] of ids.entries()) {
            const selector = typeof id === 'number'
                ? `.akari-annotations-strip [data-akari-ui="timeline:cut:${id}"]`
                : `.akari-annotations-strip [data-akari-item-id="${id}"]`;
            const rect = typeof id === 'number' ? await cutRect(cdp, id) : await waitChip(cdp, id);
            assert.ok(rect, `選択対象が見つからない: ${id}`);
            const point = await hitPoint(cdp, selector, rect);
            await click(cdp, point.x, point.y, index === 0 ? MOD.none : MOD.shift);
        }
        selected = await selectedIds(cdp);
        if (JSON.stringify([...selected].sort()) === JSON.stringify(expected)) return selected;
        await sleep(500);
    }
    const last = typeof ids.at(-1) === 'number' ? await cutRect(cdp, ids.at(-1)) : await chipRect(cdp, ids.at(-1));
    const point = last ? await ev(cdp, `(() => {
        const p = ${JSON.stringify(last ?? {})};
        const names = [];
        let node = document.elementFromPoint(p.x, p.y);
        while (node && names.length < 6) {
            names.push(node.tagName + '|' + (typeof node.className === 'string' ? node.className : '')
                + '|' + JSON.stringify(node.dataset || {}));
            node = node.parentElement;
        }
        return JSON.stringify(names);
    })()`) : null;
    await shot(cdp, 'zz-select-failure.png');
    assert.fail(`選択できていない: 狙い ${JSON.stringify(expected)} / 実測 ${JSON.stringify(selected)}`
        + ` / クリック点 ${JSON.stringify(last)} / ${point}`);
}

/** ⌘C はフッターの「N 件をコピーしました。」まで見て、断片が入れ替わったことを確かめる。 */
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

const readEdit = async () => JSON.parse(await readFile(editPath, 'utf8'));

async function waitEditChange(before, { expectChange = true, timeoutMs = 40_000 } = {}) {
    log(`waitEditChange: expectChange=${expectChange}`);
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const latest = await readFile(editPath, 'utf8');
        if ((latest !== before) === expectChange) {
            if (expectChange) { await sleep(700); return await readEdit(); }
            break;
        }
        await sleep(400);
    }
    if (expectChange) assert.fail('edit.json が変わらなかった');
    await sleep(2000);
    assert.equal(await readFile(editPath, 'utf8'), before, 'edit.json が変わってしまった');
    return JSON.parse(before);
}

const itemsOf = (doc, trackId) => (doc.tracks.find(track => track.id === trackId)?.items ?? [])
    .map(item => ({ id: item.id, at: item.at, duration: item.duration }))
    .sort((left, right) => left.at - right.at);
const trackIds = doc => doc.tracks.map(track => track.id);
const newOn = (doc, trackId, knownIds) => itemsOf(doc, trackId).filter(item => !knownIds.includes(item.id));
const idsOf = (source, trackId) => itemsOf(source, trackId).map(item => item.id);

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

const t0 = Date.now();
const log = message => process.stderr.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${message}\n`);
const heartbeat = setInterval(() => log(`heartbeat`), 15_000);
heartbeat.unref();
/** 再生ヘッドはクリック位置の丸めが乗るため、位置の一致は 2 フレーム以内で見る。 */
const atPlayhead = (frames, playhead, label) => assert.ok(Math.abs(frames - playhead * FPS) <= 2,
    `${label}: 再生ヘッド ${(playhead * FPS).toFixed(1)}f に対し実測 ${frames}f`);
const record = (scenario, detail) => { log(`record: ${scenario}`); results.push({ scenario, ...detail, pass: true }); };

// ---------------------------------------------------------------- session

let electron;
let exited;
let output = '';
let cdp;
let closed;
let orphanCheck = 'not-run';

async function startElectron() {
    electron = spawn(
        path.resolve(worktree, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
        [shell, project, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox'],
        { cwd: shell, env: { ...process.env, THEIA_CONFIG_DIR: path.join(scratch, 'config') },
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
    log('command registered');
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
    log(`preload gone; opening timeline`);
    // コマンドの Promise は await しない（reloadAll がプロジェクト次第で長引く）。DOM の出現で待つ。
    await ev(cdp, `(() => { void ${commandRegistry}.executeCommand('akari.annotations.open'); return true; })()`);
}

try {
    await createFixtureProject(project, fieldtestRoot);
    log("fixture ready");
    await startElectron();
    log("electron ready");
    await waitChip(cdp, 'ovl-1');
    log('first chip visible');
    await sleep(2000);
    record('段の並び（貼り先トグルの実測）', {
        tracks: await trackRows(cdp), footer: await footerText(cdp),
        screenshot: await shot(cdp, '00-initial.png')
    });

    // (a) 1 個を後ろの再生ヘッドへ（既定 = 元と同じ段）
    let before = await readFile(editPath, 'utf8');
    await select(cdp, ['ovl-1']);
    const copyFooter = await copySelection(cdp, 1);
    let playhead = await movePlayhead(cdp, 8.0);
    await press(cdp, 'v');
    let after = await waitEditChange(before);
    const pastedA = newOn(after, 'v-ovl1', ['ovl-1']);
    assert.equal(pastedA.length, 1, '(a) v-ovl1 に貼り付けた 1 件が無い');
    atPlayhead(pastedA[0].at, playhead, '(a)');
    assert.equal(pastedA[0].duration, 45);
    record('(a) 1 個を再生ヘッドへ（同じ段）', {
        playhead, copyFooter, footer: await footerText(cdp),
        before: itemsOf(JSON.parse(before), 'v-ovl1'), after: itemsOf(after, 'v-ovl1'),
        screenshot: await shot(cdp, '01-single-paste.png')
    });
    const afterA = await readFile(editPath, 'utf8');

    // (b) 3 トラックまとめて相対保持
    before = afterA;
    await select(cdp, ['ovl-1', 'ovl-2', 'ovl-3']);
    const multiCopyFooter = await copySelection(cdp, 3);
    playhead = await movePlayhead(cdp, 6.0);
    await press(cdp, 'v');
    after = await waitEditChange(before);
    const b1 = newOn(after, 'v-ovl1', idsOf(JSON.parse(before), 'v-ovl1'));
    const b2 = newOn(after, 'v-ovl2', idsOf(JSON.parse(before), 'v-ovl2'));
    const b3 = newOn(after, 'v-ovl3', idsOf(JSON.parse(before), 'v-ovl3'));
    assert.deepEqual([b1.length, b2.length, b3.length], [1, 1, 1], '(b) 3 段へ 1 件ずつ入っていない');
    atPlayhead(b1[0].at, playhead, '(b)');
    assert.equal(b2[0].at - b1[0].at, 45, '(b) 元の相対オフセット（1.5 秒）が保たれていない');
    assert.equal(b3[0].at - b1[0].at, 90, '(b) 元の相対オフセット（3.0 秒）が保たれていない');
    record('(b) 3 トラックまとめて相対保持', {
        playhead, copyFooter: multiCopyFooter, footer: await footerText(cdp),
        placed: { 'v-ovl1': b1, 'v-ovl2': b2, 'v-ovl3': b3 },
        screenshot: await shot(cdp, '02-multi-paste.png')
    });

    // (g) ⌘Z で全部戻る（1 回の ⌘V = 1 スナップショット）
    const beforeUndo = await readFile(editPath, 'utf8');
    await press(cdp, 'z');
    await waitEditChange(beforeUndo);
    const undone = await readFile(editPath, 'utf8');
    assert.equal(JSON.stringify(JSON.parse(undone)), JSON.stringify(JSON.parse(afterA)),
        '(g) ⌘Z 一回で (b) の 3 件が全部戻らない');
    record('(g) ⌘Z 一回で 3 件まとめて戻る', {
        footer: await footerText(cdp),
        tracksAfterUndo: { 'v-ovl1': itemsOf(JSON.parse(undone), 'v-ovl1'),
            'v-ovl2': itemsOf(JSON.parse(undone), 'v-ovl2'), 'v-ovl3': itemsOf(JSON.parse(undone), 'v-ovl3') },
        screenshot: await shot(cdp, '03-undo.png')
    });

    // (c) 貼り先指定で別トラックへ
    before = undone;
    const toggle = await pasteTargetRect(cdp, 'v-ovl2');
    assert.ok(toggle, '貼り先トグルが無い');
    await click(cdp, toggle.x, toggle.y);
    assert.equal((await pasteTargetRect(cdp, 'v-ovl2')).pressed, 'true', '貼り先トグルが押下状態にならない');
    await select(cdp, ['ovl-1', 'ovl-2']);
    await copySelection(cdp, 2);
    playhead = await movePlayhead(cdp, 6.0);
    await press(cdp, 'v');
    after = await waitEditChange(before);
    const c2 = newOn(after, 'v-ovl2', idsOf(JSON.parse(before), 'v-ovl2'));
    const c3 = newOn(after, 'v-ovl3', idsOf(JSON.parse(before), 'v-ovl3'));
    assert.equal(c2.length, 1, '(c) 貼り先 v-ovl2 に一番下の選択元が来ていない');
    assert.equal(c3.length, 1, '(c) 上段の相対関係が v-ovl3 へ写っていない');
    atPlayhead(c2[0].at, playhead, '(c)');
    assert.equal(c3[0].at - c2[0].at, 45);
    const targetShot = await shot(cdp, '04-paste-target.png');

    // (c') 種別が違えば拒否（貼り先を音声トラックへ Option クリックで solo 指定）
    const audioToggle = await pasteTargetRect(cdp, 'a1');
    assert.ok(audioToggle, '音声トラックの貼り先トグルが無い');
    await click(cdp, audioToggle.x, audioToggle.y, MOD.alt);
    const soloState = await trackRows(cdp);
    assert.deepEqual(soloState.filter(row => row.pressed === 'true').map(row => row.trackId), ['a1'],
        'Option クリックで solo にならない');
    before = await readFile(editPath, 'utf8');
    await clearFooter(cdp);
    await press(cdp, 'v');
    await waitEditChange(before, { expectChange: false });
    const rejectFooter = await footerText(cdp);
    assert.match(rejectFooter, /種別/, '(c) 種別違いの拒否がフッターに出ない');
    record('(c) 貼り先指定で別トラックへ / 種別違いは拒否', {
        playhead, placed: { 'v-ovl2': c2, 'v-ovl3': c3 }, soloState, rejectFooter,
        screenshot: targetShot, rejectScreenshot: await shot(cdp, '05-reject-kind.png')
    });

    const clear = await pasteTargetRect(cdp, 'a1');
    await click(cdp, clear.x, clear.y);
    assert.deepEqual((await trackRows(cdp)).filter(row => row.pressed === 'true').map(row => row.trackId), [],
        '貼り先指定を解除できない');

    // (d) cuts の途中に挿入 → 右側を押し出し、layers は動かない
    before = await readFile(editPath, 'utf8');
    const beforeCuts = itemsOf(JSON.parse(before), 'v-main');
    const beforeOvl1 = itemsOf(JSON.parse(before), 'v-ovl1');
    await select(cdp, [0]);
    await copySelection(cdp, 1);
    playhead = await movePlayhead(cdp, 3.0);
    await press(cdp, 'v');
    after = await waitEditChange(before);
    const afterCuts = itemsOf(after, 'v-main');
    assert.equal(afterCuts.length, beforeCuts.length + 2, '(d) 分割 + 挿入で 2 件増えていない');
    assert.equal(afterCuts[0].at, 0, '(d) 先頭が動いた');
    atPlayhead(afterCuts[0].duration, playhead, '(d) 分割位置');
    atPlayhead(afterCuts[1].at, playhead, '(d) 挿入位置');
    assert.equal(afterCuts[1].duration, 180, '(d) 挿入したクリップの尺が元と違う');
    assert.equal(afterCuts[0].at + afterCuts[0].duration, afterCuts[1].at, '(d) 分割の左右が連続していない');
    assert.equal(afterCuts[1].at + afterCuts[1].duration, afterCuts[2].at, '(d) 右側が尺ぶん押し出されていない');
    assert.equal(afterCuts[0].duration + afterCuts[2].duration, beforeCuts[0].duration, '(d) 分割の合計尺が元と違う');
    assert.deepEqual(itemsOf(after, 'v-ovl1'), beforeOvl1, '(d) 時刻トラック（overlay）が動いてしまった');
    record('(d) cuts は分割挿入・右側を押し出し / 時刻トラックは不動', {
        playhead, beforeCuts, afterCuts, overlaysUnchanged: beforeOvl1,
        screenshot: await shot(cdp, '06-cuts-ripple.png')
    });

    // (e) 衝突したら上に新しいトラックを作る
    before = await readFile(editPath, 'utf8');
    const beforeTracks = trackIds(JSON.parse(before));
    const ovl3 = itemsOf(JSON.parse(before), 'v-ovl3').find(item => item.id === 'ovl-3');
    await select(cdp, ['ovl-3']);
    await copySelection(cdp, 1);
    playhead = await movePlayhead(cdp, ovl3.at / FPS + 0.5);
    await press(cdp, 'v');
    after = await waitEditChange(before);
    const created = trackIds(after).filter(id => !beforeTracks.includes(id));
    assert.equal(created.length, 1, '(e) 新しいトラックが 1 本作られていない');
    assert.equal(trackIds(after).indexOf(created[0]), trackIds(after).indexOf('v-ovl3') + 1,
        '(e) 新トラックが元段の直上に入っていない');
    assert.equal(itemsOf(after, created[0]).length, 1);
    atPlayhead(itemsOf(after, created[0])[0].at, playhead, '(e)');
    assert.deepEqual(itemsOf(after, 'v-ovl3'), itemsOf(JSON.parse(before), 'v-ovl3'), '(e) 元段が書き換わった');
    record('(e) 衝突 → 上に新トラックを作って置く', {
        playhead, beforeTracks, afterTracks: trackIds(after), createdTrack: created[0],
        placed: itemsOf(after, created[0]),
        screenshot: await shot(cdp, '07-new-track.png')
    });

    // (f) Option ドラッグ複製（掴んだ時点で複製・元は動かない）
    before = await readFile(editPath, 'utf8');
    const beforeDoc = JSON.parse(before);
    const allItems = doc => doc.tracks.flatMap(track => itemsOf(doc, track.id).map(item => ({ ...item, trackId: track.id })));
    const beforeItems = allItems(beforeDoc);
    const source = await waitChip(cdp, 'ovl-2');
    const strip = await stripRect(cdp);
    const point = await hitPoint(cdp, '.akari-annotations-strip [data-akari-item-id="ovl-2"]', source);
    const shiftPx = Math.round((strip.right - strip.left) * 0.16);
    await drag(cdp, point, { x: point.x + shiftPx, y: point.y }, MOD.alt);
    after = await waitEditChange(before);
    const afterItems = allItems(after);
    const duplicated = afterItems.filter(item => !beforeItems.some(entry => entry.id === item.id));
    assert.equal(duplicated.length, 1, '(f) Option ドラッグで 1 件複製されていない');
    assert.deepEqual(afterItems.filter(item => beforeItems.some(entry => entry.id === item.id)), beforeItems,
        '(f) 元のクリップが動いてしまった（複製ではなく移動になっている）');
    const original = beforeItems.find(item => item.id === 'ovl-2');
    assert.ok(duplicated[0].at > original.at, '(f) 複製がドロップ先へ置かれていない');
    record('(f) Option ドラッグで複製（元は動かない）', {
        original, duplicated: duplicated[0],
        newTrack: trackIds(after).find(id => !trackIds(beforeDoc).includes(id)) ?? null,
        screenshot: await shot(cdp, '08-alt-drag-duplicate.png')
    });

    // ⌘X（切り取り）も同じ断片契約で動き、⌘Z で戻る
    before = await readFile(editPath, 'utf8');
    await select(cdp, [duplicated[0].id]);
    await press(cdp, 'x');
    after = await waitEditChange(before);
    assert.ok(!allItems(after).some(item => item.id === duplicated[0].id), '⌘X で消えていない');
    const cutFooter = await footerText(cdp);
    const beforeCutUndo = await readFile(editPath, 'utf8');
    await press(cdp, 'z');
    await waitEditChange(beforeCutUndo);
    assert.equal(JSON.stringify(await readEdit()), JSON.stringify(JSON.parse(before)), '⌘X の ⌘Z で戻らない');
    record('⌘X で切り取り → ⌘Z で戻る', {
        cutFooter, restored: allItems(await readEdit()).filter(item => item.id === duplicated[0].id),
        screenshot: await shot(cdp, '09-cut-undo.png')
    });
} catch (error) {
    // 失敗時は必ず「そのときの edit.json とフッター」を証跡に残す（原因追跡のため）。
    let snapshot;
    try {
        const doc = await readEdit();
        snapshot = { footer: cdp ? await footerText(cdp).catch(() => null) : null,
            tracks: doc.tracks.map(track => ({ id: track.id, items: itemsOf(doc, track.id) })) };
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
    // 孤児が残っていないことをプロファイルのパスで確認する（wrapper-codex.md の後始末規律）。
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
