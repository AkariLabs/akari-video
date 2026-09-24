// L1: 棚の見本と文字へのフォント適用。apps/shell の build 済み Electron を直起動する。
// 使い方: node run-l1.mjs before|after。CDP は L1_CDP_PORT（既定 9551）。
// 棚の属性: [data-akari-lut-preview] img、[data-akari-transition-strip] > [data-akari-transition-frame] ×3、
// [data-akari-transition-hover-strip]（5 コマ）、[data-akari-library-text-look-row]、
// [data-akari-text-look-section="style|motion|font"]、[data-akari-font-card="<id>"]（img または fallback）、
// [data-akari-textanim-sample]。既存: [data-akari-catalog-preset-item]、[data-akari-library-transition]、
// [data-akari-catalog-item]、[data-akari-library-home]、[data-akari-library-primary-tile]。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const mode = process.argv[2];
if (mode !== 'before' && mode !== 'after') throw new Error('Usage: node run-l1.mjs before|after');
const repo = resolve(import.meta.dirname, '../../../../../..');
const shell = join(repo, 'apps/shell');
const electron = join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE || join(repo, 'node_modules/playwright-core'));
const port = Number(process.env.L1_CDP_PORT || 9551);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid L1_CDP_PORT');
const out = join(import.meta.dirname, mode);
const temp = await mkdtemp(join(tmpdir(), `libcanvas-v2-shelf-visuals-${mode}-`));
const project = join(temp, 'project');
const observations = { mode, port, passed: false, checks: {}, screenshots: [] };
let child, browser, stderr = '';

function sanitize(value) {
    return String(value).replaceAll(temp, '<fixture>')
        .replace(/\/(?:private\/)?(?:var|tmp)\/[^\s'"<>\\]*/g, '<tmp>')
        .replace(/\/Users\/[^\s'"<>\\]*/g, '<local>')
        .replace(/(?:[A-Za-z]:\\\\)[^\s'"<>\\]*/g, '<local>')
        .replaceAll(['akari-video', 'wt'].join('-'), '<worktree>');
}
function sanitizeValue(value) {
    if (typeof value === 'string') return sanitize(value);
    if (Array.isArray(value)) return value.map(sanitizeValue);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item)]));
    return value;
}
function record(name, value) {
    const safe = sanitizeValue(value);
    observations.checks[name] = safe;
    console.log(`${name}: ${JSON.stringify(safe)}`);
}
async function waitFor(fn, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Electron exited');
        try { const value = await fn(); if (value) return value; } catch { /* renderer reload */ }
        await sleep(250);
    }
    throw new Error(`Timed out after ${timeout} ms`);
}
const SERVICES = `const c=window.theia.container;const keys=[...c._bindingDictionary._map.keys()];
const svc=(...m)=>{const k=keys.find(k=>typeof k==='function'&&m.every(n=>typeof k.prototype?.[n]==='function'));if(!k)throw new Error('missing '+m.join(','));return c.get(k)};`;
async function command(page, id, ...args) {
    return page.evaluate(`(async()=>{${SERVICES}await svc('executeCommand','getCommand').executeCommand(${JSON.stringify(id)},...${JSON.stringify(args)});return true})()`);
}
async function widgetCall(page, method, ...args) {
    return page.evaluate(`(async()=>{${SERVICES}const shell=svc('addWidget','getTabBarFor');const w=shell.widgets.find(v=>v.id==='akari-role-buckets-widget');
return w[${JSON.stringify(method)}](...${JSON.stringify(args)})})()`);
}
async function category(page, key) {
    await widgetCall(page, 'showLibraryHome');
    await widgetCall(page, 'selectLibraryCategory', key);
    await page.locator(`[data-akari-library-category="${key}"] [data-akari-library-back]`).waitFor();
    await sleep(350);
}
async function redactVisiblePaths(page, wholePage = false) {
    await page.evaluate(all => {
        const root = all ? document.body : document.querySelector('#akari-role-buckets-widget');
        if (!root) return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            node.nodeValue = node.nodeValue.replace(/\/(?:private\/)?(?:var|tmp)\/\S*|\/Users\/\S*/g, '…/project');
        }
        for (const input of root.querySelectorAll('input')) {
            if (input.type !== 'file' && /\/(?:private\/)?(?:var|tmp)\/|\/Users\//.test(input.value)) input.value = '…/project';
        }
    }, wholePage);
}
async function shot(page, name, target = 'library') {
    await mkdir(out, { recursive: true });
    await redactVisiblePaths(page, target === 'preview');
    let box;
    if (target === 'preview') {
        const preview = page.locator('[id^="akari-output-preview-"]').first();
        box = await preview.count() ? await preview.boundingBox().catch(() => null) : null;
        if (!box) box = { x: 370, y: 55, width: 890, height: 680 };
    } else {
        box = await page.locator('#akari-role-buckets-widget').boundingBox();
        if (!box || box.width < 300) throw new Error(`Library panel is too narrow: ${box?.width ?? 0}px`);
    }
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    const clip = { x: Math.max(0, box.x), y: Math.max(0, box.y),
        width: Math.min(box.width, viewport.width - Math.max(0, box.x)),
        height: Math.min(box.height, viewport.height - Math.max(0, box.y)) };
    assert.ok(clip.width > 0 && clip.height > 0, `Empty screenshot clip: ${name}`);
    await page.screenshot({ path: join(out, `${name}.png`), clip });
    observations.screenshots.push(`${mode}/${name}.png`);
}
async function scrollSection(page, selector) {
    await page.locator(selector).first().evaluate(node => node.scrollIntoView({ block: 'start', inline: 'nearest' }));
    await sleep(250);
}
async function screenWords(page) {
    return page.locator('#akari-role-buckets-widget').evaluate(node => {
        const text = node.textContent || '';
        const oldWordCount = (text.match(/スタンプ/g) || []).length;
        const newWordCount = (text.match(/イラスト/g) || []).length;
        return { oldWordCount, newWordCount, hasOldWord: oldWordCount > 0, hasNewWord: newWordCount > 0 };
    });
}
async function fixture() {
    await cp(join(repo, 'templates/project-default'), project, { recursive: true });
    // 文字を 1 件だけ持つ隔離プロジェクト。選択してフォントを当てるための席。
    await writeFile(join(project, 'edit.json'), JSON.stringify({
        version: 2, output: { width: 1920, height: 1080, fps: 30 }, sources: [],
        tracks: [{ id: 'captions-track', lane: 'visual', items: [{ id: 'captions-bag', at: 0, duration: 150,
            source: { kind: 'captions', path: 'captions.json', exclude: [] }, items: [] }] }]
    }, null, 2));
    await writeFile(join(project, 'captions.json'), JSON.stringify([{ id: 'c-l1-font', start: 0.2, end: 4.8,
        text: '文字の見本', speaker: null, sourceRef: null, edited: true, time_domain: 'output' }], null, 2));
}
async function cardImages(locator, pathPattern) {
    return locator.evaluateAll((cards, pattern) => cards.map(card => {
        const img = card.querySelector('img');
        const src = img?.getAttribute('src') || '';
        const previewPath = new RegExp(pattern).test(src);
        const fallback = !!card.querySelector('[data-akari-font-fallback]');
        return { key: card.getAttribute('data-akari-catalog-preset-item') || card.getAttribute('data-akari-font-card')
            || card.getAttribute('data-akari-catalog-item'), hasImage: !!img,
            previewPath,
            loaded: !!img && img.complete && img.naturalWidth > 0,
            fallback, source: previewPath ? 'catalog-preview' : img ? 'other-preview' : fallback ? 'fallback' : 'missing' };
    }), pathPattern);
}
async function motion(locator) {
    return locator.evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node);
        return { key: node.closest('[data-akari-library-card]')?.getAttribute('data-akari-catalog-preset-item')
            || node.closest('[data-akari-library-transition]')?.getAttribute('data-akari-library-transition'),
            animationName: style.animationName, duration: style.animationDuration, animationCount: node.getAnimations().length,
            running: node.getAnimations().some(a => a.playState === 'running'),
            backgroundImage: style.backgroundImage, backgroundPosition: style.backgroundPosition, opacity: style.opacity };
    }));
}
async function observe(page) {
    await widgetCall(page, 'showLibraryHome');
    await page.locator('[data-akari-library-home]').waitFor();
    record('homeWords', await screenWords(page));
    record('homeTiles', await page.locator('[data-akari-library-primary-tile]').evaluateAll(nodes =>
        nodes.map(n => ({ key: n.getAttribute('data-akari-library-primary-tile'), text: n.textContent.trim() }))));
    record('homeCategories', (await widgetCall(page, 'catalogCategorySummaries'))
        .filter(x => ['textstyle', 'textanim', 'font', 'stamps'].includes(x.key))
        .map(x => ({ key: x.key, label: x.label, status: x.status, count: x.count })));
    await shot(page, 'home');

    await category(page, 'lut');
    const luts = await cardImages(page.locator('[data-akari-catalog-preset-item^="lut/"]'), 'presets/luts/[^/]+/preview\\.webp');
    record('lut', { count: luts.length, cards: luts });
    await shot(page, 'lut');

    await category(page, 'transition');
    const transition = await page.locator('[data-akari-library-transition]').evaluateAll(cards => cards.map(card => ({
        id: card.getAttribute('data-akari-library-transition'), frameCount: card.querySelectorAll('[data-akari-transition-strip] > [data-akari-transition-frame]').length,
        previewImage: getComputedStyle(card.querySelector('[data-akari-transition-frame]') || card).backgroundImage
    })));
    const firstTransition = page.locator('[data-akari-library-transition]').first();
    await firstTransition.hover();
    await sleep(80);
    const hoverMotion = await motion(firstTransition.locator('[data-akari-transition-hover-strip]'));
    record('transition', { count: transition.length, cards: transition, hoverMotion });
    await shot(page, 'transition-hover');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await firstTransition.hover();
    record('transitionReducedMotion', await motion(firstTransition.locator('[data-akari-transition-hover-strip]')));
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await widgetCall(page, 'showLibraryHome');
    const detailsToggle = page.locator('[data-akari-library-details-toggle]');
    if (await detailsToggle.getAttribute('aria-expanded') !== 'true') await detailsToggle.click();
    await page.locator('[data-akari-library-details]').waitFor();
    record('detailWords', await screenWords(page));
    await shot(page, 'home-details');
    const detail = page.locator('[data-akari-library-details]');
    const textRow = page.locator('[data-akari-library-text-look-row]');
    const textRowCount = await textRow.count();
    record('textLookRow', { count: textRowCount,
        text: textRowCount ? (await textRow.innerText()).replace(/\s+/g, ' ').trim() : null });
    if (textRowCount) {
        await textRow.click();
        await page.locator('[data-akari-library-text-look-page]').waitFor();
    }
    record('textPageWords', await screenWords(page));
    const textPage = page.locator('[data-akari-library-text-look-page]');
    const sections = await textPage.locator('[data-akari-text-look-section]').evaluateAll(nodes =>
        nodes.map(n => ({ key: n.getAttribute('data-akari-text-look-section'), text: n.textContent.trim().slice(0, 80) })));
    record('textLookSections', sections);
    record('textLookVisibleWords', await (textRowCount ? textPage : detail).evaluate(node => ({
        hasOldWord: node.textContent.includes('スタンプ'), hasNewWord: node.textContent.includes('イラスト'),
        hasStyle: node.textContent.includes('スタイル'), hasMotion: node.textContent.includes('動き'),
        hasFont: node.textContent.includes('フォント')
    })));
    if (textRowCount) await scrollSection(page, '[data-akari-library-text-look-page]');
    await shot(page, 'text-look-top');
    if (textRowCount) {
        await scrollSection(page, '[data-akari-text-look-section="motion"]');
        await shot(page, 'text-look-motion');
        await scrollSection(page, '[data-akari-text-look-section="font"]');
        await shot(page, 'text-look-font');
    }

    if (!textRowCount) await category(page, 'font');
    const fonts = await cardImages(page.locator('[data-akari-font-card], [data-akari-catalog-item^="font/"]:not([data-akari-font-card])'),
        'catalog/font/[^/]+/preview\\.png');
    record('font', { count: fonts.length, sources: {
        catalogPreview: fonts.filter(item => item.source === 'catalog-preview').length,
        otherPreview: fonts.filter(item => item.source === 'other-preview').length,
        fallback: fonts.filter(item => item.source === 'fallback').length
    }, cards: fonts });
    await shot(page, 'font');

    if (!textRowCount) await category(page, 'textanim');
    const animCount = await page.locator('[data-akari-catalog-preset-item^="textanim/"]').count();
    const firstAnim = page.locator('[data-akari-catalog-preset-item^="textanim/"]').first();
    await firstAnim.hover();
    await sleep(80);
    const animMotion = await motion(firstAnim.locator('[data-akari-textanim-sample]'));
    record('textAnimation', { count: animCount, hoverMotion: animMotion });
    await shot(page, 'textanim-hover');

    // 本物の選択操作を通す。現在の実装でカードが未実装なら before は結果だけ記録する。
    await command(page, 'akari.annotations.open');
    await command(page, 'akari.timeline.seek', { seconds: 1 });
    const caption = page.locator('.akari-annotations-strip-caption').filter({ hasText: '文字の見本' }).first();
    const captionVisible = await waitFor(() => caption.count().then(count => count > 0), 10000).catch(() => false);
    if (captionVisible) await caption.click();
    const selection = await page.locator('.akari-annotations-strip-caption.akari-annotations-caption-selected').count();
    const editBefore = JSON.parse(await readFile(join(project, 'edit.json'), 'utf8'));
    const captionsBefore = JSON.parse(await readFile(join(project, 'captions.json'), 'utf8'));
    if (!textRowCount) await category(page, 'font');
    const fontCard = page.locator('[data-akari-font-card], [data-akari-catalog-item^="font/"]:not([data-akari-font-card])').first();
    const fontId = await fontCard.count()
        ? (await fontCard.getAttribute('data-akari-font-card') || (await fontCard.getAttribute('data-akari-catalog-item'))?.replace(/^font\//, ''))
        : null;
    let applyAction = false;
    if (fontId && selection) {
        await fontCard.click({ button: 'right' });
        const action = page.locator('[data-akari-context-menu] [data-akari-context-item="apply"]');
        applyAction = await action.count() > 0;
        if (applyAction) await action.click();
        await sleep(500);
    }
    const editAfter = JSON.parse(await readFile(join(project, 'edit.json'), 'utf8'));
    const captionsAfter = JSON.parse(await readFile(join(project, 'captions.json'), 'utf8'));
    const fixtureBefore = captionsBefore.find(row => row.id === 'c-l1-font');
    const fixtureAfter = captionsAfter.find(row => row.id === 'c-l1-font');
    const fontsIn = value => JSON.stringify(value).match(/"(?:font|font_family|fontFamily)"\s*:\s*"[^"]+"/g) || [];
    record('fontApply', { captionVisible, selection, fontId, applyAction,
        editChanged: JSON.stringify(editBefore) !== JSON.stringify(editAfter),
        editFontsBefore: fontsIn(editBefore), editFontsAfter: fontsIn(editAfter),
        captionsChanged: JSON.stringify(captionsBefore) !== JSON.stringify(captionsAfter),
        selectedCaptionFontBefore: fixtureBefore?.text_style?.font_family ?? null,
        selectedCaptionFontAfter: fixtureAfter?.text_style?.font_family ?? null,
        captionFontsBefore: fontsIn(captionsBefore),
        captionFontsAfter: fontsIn(captionsAfter) });
    await shot(page, 'font-apply');
    await command(page, 'akari.timeline.seek', { seconds: 1 });
    await sleep(400);
    await shot(page, 'font-applied-preview', 'preview');

    // 現在の棚では画像と同じカテゴリではないが、文字とイラストの画面語を確認する。
    record('visibleWords', await page.locator('#akari-role-buckets-widget').evaluate(node => ({
        hasOldWord: node.textContent.includes('スタンプ'), hasNewWord: node.textContent.includes('イラスト')
    })));
    const fontDirs = (await readdir(join(repo, 'catalog/font'), { withFileTypes: true })).filter(entry => entry.isDirectory());
    const fontInventory = new Map(await Promise.all(fontDirs.map(async entry => {
        const names = await readdir(join(repo, 'catalog/font', entry.name));
        return [entry.name, { meta: names.includes('meta.json'), preview: names.includes('preview.png') }];
    })));
    record('fontInventory', { directories: [...fontInventory].filter(([, value]) => value.meta).length,
        previews: [...fontInventory].filter(([, value]) => value.meta && value.preview).length });
    if (mode === 'after') {
        assert.ok(luts.length > 0 && luts.every(x => x.previewPath && x.loaded), 'LUT preview.webp');
        assert.ok(transition.length > 0 && transition.every(x => x.frameCount === 3 && x.previewImage.includes('preview.webp')), 'transition three frames');
        assert.ok(hoverMotion.some(x => x.animationName !== 'none' && x.animationCount > 0
            && x.backgroundImage.includes('preview-strip.webp')), 'transition hover five-frame strip');
        assert.ok(observations.checks.transitionReducedMotion.every(x => x.animationName === 'none' && x.opacity === '0'));
        assert.equal(textRowCount, 1);
        assert.deepEqual(sections.map(x => x.key), ['style', 'motion', 'font']);
        assert.equal(fonts.length, observations.checks.fontInventory.directories);
        assert.ok(fonts.every(x => x.loaded || x.fallback), 'font image loaded or fallback');
        assert.ok(fonts.every(x => {
            const present = fontInventory.get(x.key)?.preview;
            return !present || (x.hasImage && x.previewPath && x.loaded);
        }), 'catalog preview.png entries loaded');
        assert.ok(selection > 0 && applyAction && observations.checks.fontApply.captionsChanged
            && observations.checks.fontApply.selectedCaptionFontAfter
            && observations.checks.fontApply.selectedCaptionFontAfter !== observations.checks.fontApply.selectedCaptionFontBefore,
            'selected text font changed in captions.json');
        assert.ok(animMotion.some(x => x.animationCount > 0), 'text animation hover');
        assert.equal(observations.checks.homeWords.hasOldWord, false);
        assert.equal(observations.checks.homeWords.hasNewWord, true);
        assert.equal(observations.checks.detailWords.oldWordCount, 0);
        assert.ok(observations.checks.detailWords.newWordCount > 0);
        assert.equal(observations.checks.textPageWords.oldWordCount, 0);
        assert.ok(observations.checks.homeWords.newWordCount
            + observations.checks.detailWords.newWordCount + observations.checks.textPageWords.newWordCount > 0);
        assert.equal(observations.checks.textLookVisibleWords.hasOldWord, false);
        assert.equal(observations.checks.homeCategories.find(x => x.key === 'stamps')?.label, 'イラスト');
        assert.match(observations.checks.homeTiles.find(x => x.key === 'stamps')?.text || '', /イラスト/);
    }
}

try {
    await fixture();
    child = spawn(electron, [shell, project, `--remote-debugging-port=${port}`,
        `--user-data-dir=${join(temp, 'electron-profile')}`, '--no-sandbox'], {
        cwd: shell, env: { ...process.env, HOME: temp, XDG_CONFIG_HOME: join(temp, 'xdg-config'),
            XDG_CACHE_HOME: join(temp, 'xdg-cache'), THEIA_CONFIG_DIR: join(temp, 'theia'), AKARI_HOME: join(temp, 'akari-home') },
        stdio: ['ignore', 'ignore', 'pipe']
    });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
    browser = await waitFor(() => chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined), 120000);
    const page = await waitFor(async () => {
        for (const candidate of browser.contexts().flatMap(context => context.pages())) {
            if (await candidate.evaluate(() => !!window.theia?.container).catch(() => false)) return candidate;
        }
    }, 120000);
    await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
    await waitFor(() => command(page, 'akari.catalog.open').then(() => true), 60000);
    await page.evaluate(`(()=>{${SERVICES}svc('addWidget','getTabBarFor').resize(360,'left');return true})()`);
    await page.locator('[data-akari-panel-segment="catalog"]').click();
    await waitFor(async () => (await widgetCall(page, 'catalogCategorySummaries')).length > 0, 60000);
    await observe(page);
    observations.passed = true;
} catch (error) {
    observations.failure = sanitize(error?.stack ?? error);
    observations.stderr = sanitize(stderr);
    process.exitCode = 1;
} finally {
    await mkdir(out, { recursive: true });
    const file = join(out, 'observations.json');
    await writeFile(file, `${JSON.stringify(observations, null, 2)}\n`);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).mode, mode);
    await browser?.close().catch(() => {});
    if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await Promise.race([exited, sleep(10000)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
    await rm(temp, { recursive: true, force: true }).catch(() => {});
}
