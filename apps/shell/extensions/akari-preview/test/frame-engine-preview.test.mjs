import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const extensionRoot = resolve(here, '..');
const repoRoot = resolve(extensionRoot, '../../../..');
const compiledHandler = readFileSync(
    join(extensionRoot, 'lib', 'browser', 'akari-preview-open-handler.js'),
    'utf8'
);
const compiledFrontendModule = readFileSync(
    join(extensionRoot, 'lib', 'browser', 'akari-preview-frontend-module.js'),
    'utf8'
);
const sourceHandler = readFileSync(
    join(extensionRoot, 'src', 'browser', 'akari-preview-open-handler.ts'),
    'utf8'
);
const generatedBundle = join(extensionRoot, 'generated', 'frame-engine.js');

// webview 内で実行する文字列は tsc の構文検査外なので、compiled lib のテンプレートを
// 実行時と同じ JS へ戻して vm.Script で検査する。
function extractTemplate(methodName) {
    const methodAt = compiledHandler.lastIndexOf(`${methodName}()`);
    assert.notEqual(methodAt, -1, `${methodName}() が compiled lib に見つからない`);
    const tick = compiledHandler.indexOf('`', methodAt);
    assert.notEqual(tick, -1, `${methodName}() のテンプレートリテラルが見つからない`);
    let index = tick + 1;
    let output = '';
    while (index < compiledHandler.length) {
        const character = compiledHandler[index];
        if (character === '\\') {
            const next = compiledHandler[index + 1];
            if (next === 'n') output += '\n';
            else if (next === 't') output += '\t';
            else if (next === 'r') output += '\r';
            else output += next;
            index += 2;
            continue;
        }
        if (character === '`') break;
        if (character === '$' && compiledHandler[index + 1] === '{') {
            let braces = 1;
            index += 2;
            while (index < compiledHandler.length && braces > 0) {
                const nested = compiledHandler[index];
                if (nested === '\\') { index += 2; continue; }
                if (nested === '{') braces += 1;
                else if (nested === '}') braces -= 1;
                index += 1;
            }
            output += '0';
            continue;
        }
        output += character;
        index += 1;
    }
    return output;
}

const bootstrap = extractTemplate('frameEngineBootstrapScript');

test('frameEngineBootstrapScript の生成 JS が構文として妥当', () => {
    assert.ok(bootstrap.length > 10000, 'frame-engine テンプレート抽出が短すぎる');
    assert.doesNotThrow(() => new vm.Script(bootstrap, { filename: 'frame-engine-bootstrap.js' }));
});

test('フラグ off の注入は空文字で既存 HTML 末尾を変えない', () => {
    assert.match(
        compiledHandler,
        /frameEngineEnabled && assets\.frameEngineJavaScript[\s\S]*?\? `[\s\S]*?`[\s\S]*?: '';/
    );
    assert.match(compiledHandler, /\$\{frameEngineScripts\}<\/body>/);
});

test('worker CSP は frame-engine 有効時だけ blob と data を許可する', () => {
    // av-cliper は OPFS ファイルストアとタイマーに blob/data Worker を使う。
    // off では空文字を差し込んで従来 CSP を保ち、engine script がある場合だけ worker-src を開く。
    assert.match(
        compiledHandler,
        /const frameEngineCsp = frameEngineScripts \? '; worker-src blob: data:' : '';/
    );
    assert.match(compiledHandler, /font-src data:\$\{frameEngineCsp\}">/);
});

test('AKARI_FRAME_ENGINE の backend RPC はインスタンスで 1 回だけキャッシュする', () => {
    assert.match(compiledHandler, /frameEngineEnvOverridePromise \?\?=/);
    assert.match(compiledHandler, /getValue\('AKARI_FRAME_ENGINE'\)/);
    assert.match(compiledHandler, /preferences\.get\('akari\.preview\.frameEngine', true\)/);
});

test('frame-engine 有効時も overlay-only 更新は同じ runtime へ差分適用する', () => {
    assert.match(compiledHandler,
        /isOverlayOnlyPreviewModelUpdate\)\(widget\.akariPreviewModelSnapshot, nextSnapshot\)/);
});

test('追跡済み frame-engine IIFE は必要な engine 部品を含む', () => {
    assert.ok(existsSync(generatedBundle), 'generated/frame-engine.js が存在しない');
    const bundle = readFileSync(generatedBundle, 'utf8');
    assert.match(bundle, /^\/\/ このファイルは生成物です。[^\n]+\n(?:"use strict";\n)?var AkariFrameEngine = \(\(\) => \{/);
    assert.match(bundle, /evaluationPlanFromResolvedTimeline/);
    assert.match(bundle, /WebGL2Compositor/);
    assert.match(bundle, /MP4Clip/);
});

test('preference と環境変数 override が登録されている', () => {
    assert.match(compiledFrontendModule, /akari\.preview\.frameEngine/);
    assert.match(compiledFrontendModule, /default: true/);
    assert.match(compiledHandler, /AKARI_FRAME_ENGINE/);
    assert.match(compiledHandler, /override === '1' \|\| override === 'true'/);
    assert.match(compiledHandler, /override === '0' \|\| override === 'false'/);
});

test('glue は video 系だけを隠し、既存 transport と overlay DOM を残す', () => {
    assert.match(bootstrap, /layersStage\.querySelectorAll\('video, img'\)/);
    const activeVisibilityRule = compiledHandler.match(
        /#preview-stage\[data-frame-engine-active="true"\] #preview-video,[\s\S]*?#preview-stage\[data-frame-engine-active="true"\] \.akari-video-fx-rail \{[\s\S]*?visibility: hidden !important;\s*\}/
    )?.[0];
    assert.ok(activeVisibilityRule, 'frame-engine active 時の CSS 排他ルールが compiled handler に無い');
    for (const selector of [
        '#preview-video', '#standby-video', '#transition-video', '#transition-still', '#preview-still',
        '[data-akari-layer-id]', '[data-akari-filter-id]', '[data-akari-deferred-telop-id]',
        '.akari-video-fx-rail'
    ]) {
        assert.match(activeVisibilityRule, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    for (const selector of ['#overlay-stage', '#caption-plate', '#pen-layer', '#layer-select-box']) {
        assert.doesNotMatch(activeVisibilityRule, new RegExp(selector));
    }
    assert.doesNotMatch(bootstrap, /\.style\.visibility = 'hidden'/);
    assert.doesNotMatch(bootstrap, /media\.removeAttribute\('src'\)/);
    assert.doesNotMatch(bootstrap, /document\.querySelector\('\.transport'\)/);
    assert.doesNotMatch(bootstrap, /stage\.children/);
    assert.match(bootstrap, /layersStage\.prepend\(root\)/);
    assert.match(compiledHandler, /frameEngineClock\.tick\(outputTime, isPlaying\)[\s\S]*runtime\.tick\(outputTime, isPlaying\)[\s\S]*renderCaption\(\)/);
    assert.match(bootstrap, /metrics\.hidden = initial\.frameEngineMetricsEnabled !== true/);
});

test('glue は宣言された source 種別で frame source registry を構築して静止画も破棄する', () => {
    assert.match(bootstrap, /Object\.entries\(initial\.imageSources \|\| \{\}\)/);
    assert.match(bootstrap, /images\.set\(id, new engine\.CachedStillImageSource\(url\)\)/);
    assert.match(bootstrap, /layer\.isImage === true/);
    assert.match(bootstrap, /new engine\.CachedStillImageSource\(layer\.src\)/);
    assert.match(bootstrap, /\}\)\)\(\{ layers: engineLayers \}\)/);
    assert.doesNotMatch(bootstrap, /\\\.\(png\|jpe\?g\|webp\|bmp\|gif\)/);
    assert.match(bootstrap, /const sources = new Map\(\[\.\.\.lookahead, \.\.\.images\]\)/);
    assert.match(bootstrap, /for \(const image of images\.values\(\)\) image\.destroy\(\)/);
});

test('glue は不正な非 object layer だけを frame-engine 評価前に fail-open で除外する', () => {
    assert.match(sourceHandler, /filterRenderableFrameEngineLayers\.toString\(\)/u);
    assert.match(sourceHandler, /filterRenderableFrameEngineLayersFn\([\s\S]*?summary\.layers/u);
});

test('glue は LUT を parseCube して output.look へ渡し、失敗時は描画を継続する', () => {
    assert.match(bootstrap, /typeof projectedLook\.cubeText === 'string'/);
    assert.match(bootstrap, /lut: engine\.parseCube\(projectedLook\.cubeText\)/);
    assert.match(bootstrap, /Math\.max\(0, Math\.min\(1, Number\.isFinite\(intensity\) \? intensity : 1\)\)/);
    assert.match(bootstrap, /catch \(reason\) \{\s*console\.warn\([^;]+, reason\);\s*\}/);
    assert.match(bootstrap, /colorSpace: 'bt709-limited',\s*look\s*\}/);
});

test('glue は計測 dataset と可視 canvas 直結 compositor を持つ', () => {
    for (const key of [
        'fps', 'lateFrames', 'seekMs', 'seekBeforeMs', 'seekAfterMs',
        'boundaryLateBefore', 'boundaryLateAfter', 'warmupCoverage',
        'liveDecoders', 'leadInSec'
    ]) {
        assert.match(bootstrap, new RegExp(`metrics\\.dataset\\.${key}`));
    }
    assert.match(bootstrap, /new engine\.WebGL2Compositor\(canvas/);
    assert.doesNotMatch(bootstrap, /willReadFrequently/);
    assert.match(bootstrap, /engine\.createPreviewScheduler\(/);
    assert.match(bootstrap, /scheduler\.notePresented\(timeUs, \{ reason \}\)/);
    assert.match(bootstrap, /scheduler\.primeHeaders\(\)/);
    assert.doesNotMatch(bootstrap, /const scheduleWarmup|const prefetch =/);
    assert.match(bootstrap, /new engine\.ScrubController/);
});

test('描画エラー面は回復時に消え、発生履歴は計測へ残る', () => {
    // エラー面は現在の状態だけを示す。回復を隠さず、過去の発生は累計で追えるようにする。
    const renderFrame = bootstrap.slice(
        bootstrap.indexOf('const renderFrame = async'),
        bootstrap.indexOf('scrub = new engine.ScrubController')
    );
    assert.match(renderFrame, /error\.hidden = true;\s*error\.textContent = '';/);
    assert.match(bootstrap, /metrics\.dataset\.renderErrors = String\(measurements\.renderErrors\)/);
    assert.match(bootstrap, /'render error       ' \+ measurements\.renderErrors/);
});

test('配布スクリプトが frame-engine bundle を asar 内へ登録する', () => {
    const copyScript = readFileSync(
        join(repoRoot, 'apps', 'shell', 'resources', 'scripts', 'copy-native-helpers.mjs'),
        'utf8'
    );
    const verifyScript = readFileSync(
        join(repoRoot, 'apps', 'shell', 'resources', 'scripts', 'verify-asar-contents.mjs'),
        'utf8'
    );
    assert.match(copyScript, /extensions', 'akari-preview', 'generated', 'frame-engine\.js'/);
    assert.match(copyScript, /overlayRuntimeDestination, 'frame-engine\.js'/);
    assert.match(verifyScript, /'\/lib\/overlay-runtime\/frame-engine\.js'/);
});

test('frame-engine bundle は生成元から再生成しても byte drift がない', t => {
    const rootNodeModules = join(repoRoot, 'node_modules');
    const esbuild = join(rootNodeModules, 'esbuild', 'bin', 'esbuild');
    if (!existsSync(rootNodeModules) || !existsSync(esbuild)) {
        t.skip('リポジトリ直下の node_modules または esbuild が無いため drift 検査を省略');
        return;
    }
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'akari-frame-engine-drift-'));
    const rebuilt = join(temporaryDirectory, 'frame-engine.js');
    const { buildSync } = require(join(rootNodeModules, 'esbuild'));
    try {
        buildSync({
            entryPoints: [join(repoRoot, 'packages', 'frame-engine', 'src', 'index.ts')],
            bundle: true,
            format: 'iife',
            globalName: 'AkariFrameEngine',
            platform: 'browser',
            target: ['chrome122'],
            banner: {
                js: '// このファイルは生成物です。正本は packages/frame-engine/src、再生成は npm run bundle:frame-engine。'
            },
            absWorkingDir: repoRoot,
            outfile: rebuilt,
            logLevel: 'silent'
        });
        assert.deepEqual(readFileSync(rebuilt), readFileSync(generatedBundle));
    } finally {
        rmSync(temporaryDirectory, { recursive: true, force: true });
    }
});
