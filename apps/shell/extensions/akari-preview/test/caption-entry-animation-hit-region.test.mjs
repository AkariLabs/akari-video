import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extensionRoot = resolve(here, '..');
const repositoryRoot = resolve(extensionRoot, '../../../..');
const source = readFileSync(
    join(extensionRoot, 'src/browser/akari-preview-open-handler.ts'),
    'utf8'
);
const width = 1080;
const height = 1920;

function captionEntryAnimationsSettled(animations) {
    for (const animation of animations) {
        const endTime = Number(animation.effect?.getComputedTiming().endTime);
        if (!Number.isFinite(endTime)) continue;
        const currentTime = Number(animation.currentTime);
        if (!Number.isFinite(currentTime) || currentTime < endTime) return false;
    }
    return true;
}

function loadPuppeteer() {
    const roots = [resolve(repositoryRoot, 'packages/render-cut')];
    const gitFile = resolve(repositoryRoot, '.git');
    // .git は git worktree では「gitdir: ...」を書いたファイル、通常の clone では
  // ディレクトリ。existsSync だけで通すと clone 側で readFileSync が EISDIR で落ちる。
  if (existsSync(gitFile) && statSync(gitFile).isFile()) {
        const gitDir = readFileSync(gitFile, 'utf8').trim().replace(/^gitdir:\s*/, '');
        const marker = `${join('.git', 'worktrees')}/`;
        const markerIndex = gitDir.indexOf(marker);
        if (markerIndex >= 0) {
            roots.push(join(gitDir.slice(0, markerIndex), 'packages/render-cut'));
        }
    }
    for (const root of roots) {
        try {
            return createRequire(`${root}/`)('puppeteer-core');
        } catch {
            // worktree に依存が無い場合は git common dir 側の main checkout を試す。
        }
    }
    throw new Error('puppeteer-core を解決できません');
}

function cachedChromeCandidates() {
    const root = join(homedir(), '.cache/puppeteer/chrome-headless-shell');
    if (!existsSync(root)) return [];
    const directories = path => readdirSync(path, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    return directories(root).sort().reverse().flatMap(build =>
        directories(join(root, build)).map(platform =>
            join(root, build, platform, 'chrome-headless-shell')
        )
    ).filter(candidate => existsSync(candidate));
}

function findChrome() {
    const candidates = [
        process.env.CHROME_PATH,
        ...cachedChromeCandidates(),
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ];
    const chrome = candidates.find(candidate => candidate && existsSync(candidate));
    if (!chrome) throw new Error('headless Chrome が見つかりません');
    return chrome;
}

function extractRenderCaption() {
    const startMarker = 'const renderCaption = () => {';
    const endMarker = 'const renderTransitionPlate = timelineTime =>';
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.notEqual(start, -1, 'renderCaption の開始点を抽出できません');
    assert.notEqual(end, -1, 'renderCaption の終了点を抽出できません');
    return source.slice(start, end).trim();
}

const renderCaptionSource = extractRenderCaption();

function inlineScript(value) {
    return value.replaceAll('</script', '<\\/script');
}

function harnessHtml() {
    return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}
#caption-plate{position:absolute;inset:0;pointer-events:auto}
.fixture-caption__anchor{position:absolute;left:90px;top:960px;width:900px;height:240px;display:grid;place-items:center;opacity:0;color:#fff;background:#e74420;font:900 120px/1 sans-serif;transform-origin:center}
.fixture-caption__anchor{animation:fixture-caption-in 800ms ease-out both paused}
@keyframes fixture-caption-in{0%{opacity:0;transform:translate3d(1400px,-500px,0) scale(.62)}100%{opacity:1;transform:translate3d(0,0,0) scale(1)}}
</style></head><body><div id="caption-plate"></div><script>
const captionPlate=document.getElementById('caption-plate');
const captions=[{id:'caption-fixture',start:10,end:14,text:'字幕',style:'pop',textStyle:{color:'#fff'},words:[{start:10,end:11,text:'字幕'}]}];
let outputTime=0;
let activeCaption=null;
let styledCaptionActive=false;
let activeCaptionEdit=null;
let captionHitRegionPending=false;
const captionPortrait=false;
const captionLineBudget=20;
let syncCalls=0;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const splitCaptionLines=value=>[value];
const findMatchingEmphasis=()=>null;
const applyCaptionStyleVars=()=>undefined;
const renderPlainCaptionFragment=()=>'';
const renderStyledCaptionFragment=()=>'<div class="akari-caption"><div class="fixture-caption__anchor"><span>字幕</span></div></div>';
const updateCaptionSelectBox=()=>undefined;
const captionEntryAnimationsSettledFn=(${captionEntryAnimationsSettled.toString()});
window.AkariEditKernel={findActiveCaption(items,time){return items.find(item=>item.start<=time&&time<item.end)||null}};
function syncOverlayHitRegion(container){
  syncCalls+=1;
  const containerRect=container.getBoundingClientRect();
  const contentRect=container.querySelector('.fixture-caption__anchor')?.getBoundingClientRect();
  if(!contentRect){container.style.clipPath='none';return}
  const top=((contentRect.top-containerRect.top)/containerRect.height)*100;
  const right=((containerRect.right-contentRect.right)/containerRect.width)*100;
  const bottom=((containerRect.bottom-contentRect.bottom)/containerRect.height)*100;
  const left=((contentRect.left-containerRect.left)/containerRect.width)*100;
  container.style.clipPath='inset('+top+'% '+right+'% '+bottom+'% '+left+'%)';
}
window.akari={interaction:{syncOverlayHitRegion}};
${inlineScript(renderCaptionSource)}
window.runCaptionTick=time=>{outputTime=time;renderCaption()};
window.resetSyncCalls=()=>{syncCalls=0};
window.readSyncCalls=()=>syncCalls;
</script></body></html>`;
}

function clipMeasurementScript() {
    return () => {
        const container = document.getElementById('caption-plate');
        const anchor = container.querySelector('.fixture-caption__anchor');
        if (!anchor) return { missingAnchor: true, html: container.innerHTML, clipPath: container.style.clipPath };
        const bbox = anchor.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const clipPath = container.style.clipPath;
        const values = [...clipPath.matchAll(/[-+\d.eE]+(?=%)/g)].map(match => Number(match[0]));
        const [top, right, bottom, left] = values;
        const clip = {
            top: containerRect.top + containerRect.height * top / 100,
            right: containerRect.right - containerRect.width * right / 100,
            bottom: containerRect.bottom - containerRect.height * bottom / 100,
            left: containerRect.left + containerRect.width * left / 100
        };
        return {
            clipPath,
            clip,
            bbox: { top: bbox.top, right: bbox.right, bottom: bbox.bottom, left: bbox.left },
            syncCalls: window.readSyncCalls()
        };
    };
}

function assertContainsCurrentBbox(result, pathName) {
    assert.notEqual(result.missingAnchor, true, `${pathName}: fixture 字幕が描画されませんでした: ${JSON.stringify(result)}`);
    const epsilon = 0.5;
    assert.ok(
        result.clip.top <= result.bbox.top + epsilon
            && result.clip.right >= result.bbox.right - epsilon
            && result.clip.bottom >= result.bbox.bottom - epsilon
            && result.clip.left <= result.bbox.left + epsilon,
        `${pathName}: clip がシーク後の bbox を内包していません: ${JSON.stringify(result)}`
    );
}

async function openBrowser(t) {
    const puppeteer = loadPuppeteer();
    const browser = await puppeteer.launch({
        executablePath: findChrome(),
        headless: 'shell',
        pipe: true,
        args: ['--single-process', '--no-zygote', '--disable-gpu']
    });
    t.after(() => browser.close());
    return browser;
}

const paths = [
    {
        name: '直接シーク',
        times: [10.4],
        playing: false
    },
    {
        name: '連続再生',
        times: Array.from({ length: 32 }, (_value, index) => 9.9 + index * 0.033),
        playing: true
    },
    {
        name: 'スクラブ',
        times: [9.94, 9.98, 10.02, 10.08, 10.15, 10.24, 10.36, 10.51, 10.68, 10.86],
        playing: false
    }
];

test('finite WAAPI の終端だけで caption hit region の pending を収束させる', async () => {
    const { captionEntryAnimationsSettled: settled } = await import('../lib/common/caption-hit-region.js');
    const animation = (endTime, currentTime) => ({
        currentTime,
        effect: { getComputedTiming: () => ({ endTime }) }
    });
    assert.equal(settled([animation(800, 799)]), false);
    assert.equal(settled([animation(800, 800)]), true);
    assert.equal(settled([animation(Number.POSITIVE_INFINITY, 0), animation(800, 800)]), true);
});

for (const path of paths) {
    test(`#caption-plate は${path.name}でシーク後の bbox を clip-path に内包する`, async t => {
        const browser = await openBrowser(t);
        const page = await browser.newPage();
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await page.setContent(harnessHtml(), { waitUntil: 'load' });
        for (const time of path.times) {
            await page.evaluate(value => window.runCaptionTick(value), time);
            await page.evaluate(() => new Promise(resolveFrame => requestAnimationFrame(resolveFrame)));
        }
        const result = await page.evaluate(clipMeasurementScript());
        assertContainsCurrentBbox(result, path.name);
        if (path.times.length > 1) {
            assert.ok(result.syncCalls >= 2, `${path.name}: 入場中の再測定が ${result.syncCalls} 回だけです`);
            await page.evaluate(() => {
                window.resetSyncCalls();
                window.runCaptionTick(11);
                window.runCaptionTick(11.1);
            });
            assert.equal(await page.evaluate(() => window.readSyncCalls()), 0, `${path.name}: 入場完了後も再測定しています`);
        }
    });
}

test('現行の既定字幕アニメはシーク前後の clip-path 辺差が 2px 以内に収まる', async t => {
    const browser = await openBrowser(t);
    const page = await browser.newPage();
    await page.setViewport({ width: 400, height: 400, deviceScaleFactor: 1 });
    const results = await page.evaluate(async () => {
        const scale = 0.1875;
        document.body.innerHTML = `<style>
          html,body{margin:0}.stage{position:relative;width:1080px;height:1920px;transform:scale(${scale});transform-origin:0 0}.host{position:absolute;inset:0}.plate{position:absolute;left:90px;top:960px;font:700 38px/1.42 sans-serif}.tok{display:inline-block}
          @keyframes karaoke{from{color:#fff}to{color:#ffd94a}}
          @keyframes pop{0%{transform:translateY(0) scale(1)}50%{transform:translateY(-.08em) scale(1.12)}100%{transform:translateY(0) scale(1)}}
          @keyframes reveal-word{0%{opacity:0}100%{opacity:1}}
          @keyframes reveal{0%{opacity:0;transform:translateY(.18em)}12%{opacity:1;transform:translateY(0)}99.99%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(0)}}
        </style><div class="stage"></div>`;
        const cases = [
          ['karaoke','karaoke 200ms linear both paused',100],
          ['pop','pop 200ms ease-out both paused',100],
          ['reveal-word','reveal-word 10ms linear both paused',5],
          ['reveal','reveal 200ms linear both paused',100]
        ];
        const stage = document.querySelector('.stage');
        const clipRect = (host, content) => {
          const outer = host.getBoundingClientRect();
          const inner = content.getBoundingClientRect();
          return { top: inner.top, right: inner.right, bottom: inner.bottom, left: inner.left,
            percentages: [
              (inner.top-outer.top)/outer.height*100,
              (outer.right-inner.right)/outer.width*100,
              (outer.bottom-inner.bottom)/outer.height*100,
              (inner.left-outer.left)/outer.width*100
            ] };
        };
        const measured = [];
        for (const [name, animation, seekMs] of cases) {
          const host = document.createElement('div');
          host.className = 'host';
          host.innerHTML = '<div class="plate"><span class="tok">字幕</span></div>';
          stage.replaceChildren(host);
          const content = host.querySelector('.tok');
          content.style.animation = animation;
          const before = clipRect(host, content);
          const [waapi] = content.getAnimations();
          waapi.pause();
          waapi.currentTime = seekMs;
          const after = clipRect(host, content);
          const differences = ['top','right','bottom','left'].map(edge => Math.abs(before[edge]-after[edge]));
          measured.push({ name, maxDifferencePx: Math.max(...differences), before: before.percentages, after: after.percentages });
        }
        return measured;
    });
    const maxDifferencePx = Math.max(...results.map(result => result.maxDifferencePx));
    t.diagnostic(`既定字幕アニメの最大 clip-path 辺差: ${maxDifferencePx.toFixed(3)}px`);
    assert.ok(maxDifferencePx <= 2, `最大差 ${maxDifferencePx}px が 2px を超えました: ${JSON.stringify(results)}`);
});

test('webview は caption の WAAPI シーク後に pending hit region を収束させる', () => {
    assert.match(source, /captionEntryAnimationsSettledFn/);
    assert.match(renderCaptionSource, /animation\.currentTime = localMs;[\s\S]*syncOverlayHitRegion/);
    assert.match(renderCaptionSource, /captionHitRegionPending/);
});
