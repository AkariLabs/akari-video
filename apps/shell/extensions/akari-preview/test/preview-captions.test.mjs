import assert from 'node:assert/strict';
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { parsePreviewCaptions, parseResolvedPreviewCaptions } = require('../lib/browser/akari-preview-captions.js');
const { AkariPreviewServiceImpl } = require('../lib/node/akari-preview-service.js');
const shellVisualContract = require('../lib/common/caption-visual-contract.js');
const { resolveCaptionDisplay } = require('../../../../../packages/edit-store/lib/index.js');
const extensionRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(extensionRoot, '../../../..');
const styleParity = JSON.parse(await readFile(join(
    repositoryRoot, 'packages/edit-store/test/fixtures/caption-style-validation-parity.json'
), 'utf8'));
const checkedVisualContract = JSON.parse(await readFile(join(
    repositoryRoot, 'packages/edit-store/src/caption-visual-contract.json'
), 'utf8'));

const caption = {
    id: 'c-0001',
    start: 0,
    end: 2,
    text: '字幕',
    speaker: null,
    sourceRef: { segment: 0 },
    edited: false
};

test('shell resolved-caption fragment and managed variables come from the checked source contract', () => {
    assert.equal(shellVisualContract.RESOLVED_SINGLE_LINE_CAPTION_CSS, checkedVisualContract.resolved_single_line_caption_css);
    assert.equal(shellVisualContract.RESOLVED_SINGLE_LINE_FRAGMENT_OPEN, checkedVisualContract.resolved_single_line_fragment_open);
    assert.equal(shellVisualContract.RESOLVED_SINGLE_LINE_FRAGMENT_MIDDLE, checkedVisualContract.resolved_single_line_fragment_middle);
    assert.equal(shellVisualContract.RESOLVED_SINGLE_LINE_FRAGMENT_CLOSE, checkedVisualContract.resolved_single_line_fragment_close);
    assert.deepEqual(
        shellVisualContract.RESOLVED_CAPTION_STYLE_VARIABLE_NAMES,
        checkedVisualContract.resolved_caption_style_variable_names
    );
});

test('配列ルートを従来どおり読み text_style 不在なら id 以外の追加キーを持たない', () => {
    // ㉓ 字幕クリック選択+移動の書き戻し（captions.json text_style.zone）に caption を
    // 一意に特定する id が必要になったため、id は複製対象へ追加された
    // （akari-preview-captions.ts PreviewCaption）。他のフィールドは変更なし。
    const [parsed] = parsePreviewCaptions(JSON.stringify([caption]));
    assert.deepEqual(parsed, { id: 'c-0001', start: 0, end: 2, text: '字幕' });
});

test('object ルートを読み default と caption をネストもフィールド単位で合成する', () => {
    const [parsed] = parsePreviewCaptions(JSON.stringify({
        default_text_style: {
            color: '#112233',
            size_px: 38,
            stroke: { color: '#000000', width_px: 1 },
            background: { color: '#44556680', opacity: 0.25, radius_px: 6 },
            zone: 'bottom'
        },
        captions: [{
            ...caption,
            text_style: {
                color: '#AABBCC',
                stroke: { width_px: 3 },
                background: { radius_px: 12 },
                zone: 'top-right'
            }
        }]
    }));

    assert.deepEqual(parsed.textStyle, {
        color: '#AABBCC',
        sizePx: 38,
        stroke: { color: '#000000', widthPx: 3 },
        background: { color: '#44556680', opacity: 0.25, radiusPx: 12 },
        zone: 'top-right'
    });
    assert.equal(parsed.textStyleVars['--caption-color'], '#AABBCC');
    assert.equal(parsed.textStyleVars['--caption-font-size'], '38px');
    assert.match(parsed.textStyleVars['--caption-text-shadow'], /3px 3px 0 #000000/);
    assert.equal(parsed.textStyleVars['--plate-bg'], 'rgba(68,85,102,0.25)');
    assert.equal(parsed.textStyleVars['--plate-radius'], '12px');
    assert.equal(parsed.textStyleVars['--caption-top'], '7%');
    assert.equal(parsed.textStyleVars['--caption-bottom'], 'auto');
    assert.equal(parsed.textStyleVars['--caption-align-items'], 'flex-end');
    assert.equal(parsed.textStyleVars['--caption-text-align'], 'right');
});

test('8桁hexのアルファは opacity 未指定時だけ使う', () => {
    const [hexAlpha] = parsePreviewCaptions(JSON.stringify({
        default_text_style: { background: { color: '#FF000080' } },
        captions: [caption]
    }));
    assert.equal(hexAlpha.textStyleVars['--plate-bg'], 'rgba(255,0,0,0.502)');

    const [explicitOpacity] = parsePreviewCaptions(JSON.stringify({
        default_text_style: { background: { color: '#FF000080', opacity: 0.2 } },
        captions: [caption]
    }));
    assert.equal(explicitOpacity.textStyleVars['--plate-bg'], 'rgba(255,0,0,0.2)');
});

test('block mode は block 専用 var を使い per-line の既存 var と分離する', () => {
    const [block] = parsePreviewCaptions(JSON.stringify({
        default_text_style: {
            background: { color: '#FF000080', radius_px: 12, mode: 'block' }
        },
        captions: [caption]
    }));
    assert.equal(block.textStyle.background.mode, 'block');
    assert.equal(block.textStyleVars['--plate-block-bg'], 'rgba(255,0,0,0.502)');
    assert.equal(block.textStyleVars['--plate-block-radius'], '12px');
    assert.equal(block.textStyleVars['--plate-bg'], undefined);
    assert.equal(block.textStyleVars['--plate-radius'], undefined);
});

test('text_style: null の字幕を捨てない（指定なし = 既定スタイルで表示する）', () => {
    // captions.schema の検証も共有カーネル mergeCaptionTextStyles も render-cut も Web UI も
    // null を「指定なし」として扱う。旧実装だけが caption ごと破棄しており、実プロジェクトの
    // カラオケ字幕 2 本が無言で消えていた（fieldtest 2026-08-03-preview-feature-matrix）。
    const parsed = parsePreviewCaptions(JSON.stringify([
        { ...caption, id: 'c-0001', text_style: null },
        { ...caption, id: 'c-0002', start: 3, end: 5, text_style: undefined },
        { ...caption, id: 'c-0003', start: 6, end: 8 }
    ]));
    assert.deepEqual(parsed.map(c => c.id), ['c-0001', 'c-0002', 'c-0003']);
});

test('読めない text_style でも字幕本体は残す（既定スタイルへフォールバック）', () => {
    const parsed = parsePreviewCaptions(JSON.stringify([
        { ...caption, id: 'c-0001', text_style: 'これは物ではない' },
        { ...caption, id: 'c-0002', start: 3, end: 5, text_style: 42 }
    ]));
    assert.deepEqual(parsed.map(c => c.id), ['c-0001', 'c-0002']);
    assert.deepEqual(parsed.map(c => c.text), ['字幕', '字幕']);
});

test('words[] 付きカラオケ字幕が text_style: null でも保持される', () => {
    const parsed = parsePreviewCaptions(JSON.stringify([{
        ...caption, id: 'c-0001', style: 'karaoke', text_style: null,
        words: [{ start: 0, end: 1, text: '文字' }, { start: 1, end: 2, text: 'ごと' }]
    }]));
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].style, 'karaoke');
    assert.equal(parsed[0].words.length, 2);
});

test('shared caption-style contract keeps reveal-word while reveal and unknown remain dropped', () => {
    const styleContract = styleParity.caption_style_contract;
    const parsed = parsePreviewCaptions(JSON.stringify([
        { ...caption, id: 'c-0001', style: styleContract.accepted.style },
        { ...caption, id: 'c-0002', start: 3, end: 5, style: 'reveal' },
        { ...caption, id: 'c-0003', start: 6, end: 8, style: styleContract.unknown.style }
    ]));
    assert.equal(parsed[0].style, 'reveal-word');
    assert.equal(parsed[1].style, undefined);
    assert.equal(parsed[2].style, undefined);
});

test('resolved payload remains timeline-domain and preserves source cue identity for writeback', () => {
    const [parsed] = parseResolvedPreviewCaptions({
        schema: 'caption-layout/v1',
        captions: [{
            id: 'c-0001-occ-0001-part-1',
            source_cue_id: 'c-0001',
            start: 3,
            end: 4,
            text: '今回',
            style_vars: { '--caption-left': '261px' }
        }]
    });
    assert.deepEqual(parsed, {
        id: 'c-0001-occ-0001-part-1',
        sourceCueId: 'c-0001',
        resolvedTimeline: true,
        start: 3,
        end: 4,
        text: '今回',
        textStyleVars: { '--caption-left': '261px' }
    });
});

test('shell backend resolves policy while browser source contains no segmentation implementation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-shell-caption-display-'));
    const captionsPath = join(root, 'captions.json');
    const editPath = join(root, 'edit.json');
    await writeFile(captionsPath, JSON.stringify({
        display_policy: {
            mode: 'single_line_sequential',
            algorithm: 'a4-ja-two-fragment-v1',
            unit_metric: 'ascii-half-other-one-v1',
            max_line_units: 6,
            minimum_fragment_duration_seconds: 0.72,
            locale: 'ja'
        },
        captions: [{ ...caption, text: '今回設定します', display_fragments: ['今回', '設定します'] }]
    }));
    await writeFile(editPath, JSON.stringify({
        version: 0,
        source: { path: 'source.mp4' },
        cuts: [{ in: 0, out: 2 }],
        output: { width: 1920, height: 1080, fps: 30 }
    }));
    const service = new AkariPreviewServiceImpl();
    service.workspaceServer = { getMostRecentlyUsedWorkspace: async () => pathToFileURL(root).toString() };
    const payload = await service.resolveCaptionDisplay({
        captionsUri: pathToFileURL(captionsPath).toString(),
        editUri: pathToFileURL(editPath).toString()
    });
    assert.deepEqual(payload.captions.map(cue => cue.text), ['今回', '設定します']);

    await writeFile(captionsPath, JSON.stringify({
        display_policy: {
            mode: 'single_line_sequential',
            algorithm: 'a4-ja-two-fragment-v1',
            unit_metric: 'ascii-half-other-one-v1',
            max_line_units: 6,
            minimum_fragment_duration_seconds: 0.72,
            locale: 'ja'
        },
        captions: [{ ...caption, src: 'ghost' }]
    }));
    await writeFile(editPath, JSON.stringify({
        version: 1,
        sources: [{ id: 'a', path: 'a.mp4' }, { id: 'b', path: 'b.mp4' }],
        cuts: [{ src: 'a', in: 0, out: 2 }],
        output: { width: 1920, height: 1080, fps: 30 }
    }));
    await assert.rejects(service.resolveCaptionDisplay({
        captionsUri: pathToFileURL(captionsPath).toString(),
        editUri: pathToFileURL(editPath).toString()
    }), /captions\[0\]\.src does not reference edit\.json sources/u);

    const browserSource = await readFile(join(extensionRoot, 'src', 'browser', 'akari-preview-captions.ts'), 'utf8');
    assert.doesNotMatch(browserSource, /Intl\.Segmenter/u);
    assert.doesNotMatch(browserSource, /resolveCaptionDisplay\s*\(/u);
});

test('shell RPC direct calls reject malformed opt-in styles and unknown nested keys', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-shell-caption-invalid-style-'));
    try {
        const captionsPath = join(root, 'captions.json');
        const editPath = join(root, 'edit.json');
        await writeFile(editPath, JSON.stringify(styleParity.edit));
        const service = captionService(root);
        await writeFile(captionsPath, JSON.stringify({
            display_policy: styleParity.display_policy,
            default_text_style: { color: 17, size_px: '82', font_weight: '600', line_height: 0 },
            captions: [styleParity.caption]
        }));
        await assert.rejects(resolveFrom(service, captionsPath, editPath), /default_text_style/u);

        await writeFile(captionsPath, JSON.stringify({
            display_policy: styleParity.display_policy,
            captions: [{ ...styleParity.caption, text_style: {
                stroke: { method: 'webkit-outline', color: '#050505', width_px: 5, invented: true }
            } }]
        }));
        await assert.rejects(resolveFrom(service, captionsPath, editPath), /invented/u);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('shared caption-style contract reaches shell RPC and renderer unchanged', async () => {
    const root = await mkdtemp(join(tmpdir(), 'akari-shell-caption-style-contract-'));
    try {
        const captionsPath = join(root, 'captions.json');
        const editPath = join(root, 'edit.json');
        await writeFile(editPath, JSON.stringify(styleParity.edit));
        const service = captionService(root);
        const withStyle = style => ({
            display_policy: styleParity.display_policy,
            captions: [{ ...styleParity.caption, style }]
        });
        await writeFile(captionsPath, JSON.stringify(withStyle(styleParity.caption_style_contract.accepted.style)));
        await assert.rejects(resolveFrom(service, captionsPath, editPath), /style cannot be combined with display_policy/u);

        const rendererSource = await readFile(join(
            extensionRoot, 'src', 'browser', 'akari-preview-open-handler.ts'
        ), 'utf8');
        assert.match(rendererSource, /akari-caption__tok--reveal-word/u);
        assert.match(rendererSource, /--akari-tok-delay/u);
        assert.match(rendererSource, /akari-caption-reveal-word/u);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});

test('kernel, render, preview API, and shell return the exact same complete display cues', async () => {
    const fixture = JSON.parse(await readFile(join(
        repositoryRoot, 'packages/edit-store/test/fixtures/caption-consumer-parity.json'
    ), 'utf8'));
    const kernel = resolveCaptionDisplay(fixture.captionsRoot, fixture.edit, { output: fixture.edit.output });
    const { generateResolvedCaptionOverlays } = await import(pathToFileURL(join(
        repositoryRoot, 'packages/render-cut/src/captions.mjs'
    )).toString());
    const { resolveCaptionApiPayload } = await import(pathToFileURL(join(
        repositoryRoot, 'packages/preview-server/src/caption-api.mjs'
    )).toString());

    const root = await mkdtemp(join(tmpdir(), 'akari-shell-caption-parity-'));
    const captionsPath = join(root, 'captions.json');
    const editPath = join(root, 'edit.json');
    await writeFile(captionsPath, JSON.stringify(fixture.captionsRoot));
    await writeFile(editPath, JSON.stringify(fixture.edit));
    const service = new AkariPreviewServiceImpl();
    service.workspaceServer = { getMostRecentlyUsedWorkspace: async () => pathToFileURL(root).toString() };
    const shell = await service.resolveCaptionDisplay({
        captionsUri: pathToFileURL(captionsPath).toString(),
        editUri: pathToFileURL(editPath).toString()
    });

    assert.deepEqual(generateResolvedCaptionOverlays(kernel).map(overlay => overlay.displayCue), kernel.display_cues);
    assert.deepEqual(resolveCaptionApiPayload(fixture.captionsRoot, fixture.edit).captions, kernel.display_cues);
    assert.deepEqual(shell.captions, kernel.display_cues);
    assert.ok(kernel.display_cues.every(cue => cue.text_style && cue.style_vars && cue.layout));
    await rm(root, { recursive: true, force: true });
});

test('caption display rejects static symlinks for both captions and edit inputs', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'akari-caption-static-link-workspace-'));
    const outside = await mkdtemp(join(tmpdir(), 'akari-caption-static-link-outside-'));
    try {
        const fixture = captionRaceFixture('INSIDE');
        const captionsPath = join(workspace, 'captions.json');
        const editPath = join(workspace, 'edit.json');
        const outsideCaptions = join(outside, 'captions.json');
        const outsideEdit = join(outside, 'edit.json');
        await writeFile(captionsPath, JSON.stringify(fixture.captionsRoot));
        await writeFile(editPath, JSON.stringify(fixture.edit));
        await writeFile(outsideCaptions, JSON.stringify(captionRaceFixture('OUTSIDE').captionsRoot));
        await writeFile(outsideEdit, JSON.stringify({ ...fixture.edit, cuts: [{ in: 0, out: 1 }] }));
        const service = captionService(workspace);

        await rename(captionsPath, `${captionsPath}.regular`);
        await symlink(outsideCaptions, captionsPath);
        await assert.rejects(resolveFrom(service, captionsPath, editPath), /symlink|safely/u);
        await rm(captionsPath);
        await rename(`${captionsPath}.regular`, captionsPath);

        await rename(editPath, `${editPath}.regular`);
        await symlink(outsideEdit, editPath);
        await assert.rejects(resolveFrom(service, captionsPath, editPath), /symlink|safely/u);
    } finally {
        await rm(workspace, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    }
});

test('caption and edit retarget races never return outside content across 10k RPC calls each', { timeout: 180_000 }, async t => {
    const workspace = await mkdtemp(join(tmpdir(), 'akari-caption-race-workspace-'));
    const outside = await mkdtemp(join(tmpdir(), 'akari-caption-race-outside-'));
    try {
        const fixture = captionRaceFixture('INSIDE');
        const captionsPath = join(workspace, 'captions.json');
        const editPath = join(workspace, 'edit.json');
        const outsideCaptions = join(outside, 'captions.json');
        const outsideEdit = join(outside, 'edit.json');
        await writeFile(captionsPath, JSON.stringify(fixture.captionsRoot));
        await writeFile(editPath, JSON.stringify(fixture.edit));
        await writeFile(outsideCaptions, JSON.stringify(captionRaceFixture('OUTSIDE').captionsRoot));
        await writeFile(outsideEdit, JSON.stringify({ ...fixture.edit, cuts: [{ in: 0, out: 1 }] }));
        const service = captionService(workspace);

        const captionsRace = await stressRetarget({
            service, racePath: captionsPath, outsidePath: outsideCaptions,
            request: () => resolveFrom(service, captionsPath, editPath),
            outsideSeen: payload => payload?.captions?.some(cue => cue.text === 'OUTSIDE')
        });
        assert.equal(captionsRace.outside, 0);
        assert.ok(captionsRace.rejected > 0);

        const editRace = await stressRetarget({
            service, racePath: editPath, outsidePath: outsideEdit,
            request: () => resolveFrom(service, captionsPath, editPath),
            outsideSeen: payload => payload?.captions?.some(cue => cue.end === 1)
        });
        assert.equal(editRace.outside, 0);
        assert.ok(editRace.rejected > 0);
        assert.equal(captionsRace.attempts, 10_000);
        assert.equal(editRace.attempts, 10_000);
        t.diagnostic(`captions race: attempts=${captionsRace.attempts} rejected=${captionsRace.rejected} outside=${captionsRace.outside}`);
        t.diagnostic(`edit race: attempts=${editRace.attempts} rejected=${editRace.rejected} outside=${editRace.outside}`);
    } finally {
        await rm(workspace, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
    }
});

function captionRaceFixture(text) {
    return {
        captionsRoot: {
            display_policy: {
                mode: 'single_line_sequential', algorithm: 'a4-ja-two-fragment-v1',
                unit_metric: 'ascii-half-other-one-v1', max_line_units: 20,
                minimum_fragment_duration_seconds: 0.72, locale: 'ja'
            },
            captions: [{ ...caption, text, sourceRef: null }]
        },
        edit: {
            version: 0, source: { path: 'source.mp4' }, cuts: [{ in: 0, out: 2 }],
            output: { width: 1920, height: 1080, fps: 30 }
        }
    };
}

function captionService(workspace) {
    const service = new AkariPreviewServiceImpl();
    service.workspaceServer = { getMostRecentlyUsedWorkspace: async () => pathToFileURL(workspace).toString() };
    return service;
}

function resolveFrom(service, captionsPath, editPath) {
    return service.resolveCaptionDisplay({
        captionsUri: pathToFileURL(captionsPath).toString(),
        editUri: pathToFileURL(editPath).toString()
    });
}

async function stressRetarget({ racePath, outsidePath, request, outsideSeen }) {
    const regularSlot = `${racePath}.inside`;
    const linkSlot = `${racePath}.outside-link`;
    await symlink(outsidePath, linkSlot);
    let running = true;
    const flipper = (async () => {
        while (running) {
            try {
                await rename(racePath, regularSlot);
                await rename(linkSlot, racePath);
                await rename(racePath, linkSlot);
                await rename(regularSlot, racePath);
            } catch {
                // Expected if the test is stopping between atomic rename steps.
            }
        }
    })();
    let rejected = 0;
    let outside = 0;
    const attempts = 10_000;
    for (let offset = 0; offset < attempts; offset += 32) {
        await Promise.all(Array.from({ length: Math.min(32, attempts - offset) }, async () => {
            try {
                const payload = await request();
                if (outsideSeen(payload)) outside += 1;
            } catch {
                rejected += 1;
            }
        }));
    }
    running = false;
    await flipper;
    if (await fileExists(regularSlot)) {
        await rm(racePath, { force: true });
        await rename(regularSlot, racePath);
    }
    await rm(linkSlot, { force: true });
    return { attempts, rejected, outside };
}

async function fileExists(path) {
    try {
        await readFile(path);
        return true;
    } catch {
        return false;
    }
}
