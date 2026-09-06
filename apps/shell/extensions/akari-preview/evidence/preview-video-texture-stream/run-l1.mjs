#!/usr/bin/env node
// L1 実機検証（Electron tier 2 + CDP）— shell のライブプレビューで 3D 断片の動画テクスチャが
// VideoTexture 経路で描かれるかを、asset stream の URL 形式ごと（BEFORE / AFTER）に実測する。
//
// 使い方（worktree の apps/shell を `npm run build` した直後に走らせる）:
//   node run-l1.mjs --mode before        # 分岐点 main のビルドで実行
//   node run-l1.mjs --mode after         # 本ブランチのビルドで実行
//
// 前提:
//   - Electron 実体 = <repo>/node_modules/electron/dist（tier 2・path.txt 敷設済み）
//   - フィクスチャは毎回スクラッチ（mkdtemp。空白 + 日本語入りパス）に作る。リポジトリ・
//     オーナー案件へは一切書き込まない（3D 素材と断片 HTML は読み取りコピーのみ）
//   - puppeteer-core は worktree ルートの node_modules から解決する
//
// 出力: この証跡ディレクトリの results.json（BEFORE / AFTER をキーで併記）と PNG。
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const evidenceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(evidenceDir, '../../../../../..');
const shellDir = path.join(repoRoot, 'apps', 'shell');
const electronBin = path.join(repoRoot, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const ownerProject = process.env.AKARI_OWNER_PROJECT
    ?? path.join(homedir(), 'Akari', 'channels', 'my-channel', 'videos', '2026-08-07-akari-reel');

const require = createRequire(path.join(repoRoot, 'package.json'));
const puppeteer = require('puppeteer-core');

const argv = process.argv.slice(2);
const argOf = name => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
};
const mode = argOf('--mode') ?? 'after';
if (mode !== 'before' && mode !== 'after') {
    throw new Error('usage: run-l1.mjs --mode before|after [--port 9743] [--keep]');
}
const cdpPort = Number(argOf('--port') ?? (mode === 'before' ? 9743 : 9744));
const keepScratch = argv.includes('--keep');

const log = [];
const record = (step, detail = {}) => {
    const entry = { at: new Date().toISOString(), step, ...detail };
    log.push(entry);
    console.log(`[${step}]`, JSON.stringify(detail));
};

// ---------------------------------------------------------------- フィクスチャ

const EDIT_JSON = {
    version: 2,
    output: { width: 1080, height: 1920, fps: 30 },
    sources: [{ id: 'base', path: 'assets/source/base.mp4', proxy: null }],
    tracks: [
        {
            id: 't1',
            lane: 'visual',
            items: [
                { id: 'cut-1', at: 0, duration: 180, source: { kind: 'media', src: 'base', in: 0, out: 6 } }
            ]
        },
        {
            id: 't2',
            lane: 'visual',
            items: [
                { id: 'phone', at: 30, duration: 120, source: { kind: 'html', path: 'overlays/phone.html' } }
            ]
        },
        {
            id: 't3',
            lane: 'visual',
            items: [
                { id: 'appicon', at: 30, duration: 120, source: { kind: 'html', path: 'overlays/appicon.html' } }
            ]
        }
    ]
};

async function prepareFixture() {
    const scratch = await mkdtemp(path.join(tmpdir(), 'akari l1 検証-'));
    const project = path.join(scratch, 'プレビュー 検証プロジェクト');
    for (const dir of ['assets/source', 'assets/scene3d/phone', 'assets/scene3d/app-icon', 'overlays', 'exports']) {
        await mkdir(path.join(project, dir), { recursive: true });
    }
    await cp(path.join(repoRoot, 'templates', 'project-default', '.akari'), path.join(project, '.akari'), { recursive: true });

    await execFileAsync('ffmpeg', [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=440',
        '-t', '6',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest',
        path.join(project, 'assets/source/base.mp4')
    ]);

    // オーナー案件からの読み取りコピー（原本無改変）
    const copies = [
        ['assets/scene3d/phone/model.glb', 'assets/scene3d/phone/model.glb'],
        ['assets/scene3d/phone/screen.mp4', 'assets/scene3d/phone/screen.mp4'],
        ['assets/scene3d/app-icon/model.glb', 'assets/scene3d/app-icon/model.glb'],
        ['assets/scene3d/app-icon/icon.png', 'assets/scene3d/app-icon/icon.png'],
        ['overlays/panel-12.html', 'overlays/phone.html'],
        ['overlays/appicon-free.html', 'overlays/appicon.html']
    ];
    for (const [from, to] of copies) {
        await copyFile(path.join(ownerProject, from), path.join(project, to));
    }

    await writeFile(path.join(project, 'edit.json'), `${JSON.stringify(EDIT_JSON, null, 2)}\n`, 'utf8');
    record('fixture-ready', { scratch, project });
    return { scratch, project };
}

// ---------------------------------------------------------------- Electron 起動

async function launchShell(project, userDataDir, logPath) {
    const child = spawn(electronBin, [
        shellDir,
        project,
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${userDataDir}`,
        '--no-sandbox',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
    ], {
        cwd: shellDir,
        env: { ...process.env, THEIA_CONFIG_DIR: userDataDir },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false
    });
    const chunks = [];
    child.stdout.on('data', data => chunks.push(data));
    child.stderr.on('data', data => chunks.push(data));
    const flush = async () => writeFile(logPath, Buffer.concat(chunks));
    return { child, flush };
}

async function waitForCdp(timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(10_000) });
            if (response.ok) return await response.json();
        } catch {
            // Electron はまだ listen していない
        }
        await sleep(500);
    }
    throw new Error('CDP endpoint did not come up');
}

// ---------------------------------------------------------------- CDP ヘルパ

const waitFor = async (description, fn, timeoutMs = 120_000, intervalMs = 300) => {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
        try {
            last = await fn();
            if (last) return last;
        } catch (error) {
            last = { error: String(error) };
        }
        await sleep(intervalMs);
    }
    throw new Error(`timed out waiting for ${description}: ${JSON.stringify(last)}`);
};

async function waitForInteractive(page) {
    const started = Date.now();
    let ready = false;
    try {
        await waitFor('Theia 起動オーバーレイの消失', () => page.evaluate(
            `document.querySelector('.theia-preload') === null`), 300_000);
        ready = true;
    } finally {
        record('theia-interactive-wait', { waitedMs: Date.now() - started, ready });
    }
}

async function centerOf(page, expression) {
    return page.evaluate(`(() => {
        const element = ${expression};
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
}

async function click(page, point, clickCount = 1) {
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y, { clickCount, delay: 40 });
}

async function enableDeveloperMode(page) {
    await waitForInteractive(page);
    const gear = await waitFor('AKARI 設定の歯車', () => centerOf(page,
        `Array.from(document.querySelectorAll('.codicon-settings-gear')).find(e => e.getBoundingClientRect().width > 0)`));
    await click(page, gear);
    await sleep(3_000);
    await waitForInteractive(page);
    const checkbox = await waitFor('developer mode チェックボックス', () => page.evaluate(`(() => {
        const cb = document.querySelector('input[type="checkbox"]');
        if (!cb) return null;
        const r = cb.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, checkedBefore: cb.checked };
    })()`));
    if (!checkbox.checkedBefore) {
        await click(page, checkbox);
        await waitFor('developer mode が on', () => page.evaluate(
            `document.querySelector('input[type="checkbox"]')?.checked === true`));
    }
    await waitForInteractive(page);
    const files = await waitFor('Explorer アイコン', () => centerOf(page,
        `Array.from(document.querySelectorAll('.codicon-files')).find(e => e.getBoundingClientRect().width > 0)`));
    await click(page, files);
    await sleep(3_000);
    return { developerMode: true, wasEnabled: checkbox.checkedBefore };
}

// 行の位置は出力が増えると変わるため、毎回矩形と最前面の要素を同時に調べる。
async function outputRowClickPoint(page) {
    await waitForInteractive(page);
    return waitFor('編集データ行のクリック可能な位置', () => page.evaluate(`(() => {
        if (document.querySelector('.theia-preload')) return null;
        const row = document.querySelector('[data-akari-output-path="edit.json"]');
        if (!row) return null;
        const rect = row.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const hit = document.elementFromPoint(x, y)?.closest('[data-akari-output-path="edit.json"]');
        return hit === row ? { x, y } : null;
    })()`), 300_000);
}

async function waitForPreviewWebview(page) {
    return waitFor('クリック後の preview webview 出現', async () => {
        if (await page.evaluate(`Boolean(document.querySelector('iframe.webview'))`)) return true;
        for (const frame of page.frames()) {
            if (await frame.evaluate(`Boolean(document.getElementById('preview-stage'))`).catch(() => false)) return true;
        }
        return false;
    }, 60_000, 500);
}

// 初回 + 最大 3 回の再クリック。各回で座標を取り直し、60 秒以内の webview 出現を確認する。
// 実クリックで開けなければ element.click()、最後に Explorer で再試行する。
async function openEditJson(page) {
    const outputRow = `document.querySelector('[data-akari-output-path="edit.json"]')`;
    const row = await waitFor('編集データ（edit.json）の行', () => centerOf(page, outputRow), 300_000)
        .catch(error => {
            record('assets-panel-row-unavailable', { error: String(error) });
            return null;
        });
    if (row) {
        for (let attempt = 1; attempt <= 4; attempt++) {
            let point;
            try {
                point = await outputRowClickPoint(page);
            } catch (error) {
                record('assets-panel-hit-test-failed', { attempt, error: String(error) });
                break;
            }
            try {
                await click(page, point, 2);
                record('edit-json-click-attempt', { via: 'assets-panel-real-mouse', attempt, ...point });
                await waitForPreviewWebview(page);
                const frame = await findPreviewFrame(page);
                record('edit-json-opened', { via: 'assets-panel-real-mouse', attempt, ...point });
                return frame;
            } catch (error) {
                record('assets-panel-real-mouse-failed', { attempt, error: String(error) });
            }
        }
        try {
            await waitForInteractive(page);
            await page.evaluate(`(() => {
                const row = ${outputRow};
                if (!row) throw new Error('edit.json output row disappeared');
                row.click();
            })()`);
            record('edit-json-click-attempt', { via: 'assets-panel-element-click' });
            const frame = await findPreviewFrame(page);
            record('edit-json-opened', { via: 'assets-panel-element-click' });
            return frame;
        } catch (error) {
            record('preview-explorer-fallback', { error: String(error) });
        }
    }
    await enableDeveloperMode(page);
    await waitForInteractive(page);
    const treeRow = await waitFor('edit.json のツリー行', () => centerOf(page,
        `Array.from(document.querySelectorAll('.theia-TreeNode')).find(e => e.textContent?.trim() === 'edit.json')`), 300_000);
    await click(page, treeRow, 2);
    const frame = await findPreviewFrame(page);
    record('edit-json-opened', { via: 'explorer-tree', ...treeRow });
    return frame;
}

async function previewFrameDiagnostics(page) {
    // ナビゲーション中や破棄済みのフレームも URL と評価エラーを残す。
    const frames = await Promise.all(page.frames().map(async frame => {
        const url = frame.url();
        try {
            return { url, ...await frame.evaluate(`({
                previewStage: Boolean(document.getElementById('preview-stage')),
                akari: Boolean(window.akari),
                readyState: document.readyState,
                bodyLength: document.body?.innerHTML.length ?? 0
            })`) };
        } catch (error) {
            return { url, previewStage: null, akari: null, readyState: null, bodyLength: null, error: String(error) };
        }
    }));
    const iframes = await page.evaluate(`Array.from(document.querySelectorAll('iframe')).map(element => {
        const rect = element.getBoundingClientRect();
        return { src: element.src, class: element.className, width: rect.width, height: rect.height };
    })`).catch(error => ({ error: String(error) }));
    return { frames, iframes };
}

async function findPreviewFrame(page) {
    try {
        return await waitFor('プレビュー webview フレーム', async () => {
            // fake.html / index.html を区別せず、webview のフレームから優先して探す。
            const frames = page.frames().sort((a, b) =>
                Number(b.url().includes('/webview/')) - Number(a.url().includes('/webview/')));
            for (const frame of frames) {
                const ok = await frame.evaluate(
                    `Boolean(document.getElementById('preview-stage'))`
                ).catch(() => false);
                if (ok) return frame;
            }
            return null;
        }, 300_000, 500);
    } catch (error) {
        const diagnostics = await previewFrameDiagnostics(page)
            .catch(diagnosticError => ({ error: String(diagnosticError) }));
        record('preview-frame-search-failed', { diagnostics });
        throw new Error(`${String(error)}; preview diagnostics: ${JSON.stringify(diagnostics)}`, { cause: error });
    }
}

// webview 内に console フック（[akari-three] の失敗行を確実に拾う。Theia webview の
// console は主フレームの page.on('console') に上がらないことがある — harness/README.md）。
const CONSOLE_HOOK = `(() => {
    if (window.__akariL1Console) return 'already';
    window.__akariL1Console = [];
    for (const level of ['log', 'info', 'warn', 'error']) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            try {
                window.__akariL1Console.push({
                    level,
                    text: args.map(a => {
                        if (typeof a === 'string') return a;
                        if (a instanceof Error) return a.message;
                        if (a && typeof a === 'object') return a.constructor?.name ?? Object.prototype.toString.call(a);
                        return String(a);
                    }).join(' ')
                });
            } catch {}
            original(...args);
        };
    }
    return 'installed';
})()`;

const seekTo = seconds => `(async () => {
    const seek = document.getElementById('seek');
    seek.value = String(${seconds});
    seek.dispatchEvent(new Event('input', { bubbles: true }));
    seek.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 2_000));
    return Number(seek.value);
})()`;

// 3D 断片のコンテナ = overlay-runtime が threeRuntime.render() に渡す [data-overlay-id] 要素。
const measure = (overlayId, overlayStartSeconds, timelineSeconds) => `(() => {
    const container = document.querySelector('[data-overlay-id="${overlayId}"]');
    if (!container) return { present: false };
    const inspect = window.akari?.threeRuntime?.inspect(container) ?? { status: 'no-runtime' };
    const fallback = container.querySelector('[data-akari-3d-fallback]');
    const sceneScript = container.querySelector('script[data-akari-3d-scene]');
    let declaration = null;
    try { declaration = JSON.parse(sceneScript?.textContent ?? 'null'); } catch { declaration = 'unparsable'; }
    const canvas = container.querySelector('canvas');
    return {
        present: true,
        status: inspect.status,
        videoTextures: inspect.videoTextures ?? null,
        animationClips: inspect.animationClips ?? null,
        materialOverrides: inspect.materialOverrides ?? null,
        fallbackVisible: fallback ? fallback.checkVisibility() : null,
        fallbackHiddenAttr: fallback ? fallback.hidden : null,
        containerVisible: container.checkVisibility(),
        canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
        declaredTextures: declaration && declaration !== 'unparsable'
            ? Object.fromEntries(Object.entries(declaration.materialOverrides ?? {})
                .map(([name, value]) => [name, value?.texture ?? null]))
            : declaration,
        declaredModel: declaration && declaration !== 'unparsable' ? declaration.model : null,
        overlayStart: ${overlayStartSeconds},
        timelineTime: ${timelineSeconds}
    };
})()`;

// canvas の画素ハッシュ（FNV-1a 32bit）。render() 直後に drawImage で複製して読む
// （evidence/preview-3d/README.md の流儀）。2 倍拡大 PNG も同時に返す。
const canvasProbe = (overlayId, localSeconds, wantPng) => `(() => {
    const container = document.querySelector('[data-overlay-id="${overlayId}"]');
    if (!container) return null;
    const canvas = container.querySelector('canvas');
    if (!canvas) return null;
    // preserveDrawingBuffer は false なので、同じタスク内で render() 直後に複製する
    // （evidence/preview-3d/README.md の流儀）。maxRenderSize はライブ tick と同じ 720。
    try {
        window.akari.threeRuntime.render(container, ${localSeconds}, { syncVideos: true, maxRenderSize: 720 });
    } catch (error) {
        return { error: String(error) };
    }
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let hash = 0x811c9dc5;
    let nonTransparent = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 0) nonTransparent++;
        for (let c = 0; c < 4; c++) {
            hash ^= data[i + c];
            hash = Math.imul(hash, 0x01000193) >>> 0;
        }
    }
    let png = null;
    if (${wantPng ? 'true' : 'false'}) {
        const scaled = document.createElement('canvas');
        scaled.width = copy.width * 2;
        scaled.height = copy.height * 2;
        const sctx = scaled.getContext('2d');
        sctx.imageSmoothingEnabled = false;
        sctx.drawImage(copy, 0, 0, scaled.width, scaled.height);
        png = scaled.toDataURL('image/png');
    }
    return { hash: hash.toString(16).padStart(8, '0'), nonTransparent, width: copy.width, height: copy.height, png };
})()`;

// 舞台（base.mp4）が真っ黒でないことの確認。frame-engine が有効なら合成 canvas を、
// 無効なら #preview-video を drawImage して非黒画素を数える。
const STAGE_PROBE = `(() => {
    const stage = document.getElementById('preview-stage');
    const video = document.getElementById('preview-video');
    const frameEngineActive = stage?.dataset.frameEngineActive === 'true';
    const sample = source => {
        const copy = document.createElement('canvas');
        copy.width = 160;
        copy.height = 284;
        const ctx = copy.getContext('2d');
        ctx.drawImage(source, 0, 0, copy.width, copy.height);
        const data = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let nonBlack = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 12 || data[i + 1] > 12 || data[i + 2] > 12) nonBlack++;
        }
        return { nonBlack, total: copy.width * copy.height };
    };
    const stageCanvas = Array.from(stage?.querySelectorAll('canvas') ?? [])
        .find(c => c.width >= 200 && !c.closest('[data-overlay-id]'));
    let pixels = null;
    let from = null;
    try {
        if (frameEngineActive && stageCanvas) { pixels = sample(stageCanvas); from = 'frame-engine-canvas'; }
        else if (video && video.videoWidth > 0) { pixels = sample(video); from = 'preview-video'; }
    } catch (error) {
        pixels = { error: String(error) };
    }
    return {
        frameEngineActive,
        from,
        pixels,
        video: video ? {
            readyState: video.readyState,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            currentTime: Number(video.currentTime.toFixed(3)),
            error: video.error ? video.error.code : null
        } : null,
        stageCanvasSize: stageCanvas ? { width: stageCanvas.width, height: stageCanvas.height } : null
    };
})()`;

async function writeDataUrlPng(dataUrl, filePath) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) return false;
    await writeFile(filePath, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
    return true;
}

// ---------------------------------------------------------------- 本体

const scratchState = { scratch: null };
let electron;
let browser;
const result = { mode, at: new Date().toISOString() };

try {
    const { scratch, project } = await prepareFixture();
    scratchState.scratch = scratch;
    const userDataDir = path.join(scratch, 'user-data');
    await mkdir(userDataDir, { recursive: true });
    const electronLogPath = path.join(scratch, 'electron.log');

    electron = await launchShell(project, userDataDir, electronLogPath);
    const version = await waitForCdp();
    record('cdp-up', { product: version.Browser });

    browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${cdpPort}`, defaultViewport: null, protocolTimeout: 600_000 });
    const page = await waitFor('Theia 主ページ', async () => {
        const pages = await browser.pages();
        for (const candidate of pages) {
            const ready = await candidate.evaluate(() => document.readyState === 'complete'
                && Boolean(document.querySelector('.lm-Widget'))).catch(() => false);
            if (ready) return candidate;
        }
        return null;
    }, 600_000, 500);
    await page.bringToFront();
    const pageConsole = [];
    page.on('console', message => pageConsole.push({ level: message.type(), text: message.text() }));
    record('main-page-ready', { url: page.url() });

    const frame = await openEditJson(page);
    record('preview-frame-found', { url: frame.url().slice(0, 80) });

    await frame.evaluate(CONSOLE_HOOK);

    // 3D 断片が mount されるまで（overlay は可視区間に入って初めて mount される）
    await frame.evaluate(seekTo(2.0));
    await waitFor('phone コンテナの mount', () => frame.evaluate(
        `Boolean(document.querySelector('[data-overlay-id="phone"]'))`), 180_000);
    // 一度 t=0（区間外 = dispose）へ戻し、console フックを入れた状態で読み込みをやり直させる。
    await frame.evaluate(seekTo(0));
    await sleep(4_000);
    await frame.evaluate(seekTo(2.0));
    // ロード完了（ready or error）まで待つ
    const settled = await waitFor('3D シーンの status 確定', () => frame.evaluate(`(() => {
        const container = document.querySelector('[data-overlay-id="phone"]');
        if (!container) return null;
        const status = window.akari.threeRuntime.inspect(container).status;
        return status === 'ready' || status === 'error' ? status : null;
    })()`), 180_000, 400);
    record('three-status-settled', { status: settled });
    await sleep(6_000);

    const phone = await frame.evaluate(measure('phone', 1.0, 2.0));
    const appicon = await frame.evaluate(measure('appicon', 1.0, 2.0));
    const stage = await frame.evaluate(STAGE_PROBE);
    const consoleLines = await frame.evaluate(`window.__akariL1Console.slice(-200)`);
    const threeLines = consoleLines.filter(line => line.text.includes('[akari-three]'));
    record('measured', { phone, appicon, stageFrom: stage.from, threeLines });

    const canvasAt2 = await frame.evaluate(canvasProbe('phone', 1.0, mode === 'after'));
    await frame.evaluate(seekTo(3.5));
    await sleep(4_500);
    const phoneAt35 = await frame.evaluate(measure('phone', 1.0, 3.5));
    const canvasAt35 = await frame.evaluate(canvasProbe('phone', 2.5, false));
    const stageAt35 = await frame.evaluate(STAGE_PROBE);

    // スクリーンショット
    if (mode === 'before') {
        await frame.evaluate(seekTo(2.0));
        await sleep(3_500);
        await page.screenshot({ path: path.join(evidenceDir, 'before-phone-error.png') });
    } else {
        await page.screenshot({ path: path.join(evidenceDir, 'after-t3.5.png') });
        await frame.evaluate(seekTo(2.0));
        await sleep(3_500);
        await page.screenshot({ path: path.join(evidenceDir, 'after-phone-ready.png') });
        if (canvasAt2?.png) {
            await writeDataUrlPng(canvasAt2.png, path.join(evidenceDir, 'after-phone-canvas-2x.png'));
        }
    }
    if (canvasAt2) delete canvasAt2.png;

    Object.assign(result, {
        electron: version.Browser,
        phoneAt2: phone,
        appiconAt2: appicon,
        phoneAt35,
        stageAt2: stage,
        stageAt35,
        canvasAt2,
        canvasAt35,
        canvasHashesDiffer: Boolean(canvasAt2 && canvasAt35 && canvasAt2.hash !== canvasAt35.hash),
        threeConsoleLines: threeLines,
        pageConsoleAkariThree: pageConsole.filter(line => line.text.includes('akari-three')),
        ok: true
    });
} catch (error) {
    result.ok = false;
    result.error = String(error?.stack ?? error);
    record('FAILED', { error: result.error });
} finally {
    try { await browser?.disconnect(); } catch { /* 既に落ちている */ }
    if (electron) {
        try { await electron.flush(); } catch { /* ログ書き出し失敗は致命ではない */ }
        try { electron.child.kill('SIGTERM'); } catch { /* 既に終了 */ }
        const deadline = Date.now() + 60_000;
        while (electron.child.exitCode === null && electron.child.signalCode === null && Date.now() < deadline) await sleep(200);
        try { electron.child.kill('SIGKILL'); } catch { /* 既に終了 */ }
    }
    if (scratchState.scratch && !keepScratch) {
        try {
            await rm(scratchState.scratch, { recursive: true, force: true });
        } catch (error) {
            record('scratch-cleanup-failed', { error: String(error) });
        }
    }
}

result.log = log;
const resultsPath = path.join(evidenceDir, 'results.json');
let previous = {};
try { previous = JSON.parse(await readFile(resultsPath, 'utf8')); } catch { previous = {}; }
previous[mode] = result;
await writeFile(resultsPath, `${JSON.stringify(previous, null, 2)}\n`, 'utf8');
console.log(`results -> ${resultsPath}`);
process.exit(result.ok ? 0 : 1);
