// L1 ドライバ: タイムラインのホバーポップアップ（遅延 2000ms / 上限 320px / 字幕の見た目）。
//
//   node apps/shell/extensions/akari-annotations/evidence/hover-popup-captions/run-l1.mjs [--out <dir>]
//
// 前提: `cd apps/shell && npm run build`（electron 実体 + バンドルが要る）。
// 隔離ワークスペースは OS の一時ディレクトリへ作り、終了時に消す。
// Electron は detached にせず、finally で PID 指名 kill する（孤児プロセス事故の再発防止）。
// 絶対パスはリポジトリ位置と os.tmpdir() から導出する（証跡へ作業機のパスを焼き込まないため）。
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../../../../..');
const SHELL = join(REPO, 'apps/shell');
const PORT = Number(process.env.AKARI_L1_PORT ?? 9411);
const outIndex = process.argv.indexOf('--out');
const OUT = outIndex > 0 ? resolve(process.argv[outIndex + 1]) : mkdtempSync(join(realpathSync(tmpdir()), 'akari-l1-out-'));
const WS = mkdtempSync(join(realpathSync(tmpdir()), 'akari-l1-hover-'));
mkdirSync(OUT, { recursive: true });

const { chromium } = await import(join(REPO, 'node_modules/playwright-core/index.mjs'));

// 隔離ワークスペース: 雛形 + 本ディレクトリの fixture（captions.json は各行に src を持つ）。
cpSync(join(REPO, 'templates/project-default'), WS, { recursive: true });
mkdirSync(join(WS, 'assets'), { recursive: true });
mkdirSync(join(WS, 'overlays'), { recursive: true });
mkdirSync(join(WS, '.theia'), { recursive: true });
cpSync(join(REPO, 'dev-fixtures/overlay-html-slots/assets/photo-a.png'), join(WS, 'assets/photo-a.png'));
cpSync(join(REPO, 'dev-fixtures/overlay-html-slots/overlays/chapter-tag.html'), join(WS, 'overlays/chapter-tag.html'));
cpSync(join(HERE, 'fixture/edit.json'), join(WS, 'edit.json'));
cpSync(join(HERE, 'fixture/captions.json'), join(WS, 'captions.json'));
// 帯サムネは既定 = 無効（2026-09-09 合流 timeline-visual-thumbnails-setting）。
// HTML 素材の帯にホバーポップアップを出すには設定で有効にする必要がある。
cpSync(join(HERE, 'fixture/theia-settings.json'), join(WS, '.theia/settings.json'));

const binary = join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
if (!existsSync(binary)) throw new Error('electron 実体が無い。apps/shell で npm run build を先に走らせる');
const profile = join(WS, '.l1-profile');
const measurements = { generatedAt: new Date().toISOString(), steps: [] };
const child = spawn(binary, [SHELL, WS, `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-sandbox'],
    { env: { ...process.env, THEIA_CONFIG_DIR: join(profile, 'theia-config') }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', () => { /* 起動ログは証跡へ残さない（作業機の絶対パスが混ざる） */ });
child.stderr.on('data', () => { /* 同上 */ });
let browser;
try {
    for (let i = 0; i < 120; i++) {
        try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch { /* 起動待ち */ }
        await sleep(500);
    }
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
    let page;
    for (let i = 0; i < 120 && !page; i++) {
        const candidate = browser.contexts().flatMap(context => context.pages()).find(item => item.url().includes('index.html'));
        if (candidate && await candidate.evaluate(() => Boolean(document.querySelector('.theia-ApplicationShell'))).catch(() => false)) {
            page = candidate;
        } else {
            await sleep(500);
        }
    }
    if (!page) throw new Error('Theia のフロントエンドに到達できない');

    // 実機ウィンドウは小さいと下パネルが潰れて帯が見出し行に隠れる。
    // ビューポートを 1600x1000 に固定し、下パネルのハンドルを上へドラッグして実寸で見える形にする。
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
    await sleep(4000);
    await page.evaluate(() => {
        const button = [...document.querySelectorAll('button')]
            .find(candidate => candidate.textContent?.trim() === 'タイムライン（下パネル）');
        if (!button) throw new Error('タイムラインを開くボタンが無い');
        button.click();
    });
    for (let i = 0; i < 60; i++) {
        if (await page.evaluate(() => document.querySelectorAll('[data-akari-item-kind="caption"]').length) > 0) break;
        await sleep(500);
    }
    await sleep(3000);
    const handle = await page.evaluate(() => {
        const found = [...document.querySelectorAll('.lm-SplitPanel-handle')]
            .find(item => item.parentElement?.id === 'theia-bottom-split-panel' && !item.classList.contains('lm-mod-hidden'));
        return found ? found.getBoundingClientRect().toJSON() : null;
    });
    if (handle) {
        const x = handle.x + handle.width / 2;
        const y = handle.y + handle.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y - 250, { steps: 12 });
        await page.mouse.up();
        await sleep(1500);
    }
    // スクショに経過時刻を焼き込む HUD（pointer-events:none なので入力へ影響しない）。
    await page.evaluate(() => {
        const hud = document.createElement('div');
        hud.id = 'akari-l1-hud';
        Object.assign(hud.style, { position: 'fixed', top: '0', right: '0', zIndex: '2147483647',
            pointerEvents: 'none', background: '#000', color: '#0f0', font: '15px monospace', padding: '5px 12px' });
        document.body.append(hud);
    });
    const hud = text => page.evaluate(value => { document.getElementById('akari-l1-hud').textContent = value; }, text);

    measurements.env = await page.evaluate(() => ({
        innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio,
        chips: [...document.querySelectorAll('[data-akari-visual-hover-installed="true"]')].map(element => ({
            kind: element.dataset.akariItemKind, id: element.dataset.akariItemId,
            hasImage: Boolean(element.querySelector('.akari-visual-thumbnail-image')),
            rect: element.getBoundingClientRect().toJSON()
        }))
    }));
    await hud('L1 開始状態（ホバーなし）');
    await page.screenshot({ path: join(OUT, 's0-timeline.png') });

    const popupState = () => page.evaluate(() => {
        const popup = document.querySelector('[data-akari-visual-thumbnail-hover="true"]');
        if (!popup) return { present: false };
        const preview = popup.querySelector('.akari-caption-hover-preview');
        const caption = popup.querySelector('.akari-caption');
        const plate = popup.querySelector('.akari-caption__plate');
        const line = popup.querySelector('.akari-caption__line');
        const captionStyle = caption ? getComputedStyle(caption) : undefined;
        return {
            present: true,
            popupRect: popup.getBoundingClientRect().toJSON(),
            image: popup.querySelector('img')?.getBoundingClientRect().toJSON() ?? null,
            nameLine: popup.lastElementChild?.textContent ?? null,
            captionPreview: preview ? {
                rect: preview.getBoundingClientRect().toJSON(),
                background: getComputedStyle(preview).backgroundColor,
                lines: [...popup.querySelectorAll('.akari-caption__line')].map(node => node.textContent),
                color: captionStyle?.color, fontSize: captionStyle?.fontSize,
                fontFamily: captionStyle?.fontFamily, textShadow: captionStyle?.textShadow,
                plateRect: plate?.getBoundingClientRect().toJSON() ?? null,
                plateComputedTop: plate ? getComputedStyle(plate).top : null,
                plateComputedBottom: plate ? getComputedStyle(plate).bottom : null,
                lineBackground: line ? getComputedStyle(line).backgroundColor : null,
                lineRect: line?.getBoundingClientRect().toJSON() ?? null
            } : null
        };
    });
    const center = selector => page.evaluate(value => {
        const element = document.querySelector(value);
        if (!element) throw new Error(`要素が無い: ${value}`);
        const rect = element.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);
        const top = document.elementFromPoint(x, y);
        return { x, y, rect: rect.toJSON(), topIsTarget: element === top || element.contains(top) };
    }, selector);

    /** 1 回の連続ホバーで「1.5 秒では出ない」「2.2 秒で出る」を両方測る。 */
    async function continuousHover({ name, selector, label, shots }) {
        await page.mouse.move(5, 5);
        await sleep(500);
        const point = await center(selector);
        const started = Date.now();
        const elapsed = () => Date.now() - started;
        await page.mouse.move(point.x, point.y);
        // 撮影は 1 枚 0.3〜0.7 秒かかる。遅延 2000ms に到達する前に撮り終える必要があるので
        // 1150ms で撮り始め、撮り終えてから 1500ms まで待って「1.5 秒時点で出ていない」を確定する。
        await sleep(Math.max(0, 1150 - elapsed()));
        await hud(`${label} — ホバー 1.5 秒前後（遅延 2000ms 到達前）: ポップアップなし`);
        const shotEarlyStart = elapsed();
        await page.screenshot({ path: join(OUT, shots.early) });
        const shotEarlyEnd = elapsed();
        await sleep(Math.max(0, 1500 - elapsed()));
        const early = await popupState();
        const earlyCheckedAt = elapsed();
        await sleep(Math.max(0, 2200 - elapsed()));
        const late = await popupState();
        const lateCheckedAt = elapsed();
        await hud(`${label} — ホバー ${lateCheckedAt}ms: ポップアップ表示`);
        await page.screenshot({ path: join(OUT, shots.late) });
        const record = { name, selector, point, earlyCheckedAt, shotEarlyStart, shotEarlyEnd,
            earlyShotBeforeDelay: shotEarlyEnd < 2000, lateCheckedAt, early, late, shots };
        measurements.steps.push(record);
        return record;
    }

    const htmlChip = measurements.env.chips.find(chip => chip.hasImage);
    if (!htmlChip) throw new Error('HTML 素材の帯（サムネ付き）が見つからない');
    const html = await continuousHover({ name: 'a-html', label: 'HTML 素材の帯をホバー',
        selector: `[data-akari-item-id="${htmlChip.id}"][data-akari-visual-hover-installed="true"]`,
        shots: { early: 'a1-html-hover-under-2s-none.png', late: 'a2-html-hover-2200ms-shown.png' } });
    const caption = await continuousHover({ name: 'c-caption-styled', label: '字幕チップ c-0001 をホバー',
        selector: '[data-akari-item-kind="caption"][data-akari-item-id="c-0001"]',
        shots: { early: 'c1-caption-hover-under-2s-none.png', late: 'c2-caption-hover-2200ms-shown.png' } });
    if (caption.late.captionPreview) {
        const rect = caption.late.popupRect;
        await page.screenshot({ path: join(OUT, 'c3-caption-popup-crop.png'),
            clip: { x: Math.max(0, rect.x - 6), y: Math.max(0, rect.y - 6), width: rect.width + 12, height: rect.height + 12 } });
    }
    const captionDefault = await continuousHover({ name: 'c-caption-default',
        label: '字幕チップ c-0002（既定スタイル）をホバー',
        selector: '[data-akari-item-kind="caption"][data-akari-item-id="c-0002"]',
        shots: { early: 'c4-caption-default-under-2s-none.png', late: 'c5-caption-default-2200ms-shown.png' } });

    await page.mouse.move(5, 5);
    await sleep(120);
    measurements.afterLeave = await popupState();

    const { innerWidth, innerHeight } = measurements.env;
    const oldLimit = Math.min(480, innerWidth * 0.4, innerHeight * 0.6);
    const newLimit = Math.min(320, innerWidth * 0.27, innerHeight * 0.4);
    measurements.limits = { innerWidth, innerHeight, oldLimit, newLimit, twoThirdsOfOldLimit: oldLimit * (2 / 3),
        htmlPopupImageWidth: html.late.image?.width, htmlPopupImageHeight: html.late.image?.height,
        htmlPopupWidth: html.late.popupRect?.width,
        captionPreviewWidth: caption.late.captionPreview?.rect.width,
        captionPreviewHeight: caption.late.captionPreview?.rect.height };
    measurements.verdicts = {
        'a HTML: 2.0 秒未満では出ない': html.early.present === false && html.earlyCheckedAt >= 1500 && html.earlyCheckedAt < 2000,
        'a HTML: 1.5 秒時点の撮影が遅延到達前に完了': html.earlyShotBeforeDelay,
        'a HTML: 2.2 秒で出る': html.late.present === true,
        'b 幅が旧上限の 2/3 以下': (html.late.image?.width ?? Infinity) <= oldLimit * (2 / 3) + 1e-6,
        'b 字幕ポップアップも同じ上限': (caption.late.captionPreview?.rect.width ?? Infinity) <= oldLimit * (2 / 3) + 1e-6,
        'c 字幕: 2.0 秒未満では出ない': caption.early.present === false
            && caption.earlyCheckedAt >= 1500 && caption.earlyCheckedAt < 2000,
        'c 字幕: 1.5 秒時点の撮影が遅延到達前に完了': caption.earlyShotBeforeDelay,
        'c 字幕: 2.2 秒で見た目のポップアップ': Boolean(caption.late.captionPreview),
        'c 本文が入っている': (caption.late.captionPreview?.lines ?? []).join('') === 'ホバーで見た目が出る字幕',
        'c 色が text_style どおり(#ffdd33)': caption.late.captionPreview?.color === 'rgb(255, 221, 51)',
        'c 上ゾーンが枠内上部': Boolean(caption.late.captionPreview)
            && caption.late.captionPreview.plateRect.y - caption.late.captionPreview.rect.y
                < caption.late.captionPreview.rect.height / 2,
        'c 背景は暗い無地': caption.late.captionPreview?.background === 'rgb(0, 0, 0)',
        'c 既定スタイルの字幕でも出る': Boolean(captionDefault.late.captionPreview),
        'd ポインタ離脱で即消える': measurements.afterLeave.present === false
    };
} finally {
    writeFileSync(join(OUT, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
    try { await browser?.close(); } catch { /* 既に落ちている */ }
    if (!child.killed) {
        child.kill('SIGTERM');
        await sleep(1500);
        if (child.exitCode === null) child.kill('SIGKILL');
    }
    await sleep(1000);
    rmSync(WS, { recursive: true, force: true });
}
const verdicts = JSON.parse(readFileSync(join(OUT, 'measurements.json'), 'utf8')).verdicts ?? {};
console.log(JSON.stringify(verdicts, null, 2));
console.log(Object.values(verdicts).every(Boolean) ? 'L1 PASS' : 'L1 FAIL');
process.exit(Object.values(verdicts).every(Boolean) && Object.keys(verdicts).length > 0 ? 0 : 1);
