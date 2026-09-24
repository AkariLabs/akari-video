#!/usr/bin/env node
// マイスタイル「動き」部品の AFTER（L1・受け入れ条件の判定つき）。ラッパー作成の検証スクリプト。
// 使い方: node after.mjs <作業用ディレクトリ（実体パス）>   （fixture = <作業用>/fixture/spoken。CDP_PORT 既定 9489）
// 流れ: 保存（c-0001 = 見た目 + 動き / c-0005 = 動きなし / c-0004 = プリセット由来の動き / 動きだけ）→ 棚（チップ・見本の再生）→
//       3 本に「動きだけ」→ undo →「見た目だけ」→ undo →「両方」→ undo（各回: 前回外した部品が次回の既定）→
//       未対応の部品の無効表示 → 部品 1 つのスタイルは即当てる → ＋ / ドラッグ → 起動し直しても既定が残る。
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evalOn, realClick } from './cdp-lib.mjs';
import { command, launch, sanitize, sleep, stop } from './l1-lib.mjs';
import { openProject, view } from './l1-common.mjs';
import { prepareLibrary } from './library-home.mjs';
import { DIALOG, NOTICE, S, SHELF, center, clickSel, deepKeys, dismissToasts, key, openShelf, setupWindow, shotTo, styleFiles, typeInto, waitFor, widenTimeline } from './common.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.dirname(HERE);
const REPO = path.resolve(OUT, '..', '..', '..', '..', '..', '..');
const WORK = process.argv[2];
const PORT = Number(process.env.CDP_PORT || 9489);
const PJ = path.join(WORK, 'ws');
const ISO = path.join(WORK, 'iso');
const LIBRARY = path.join(WORK, 'creator', 'library');
const STYLES = path.join(LIBRARY, 'styles');
const SHELL = path.join(REPO, 'apps', 'shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const FIXTURE_CAPTIONS = path.join(WORK, 'fixture', 'spoken', 'captions.json');
const out = { phase: 'after', base: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), checks: [], screenshots: [] };
const RESULTS = path.join(OUT, 'results-after.json');
const POSITION_KEYS = ['text_anchor', 'position', 'zone', 'textAnchor'];
const LOOK_KEYS = ['color', 'size_px', 'font_weight', 'stroke', 'background', 'shadow', 'glow', 'reference_height_px'];
const ABS = /(^|["'\s])(\/(Users|private|tmp|var|home|Volumes)\/|[A-Za-z]:\\|\\\\|file:\/\/|~\/)/;
const SOURCE_MOTION = { in: { id: 'fade-up', duration_sec: 0.6 }, loop: { id: 'float' } };
const SOURCE_LOOK = { color: '#FFD400', size_px: 52, font_weight: 900, stroke: { color: '#D12B2B', width_px: 5 },
    background: { color: '#1E3A8A', opacity: 0.85, radius_px: 12, mode: 'block' },
    shadow: { color: '#000000', opacity: 0.6, blur_px: 6, distance_px: 6, angle_deg: 90 },
    glow: { color: '#000000', density: 0 }, reference_height_px: 720 };
const TARGETS = ['c-0002', 'c-0003', 'c-0004'];
const TIMES = { 'c-0001': 1, 'c-0002': 4, 'c-0003': 7, 'c-0004': 10, 'c-0005': 13 };
// 未対応の部品（効果音）入りのスタイルを起動前に手で置く（未対応の部品の無効表示の確認用）
const HAND_SFX = { schema: 'akari-style', version: 1, revision: 1, uid: '01K5ZXY123ABCDEFGHJKMNPQRS', id: 'hand-sfx',
    name: '効果音つき', when_to_use: '登場で音を鳴らしたいとき', sample_text: 'ここがいちばん大事',
    created_at: '2026-09-24T00:00:00.000Z', updated_at: '2026-09-24T00:00:00.000Z', tags: [], visibility: 'private', price: null,
    requires: [], provenance: {}, license: { spdx: 'LicenseRef-user-owned', scope: 'private-owned', attribution_required: false, ai_training_allowed: false },
    parts: [{ kind: 'look', scope: 'caption', mode: 'modify', text_style: { color: '#00E5FF', size_px: 48, reference_height_px: 720,
        stroke: { color: '#002233', width_px: 4 }, background: { opacity: 0 }, shadow: { color: '#000000', opacity: 0 }, glow: { color: '#000000', density: 0 } } },
    { kind: 'motion', scope: 'caption', mode: 'modify', animation: { in: { id: 'pop', duration_sec: 0.4 } } },
    { kind: 'sfx', scope: 'caption', mode: 'attach', attach: { at: 'in', offset_frames: 0 }, sound: { category: 'sfx', id: 'pico' } }] };

const scrub = value => JSON.parse(S(value).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>'));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
async function check(name, operation) {
    const record = { name, pass: false };
    out.checks.push(record);
    try { record.detail = await operation(); record.pass = true; }
    catch (error) { record.error = sanitize(error, REPO).replaceAll(WORK, '<work>'); }
    finally { await writeFile(RESULTS, `${S(scrub(out), null, 2)}\n`); }
    console.log(`${record.pass ? 'PASS' : 'FAIL'} ${name}${record.error ? ` — ${record.error.slice(0, 300)}` : ''}`);
    return record.detail;
}
const shot = async (cdp, name) => { await shotTo(cdp, WORK, path.join(OUT, `after-${name}.png`)); out.screenshots.push(`after-${name}.png`); };
const captionsText = () => readFile(path.join(PJ, 'captions.json'), 'utf8');
const captions = async () => JSON.parse(await captionsText()).captions;
const byId = async () => Object.fromEntries((await captions()).map(c => [c.id, c]));
const usage = async () => { try { return JSON.parse(await readFile(path.join(PJ, '.akari', 'style-usage.json'), 'utf8')); } catch { return null; } };
const editUri = () => `file://${path.join(PJ, 'edit.json')}`;
const select = (cdp, ids) => evalOn(cdp, command('akari.timeline.selectCaptions', { editUri: editUri(), captionIds: ids }));
const withoutKeys = (value, keys) => Object.fromEntries(Object.entries(value ?? {}).filter(([k]) => !keys.includes(k)));
const lookOf = style => Object.fromEntries(LOOK_KEYS.map(k => [k, style?.[k]]));
async function undoOnce(cdp) {
    await evalOn(cdp, `(()=>{document.activeElement?.blur?.();return true})()`);
    await key(cdp, 'z', 'KeyZ', 90, 4);
    const original = await readFile(FIXTURE_CAPTIONS, 'utf8');
    let equal = false;
    for (let i = 0; i < 24 && !equal; i++) { await sleep(250); equal = (await captionsText()) === original; }
    await sleep(800);
    return { captionsEqualFixture: (await captionsText()) === original, gitStatus: execFileSync('/usr/bin/git', ['status', '--porcelain', '--', 'captions.json', 'edit.json'], { cwd: PJ, encoding: 'utf8' }) };
}
const POPOVER = `(()=>{const p=document.querySelector('[data-akari-my-style-apply-popover]');if(!p)return null;const r=p.getBoundingClientRect();return{rect:{x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)},text:p.innerText.replace(/\\n+/g,' / '),inputs:[...p.querySelectorAll('input[type=checkbox]')].map(i=>({kind:i.value,checked:i.checked,disabled:i.disabled,label:i.closest('label')?.textContent.trim()})),confirmDisabled:[...p.querySelectorAll('button')].find(b=>b.textContent.trim()==='当てる')?.disabled??null,emoji:/[\\p{Extended_Pictographic}]/u.test(p.textContent)}})()`;
const inputSel = kind => `[data-akari-my-style-apply-popover] input[value=${S(kind)}]`;
async function openPopover(cdp, styleId) {
    await clickSel(cdp, `[data-akari-my-style-apply=${S(styleId)}]`);
    return waitFor('apply popover', () => evalOn(cdp, POPOVER), 10_000);
}
async function setParts(cdp, wanted) {
    for (const [kind, on] of Object.entries(wanted)) {
        const state = await evalOn(cdp, `(()=>{const i=document.querySelector(${S(inputSel(kind))});return i?{checked:i.checked,disabled:i.disabled}:null})()`);
        assert(state && !state.disabled, `${kind} input missing/disabled`);
        if (state.checked !== on) await clickSel(cdp, inputSel(kind));
    }
    return evalOn(cdp, POPOVER);
}
async function confirmPopover(cdp) {
    const p = await waitFor('confirm button', () => evalOn(cdp, `(()=>{const b=[...document.querySelectorAll('[data-akari-my-style-apply-popover] button')].find(b=>b.textContent.trim()==='当てる');if(!b)return null;const r=b.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`));
    await realClick(cdp, p.x, p.y);
    await sleep(300);
}
const defaults = pop => Object.fromEntries(pop.inputs.map(i => [i.kind, i.checked]));
// 出力プレビューの字幕の描画: 付いている CSS アニメーション名と見た目（文字色・大きさ・縁取り）
const PLATE = id => `(()=>{const want='caption-plate-'+encodeURIComponent(${S(id)});const p=document.getElementById(want)||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith(want));if(!p)return null;const l=p.querySelector('.akari-caption__line')||p;const cs=getComputedStyle(l);return{animations:[...new Set(p.getAnimations({subtree:true}).map(a=>a.animationName).filter(Boolean))].sort(),color:cs.color,fontSize:cs.fontSize,stroke:cs.webkitTextStrokeColor+' '+cs.webkitTextStrokeWidth}})()`;
async function previewPlates(cdp, ids, until) {
    const v = await view(PORT);
    const got = {}, waitedMs = {};
    try {
        for (const id of ids) {
            await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), waitForReady: true, time: TIMES[id] + 0.2 }));
            const t0 = Date.now();
            got[id] = await waitFor(`plate ${id}`, () => v.eval(PLATE(id)), 20_000);
            const deadline = Date.now() + 15_000;
            while (until && !until(id, got[id]) && Date.now() < deadline) { await sleep(250); got[id] = await v.eval(PLATE(id)) ?? got[id]; }
            waitedMs[id] = Date.now() - t0;
        }
    } finally { v.cdp?.close?.(); }
    return { plates: got, waitedMs };
}
const HAS_SOURCE_MOTION = (id, p) => p?.animations?.includes('akari-anim-fade-up') && p.animations.includes('akari-anim-float');
// 書き出しの字幕描画（render-cut）が cue の text_style.animation から作る CSS アニメーション。
// 出力プレビュー（akari-preview）は基点の時点で textanim の動きを描かない（BEFORE / AFTER とも plate の CSS アニメーション 0 件・
// opacity / transform も時刻で変わらない。report の「未確認事項」）ので、動きの再生は書き出し側の描画で確かめる。
const { buildCaptionAnimation } = await import(pathToFileURL(path.join(REPO, 'packages', 'render-cut', 'src', 'captions.mjs')).href);
const presetAnimation = async id => id ? JSON.parse(await readFile(path.join(REPO, 'presets', 'textstyle', `${id}.json`), 'utf8')).style?.animation : undefined;
const exportAnimation = async row => buildCaptionAnimation({ ...(await presetAnimation(row.style_preset)), ...row.text_style?.animation }, row.end - row.start)?.animationCss ?? null;
const usageCount = async () => (await usage())?.entries?.length ?? 0;
const nextUsage = async count => (await waitFor('usage appended', async () => { const u = await usage(); return u?.entries?.length > count ? u : null; }, 30_000)).entries.at(-1);

await rm(PJ, { recursive: true, force: true });
await rm(path.join(WORK, 'creator'), { recursive: true, force: true });
await mkdir(path.join(STYLES, 'hand-sfx'), { recursive: true });
await writeFile(path.join(STYLES, 'hand-sfx', 'style.json'), `${S(HAND_SFX, null, 2)}\n`);
// scope / mode を書いていない motion 部品（mystyle-look-v0 の証跡で手で足した形）: 読めて棚に残ること
const HAND_BARE = { ...HAND_SFX, uid: '01K5ZXY123ABCDEFGHJKMNPQRT', id: 'hand-bare-motion', name: '手書きの動き',
    parts: [HAND_SFX.parts[0], { kind: 'motion', animation: { in: { id: 'zoom-pop' } } }] };
await mkdir(path.join(STYLES, 'hand-bare-motion'), { recursive: true });
const HAND_BARE_TEXT = `${S(HAND_BARE, null, 2)}\n`;
await writeFile(path.join(STYLES, 'hand-bare-motion', 'style.json'), HAND_BARE_TEXT);
await cp(path.join(WORK, 'fixture', 'spoken'), PJ, { recursive: true });
process.chdir(REPO); // テキストスタイルの索引の探索が cwd 基準
const preparedLaunch = keep => launch({ shellDir: SHELL, electron: ELECTRON, project: PJ, port: PORT, isoDir: ISO, keep, prepare: iso => prepareLibrary(iso, LIBRARY) });
let session = await preparedLaunch(false);
let styleId, motionOnlyId, fixtureRows, previewBefore;
try {
    let cdp = session.cdp;
    await openProject(session, PJ, 1, PORT);
    await setupWindow(cdp);
    out.window = await evalOn(cdp, '({w:innerWidth,h:innerHeight})');
    fixtureRows = await byId();
    previewBefore = await previewPlates(cdp, ['c-0001', ...TARGETS]);
    out.previewBefore = previewBefore;

    // ===== 1. 保存 =====
    const openSave = async id => {
        await select(cdp, [id]);
        await evalOn(cdp, command('akari.inspector.open'));
        await sleep(1200);
        // 負荷が高いとインスペクターの描き直しの途中で ⋯ を押して空振りするので、メニュー項目が出るまで押し直す（最大 6 回）
        const text = fixtureRows[id].text.slice(0, 6);
        await waitFor('inspector shows the caption', () => evalOn(cdp, `(()=>{const h=document.querySelector('.akari-inspector-selection-header');return Boolean(h&&h.textContent.includes(${S(text)})&&h.querySelector('[data-akari-my-style-inspector-menu]'))})()`), 60_000);
        for (let attempt = 0; attempt < 6; attempt++) {
            await clickSel(cdp, '[data-akari-my-style-inspector-menu]');
            const shown = await waitFor('menu item', () => evalOn(cdp, `(()=>{const s=document.querySelector('[data-akari-my-style-inspector-save]');return Boolean(s&&!s.hidden&&s.getBoundingClientRect().width>0)})()`), 5_000).catch(() => false);
            if (shown) break;
        }
        await clickSel(cdp, '[data-akari-my-style-inspector-save]');
        return waitFor('dialog', () => evalOn(cdp, DIALOG), 60_000);
    };
    const partsOf = dialog => Object.fromEntries(dialog.parts.map(p => [p.kind, p]));
    await check('保存ダイアログ（動きのある c-0001）: 「動き」が有効で既定でチェック・見た目もチェック・効果音ほかは近日', async () => {
        const dialog = await openSave('c-0001');
        const p = partsOf(dialog);
        assert(p.look?.checked && !p.look.disabled, `look ${S(p.look)}`);
        assert(p.motion?.checked && !p.motion.disabled && !/近日|ありません/.test(p.motion.label), `motion ${S(p.motion)}`);
        for (const k of ['sfx', 'fx', 'decor']) assert(p[k]?.disabled && /近日/.test(p[k].label), `${k} ${S(p[k])}`);
        return dialog;
    });
    await typeInto(cdp, '[data-akari-my-style-name]', '登場で持ち上がる強調');
    await typeInto(cdp, '[data-akari-my-style-when]', '大事な一言をふわっと出したいとき');
    await shot(cdp, '01-save-dialog-motion');
    await check('保存（見た目 + 動き）→ style.json の parts = [look, motion]・motion.animation = 保存元の動き（登場 fade-up・ループ float）・look に animation なし', async () => {
        const before = Object.keys(await styleFiles(STYLES));
        await clickSel(cdp, '[data-akari-my-style-save]');
        const files = await waitFor('style.json written', async () => { const f = await styleFiles(STYLES); return Object.keys(f).length > before.length ? f : null; });
        await waitFor('dialog closed', async () => !(await evalOn(cdp, `Boolean(document.querySelector('[data-akari-my-style-dialog]'))`)));
        styleId = Object.keys(files).find(id => !before.includes(id));
        const text = files[styleId];
        const style = JSON.parse(text);
        assert(S(style.parts.map(p => p.kind)) === S(['look', 'motion']), `parts ${S(style.parts.map(p => p.kind))}`);
        const motion = style.parts[1];
        assert(motion.scope === 'caption' && motion.mode === 'modify', `motion scope/mode ${S(motion)}`);
        assert(S(motion.animation) === S(SOURCE_MOTION), `motion.animation ${S(motion.animation)}`);
        const look = style.parts[0].text_style;
        assert(!deepKeys(style.parts[0]).includes('animation'), 'look has animation');
        for (const k of LOOK_KEYS) assert(S(look[k]) === S(SOURCE_LOOK[k]), `${k}: ${S(look[k])} != ${S(SOURCE_LOOK[k])}`);
        assert(!deepKeys(style).some(k => POSITION_KEYS.includes(k) || k === 'layout'), 'position / layout key present');
        assert(!ABS.test(text), 'absolute path present');
        assert(style.schema === 'akari-style' && style.version === 1 && style.revision === 1, 'schema/version/revision');
        return { relativeFile: `styles/${styleId}/style.json`, style };
    });
    await check('保存ダイアログ（動きの無い c-0005）: 「動き」は無効・「この字幕には動きがありません」', async () => {
        const dialog = await openSave('c-0005');
        const p = partsOf(dialog);
        assert(p.motion?.disabled && !p.motion.checked && /この字幕には動きがありません/.test(p.motion.label), `motion ${S(p.motion)}`);
        assert(p.look?.checked && !p.look.disabled, `look ${S(p.look)}`);
        await shot(cdp, '02-save-dialog-no-motion');
        await sleep(200);
        await key(cdp, 'Escape', 'Escape', 27);
        await waitFor('dialog closed', async () => !(await evalOn(cdp, `Boolean(document.querySelector('[data-akari-my-style-dialog]'))`)));
        return dialog;
    });
    await check('保存ダイアログ（style_preset emphasis-red だけの c-0004）: プリセット由来の動き（登場 pop）があるので「動き」が既定でチェック', async () => {
        const dialog = await openSave('c-0004');
        const p = partsOf(dialog);
        assert(p.motion?.checked && !p.motion.disabled, `motion ${S(p.motion)}`);
        await sleep(200);
        await key(cdp, 'Escape', 'Escape', 27);
        await waitFor('dialog closed', async () => !(await evalOn(cdp, `Boolean(document.querySelector('[data-akari-my-style-dialog]'))`)));
        return dialog;
    });
    await check('保存（動きだけ = 見た目のチェックを外す）→ parts = [motion] だけ', async () => {
        await openSave('c-0001');
        await typeInto(cdp, '[data-akari-my-style-name]', '動きだけ');
        await typeInto(cdp, '[data-akari-my-style-when]', '見た目はそのままで動きだけ付けたいとき');
        await clickSel(cdp, '[data-akari-my-style-dialog] [data-akari-my-style-part-input="look"]');
        const before = Object.keys(await styleFiles(STYLES));
        await clickSel(cdp, '[data-akari-my-style-save]');
        const files = await waitFor('style.json written', async () => { const f = await styleFiles(STYLES); return Object.keys(f).length > before.length ? f : null; });
        motionOnlyId = Object.keys(files).find(id => !before.includes(id));
        const style = JSON.parse(files[motionOnlyId]);
        assert(S(style.parts.map(p => p.kind)) === S(['motion']) && S(style.parts[0].animation) === S(SOURCE_MOTION), `parts ${S(style.parts)}`);
        return { style };
    });

    // ===== 2. 棚 =====
    await openShelf(cdp);
    await check('棚: チップ「見た目」「動き」（当てないの注記なし）・未対応の効果音は「効果音（当てない）」・操作は 1 行', async () => {
        const shelf = await waitFor('shelf cards', async () => { const s = await evalOn(cdp, SHELF); return s?.cards?.length >= 4 ? s : null; });
        const card = shelf.cards.find(c => c.id === styleId);
        assert(card && S(card.parts) === S([{ kind: 'look', label: '見た目' }, { kind: 'motion', label: '動き' }]), `parts ${S(card?.parts)}`);
        const sfx = shelf.cards.find(c => c.id === 'hand-sfx');
        assert(sfx && sfx.parts.find(p => p.kind === 'sfx')?.label === '効果音（当てない）' && sfx.parts.find(p => p.kind === 'motion')?.label === '動き', `sfx card ${S(sfx?.parts)}`);
        const only = shelf.cards.find(c => c.id === motionOnlyId);
        assert(only && S(only.parts) === S([{ kind: 'motion', label: '動き' }]), `motion-only card ${S(only?.parts)}`);
        const bare = shelf.cards.find(c => c.id === 'hand-bare-motion');
        assert(bare && S(bare.parts) === S([{ kind: 'look', label: '見た目' }, { kind: 'motion', label: '動き' }]), `scope / mode の無い motion の card ${S(bare?.parts)}`);
        assert((await readFile(path.join(STYLES, 'hand-bare-motion', 'style.json'), 'utf8')) === HAND_BARE_TEXT, 'hand-bare-motion rewritten');
        for (const c of shelf.cards) assert(c.buttonRows === 1, `${c.id} buttons wrap ${c.buttonRows}`);
        return shelf;
    });
    await check('棚: 見本はマウスを乗せたときだけ動きを 1 回再生（乗せる前 0 → 乗せた直後 1 → 終わると 0 のまま）', async () => {
        const sel = `[data-akari-my-style-card=${S(styleId)}] [data-akari-my-style-preview]`;
        const count = `(()=>{const e=document.querySelector(${S(sel)});return e.getAnimations().map(a=>({state:a.playState,iterations:a.effect?.getComputedTiming?.().iterations,duration:a.effect?.getComputedTiming?.().duration}))})()`;
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 890, button: 'none' });
        await sleep(300);
        const p = await center(cdp, sel, 'center');
        const idle = await evalOn(cdp, count);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'none' });
        await sleep(120);
        const playing = await evalOn(cdp, count);
        const midFrame = await evalOn(cdp, `(()=>{const e=document.querySelector(${S(sel)});const cs=getComputedStyle(e);return{opacity:cs.opacity,transform:cs.transform}})()`);
        await shot(cdp, '03-shelf-hover');
        await sleep(1500);
        const after = await evalOn(cdp, count);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x + 20, y: p.y + 5, button: 'none' });
        await sleep(200);
        const movedInside = await evalOn(cdp, count);
        assert(idle.length === 0, `idle ${S(idle)}`);
        assert(playing.length === 1 && playing[0].iterations === 1, `playing ${S(playing)}`);
        assert(after.filter(a => a.state === 'running').length === 0, `after ${S(after)}`);
        assert(movedInside.filter(a => a.state === 'running').length === 0, `re-triggered inside the card ${S(movedInside)}`);
        return { idle, playing, midFrame, after, movedInside };
    });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 890, button: 'none' });

    // ===== 3. 3 本に 動きだけ → 見た目だけ → 両方（各 undo 1 回）=====
    await select(cdp, TARGETS);
    await sleep(800);
    await check('当てる → 部品のチェック（小さなポップオーバー: 見た目 / 動き・初回の既定は両方）', async () => {
        const pop = await openPopover(cdp, styleId);
        assert(S(defaults(pop)) === S({ look: true, motion: true }), `defaults ${S(pop.inputs)}`);
        assert(pop.inputs.every(i => !i.disabled), 'disabled input');
        assert(pop.rect.w <= 240 && pop.rect.h <= 200, `popover size ${S(pop.rect)}`);
        assert(!pop.emoji, 'emoji');
        await shot(cdp, '04-apply-popover');
        return pop;
    });
    await check('動きだけ（見た目を外す）→ 3 本とも animation = 保存元の動き（c-0002 の退場は消える）・見た目・位置・style_preset は不変', async () => {
        const pop = await setParts(cdp, { look: false, motion: true });
        const count = await usageCount();
        await confirmPopover(cdp);
        await waitFor('captions written', async () => (await captionsText()) !== await readFile(FIXTURE_CAPTIONS, 'utf8'));
        await sleep(1000);
        const rows = await byId();
        for (const id of TARGETS) {
            const before = fixtureRows[id], after = rows[id];
            assert(S(after.text_style?.animation) === S(SOURCE_MOTION), `${id}.animation ${S(after.text_style?.animation)}`);
            assert(S(withoutKeys(after.text_style, ['animation'])) === S(withoutKeys(before.text_style, ['animation'])), `${id} look/position changed ${S(after.text_style)}`);
            assert(after.style_preset === before.style_preset, `${id}.style_preset ${after.style_preset}`);
        }
        for (const id of ['c-0001', 'c-0005']) assert(S(rows[id]) === S(fixtureRows[id]), `${id} changed`);
        const last = await nextUsage(count);
        const saved = JSON.parse((await styleFiles(STYLES))[styleId]);
        assert(S(last.caption_ids) === S(TARGETS) && S(last.parts) === S(['motion']) && last.style_uid === saved.uid && last.revision === saved.revision, `usage ${S(last)}`);
        const notices = await evalOn(cdp, NOTICE);
        assert(!notices.some(n => /当てません/.test(n)), `notice ${S(notices)}`);
        return { popover: pop, after: Object.fromEntries(TARGETS.map(id => [id, { text_style: rows[id].text_style ?? null, style_preset: rows[id].style_preset ?? null }])), usage: last, notices };
    });
    await check('動きだけ: 書き出しの字幕描画で 3 本に登場 fade-up・ループ float（c-0002 の pop / slide-down・c-0004 のプリセットの pop は無い）・出力プレビューの見た目（色・大きさ・縁取り）は当てる前と同じ', async () => {
        const rows = await byId();
        const exported = {}; for (const id of TARGETS) exported[id] = { before: await exportAnimation(fixtureRows[id]), after: await exportAnimation(rows[id]) };
        for (const id of TARGETS) {
            const css = exported[id].after ?? '';
            assert(/akari-anim-fade-up 0\.6s/.test(css) && /akari-anim-float /.test(css) && !/slide-down|akari-anim-pop/.test(css), `${id} export animation ${css}`);
        }
        const r = await previewPlates(cdp, TARGETS);
        r.exportAnimation = exported;
        for (const id of TARGETS) {
            const b = previewBefore.plates[id];
            assert(r.plates[id].color === b.color && r.plates[id].fontSize === b.fontSize && r.plates[id].stroke === b.stroke, `${id} look changed ${S(b)} -> ${S(r.plates[id])}`);
        }
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), waitForReady: true, time: 7.2 }));
        await sleep(1200);
        await shot(cdp, '05-motion-only-preview');
        return r;
    });
    await check('動きだけ: Cmd+Z 1 回で captions.json が fixture と byte 一致', async () => {
        const r = await undoOnce(cdp);
        assert(r.captionsEqualFixture && r.gitStatus === '', S(r));
        return r;
    });
    await check('次回の既定: 前回外した「見た目」が外れた状態で開く → 見た目だけ（動きを外す）→ 見た目 = 保存元・animation は不変', async () => {
        await select(cdp, TARGETS);
        await sleep(600);
        const pop = await openPopover(cdp, styleId);
        assert(S(defaults(pop)) === S({ look: false, motion: true }), `defaults after motion-only ${S(pop.inputs)}`);
        await shot(cdp, '06-popover-remembered');
        const set = await setParts(cdp, { look: true, motion: false });
        const count = await usageCount();
        await confirmPopover(cdp);
        await waitFor('captions written', async () => (await captionsText()) !== await readFile(FIXTURE_CAPTIONS, 'utf8'));
        await sleep(1000);
        const rows = await byId();
        for (const id of TARGETS) {
            const before = fixtureRows[id], after = rows[id];
            for (const k of LOOK_KEYS) assert(S(after.text_style?.[k]) === S(SOURCE_LOOK[k]), `${id}.${k} ${S(after.text_style?.[k])}`);
            assert(S(after.text_style?.animation) === S(before.text_style?.animation), `${id}.animation changed ${S(after.text_style?.animation)}`);
            for (const k of POSITION_KEYS) assert(S(after.text_style?.[k]) === S(before.text_style?.[k]), `${id}.${k} changed`);
        }
        const last = await nextUsage(count);
        assert(S(last.parts) === S(['look']) && S(last.caption_ids) === S(TARGETS), `usage ${S(last)}`);
        return { defaults: pop, set, after: Object.fromEntries(TARGETS.map(id => [id, { text_style: rows[id].text_style ?? null, style_preset: rows[id].style_preset ?? null }])), usage: last };
    });
    await check('見た目だけ: 出力プレビューで 3 本の色・大きさ・縁取りが保存元 c-0001 と同じ・動きは当てる前のまま', async () => {
        const r = await previewPlates(cdp, TARGETS, (id, p) => p?.color === previewBefore.plates['c-0001'].color);
        const c1 = previewBefore.plates['c-0001'];
        for (const id of TARGETS) {
            assert(r.plates[id].color === c1.color && r.plates[id].stroke === c1.stroke, `${id} look ${S(r.plates[id])} != ${S(c1)}`);
        }
        assert(S(r.plates['c-0002'].animations) === S(previewBefore.plates['c-0002'].animations), `c-0002 animations ${S(r.plates['c-0002'].animations)} vs ${S(previewBefore.plates['c-0002'].animations)}`);
        assert(!HAS_SOURCE_MOTION('c-0003', r.plates['c-0003']), `c-0003 got motion ${S(r.plates['c-0003'].animations)}`);
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), waitForReady: true, time: 7.2 }));
        await sleep(1200);
        await shot(cdp, '07-look-only-preview');
        return r;
    });
    await check('見た目だけ: Cmd+Z 1 回で byte 一致', async () => {
        const r = await undoOnce(cdp);
        assert(r.captionsEqualFixture && r.gitStatus === '', S(r));
        return r;
    });
    await check('次回の既定: 前回外した「動き」が外れた状態で開く → 両方 → 見た目 + 動き（style_preset は外れる）', async () => {
        await select(cdp, TARGETS);
        await sleep(600);
        const pop = await openPopover(cdp, styleId);
        assert(S(defaults(pop)) === S({ look: true, motion: false }), `defaults after look-only ${S(pop.inputs)}`);
        const set = await setParts(cdp, { look: true, motion: true });
        const count = await usageCount();
        await confirmPopover(cdp);
        await waitFor('captions written', async () => (await captionsText()) !== await readFile(FIXTURE_CAPTIONS, 'utf8'));
        await sleep(1000);
        const rows = await byId();
        for (const id of TARGETS) {
            const before = fixtureRows[id], after = rows[id];
            for (const k of LOOK_KEYS) assert(S(after.text_style?.[k]) === S(SOURCE_LOOK[k]), `${id}.${k}`);
            assert(S(after.text_style?.animation) === S(SOURCE_MOTION), `${id}.animation ${S(after.text_style?.animation)}`);
            for (const k of POSITION_KEYS) assert(S(after.text_style?.[k]) === S(before.text_style?.[k]), `${id}.${k} changed`);
            assert(after.style_preset === undefined, `${id}.style_preset remains`);
        }
        const last = await nextUsage(count);
        assert(S(last.parts) === S(['look', 'motion']), `usage ${S(last)}`);
        return { defaults: pop, set, usage: last };
    });
    await check('両方: 出力プレビューで 3 本とも保存元の見た目・書き出しの字幕描画で登場 fade-up・ループ float', async () => {
        const c1 = previewBefore.plates['c-0001'];
        const r = await previewPlates(cdp, TARGETS, (id, p) => p?.color === c1.color);
        const rows = await byId();
        r.exportAnimation = {}; for (const id of TARGETS) r.exportAnimation[id] = await exportAnimation(rows[id]);
        for (const id of TARGETS) {
            assert(r.plates[id].color === c1.color && r.plates[id].stroke === c1.stroke, `${id} ${S(r.plates[id])}`);
            assert(/akari-anim-fade-up 0\.6s/.test(r.exportAnimation[id] ?? '') && /akari-anim-float /.test(r.exportAnimation[id] ?? ''), `${id} export ${r.exportAnimation[id]}`);
        }
        // 登場の途中（開始 + 0.2 秒）と登場後（+ 1.2 秒）で描画が変わる = 動きが再生される
        const v = await view(PORT);
        const frame = `(()=>{const p=document.getElementById('caption-plate-c-0003')||[...document.querySelectorAll('.caption-row-plate')].find(e=>e.id.startsWith('caption-plate-c-0003'));if(!p)return null;const els=[p,...p.querySelectorAll('*')];return els.map(e=>{const cs=getComputedStyle(e);return cs.opacity+'|'+cs.transform}).join(';')})()`;
        const frames = {};
        for (const t of [6.05, 6.3, 7.2]) {
            await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), waitForReady: true, time: t }));
            await sleep(900);
            frames[t] = await v.eval(frame);
        }
        v.cdp?.close?.();
        // 記録のみ（出力プレビューは textanim を描かない = 時刻で変わらないのが基点からの現状）
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), waitForReady: true, time: 6.3 }));
        await sleep(1200);
        await shot(cdp, '08-both-preview');
        return { ...r, frames };
    });
    await check('両方: Cmd+Z 1 回で byte 一致', async () => {
        const r = await undoOnce(cdp);
        assert(r.captionsEqualFixture && r.gitStatus === '', S(r));
        return r;
    });

    // ===== 4. 未対応の部品・部品 1 つのスタイル =====
    await check('未対応の部品（効果音）入り: ポップオーバーで「効果音（当てない）」は無効表示・Escape で閉じ何も書かない', async () => {
        await select(cdp, ['c-0003']);
        await sleep(600);
        const pop = await openPopover(cdp, 'hand-sfx');
        const sfx = pop.inputs.find(i => i.kind === 'sfx');
        assert(sfx?.disabled && !sfx.checked && /効果音（当てない）/.test(sfx.label), `sfx ${S(sfx)}`);
        assert(pop.inputs.filter(i => !i.disabled).map(i => i.kind).join() === 'look,motion', `enabled ${S(pop.inputs)}`);
        await shot(cdp, '09-popover-unsupported');
        await key(cdp, 'Escape', 'Escape', 27);
        await sleep(400);
        const closed = !(await evalOn(cdp, POPOVER));
        assert(closed, 'popover not closed');
        assert((await captionsText()) === await readFile(FIXTURE_CAPTIONS, 'utf8'), 'captions written on Escape');
        return pop;
    });
    await check('未対応の部品入りを当てる（見た目 + 動き）→ 通知 1 行「効果音 は当てません。」・parts = [look, motion]・undo 1 回', async () => {
        await openPopover(cdp, 'hand-sfx');
        const count = await usageCount();
        await confirmPopover(cdp);
        await waitFor('captions written', async () => (await captionsText()) !== await readFile(FIXTURE_CAPTIONS, 'utf8'));
        await sleep(800);
        const row = (await byId())['c-0003'];
        assert(S(row.text_style?.animation) === S(HAND_SFX.parts[1].animation) && row.text_style?.color === '#00E5FF', `c-0003 ${S(row.text_style)}`);
        const last = await nextUsage(count);
        const notices = await waitFor('notice', async () => { const n = await evalOn(cdp, NOTICE); return n.some(x => /当てません/.test(x)) ? n : null; }, 15_000).catch(async () => evalOn(cdp, NOTICE));
        assert(notices.filter(n => /当てません/.test(n)).length === 1 && notices.some(n => /効果音 は当てません。/.test(n)), `notices ${S(notices)}`);
        assert(S(last.parts) === S(['look', 'motion']), `usage ${S(last)}`);
        const undo = await undoOnce(cdp);
        assert(undo.captionsEqualFixture && undo.gitStatus === '', `undo ${S(undo)}`);
        return { notices, usage: last, undo };
    });
    await check('部品が 1 つ（動きだけ）のスタイル: ポップオーバーを出さず即当てる・見た目は不変・undo 1 回', async () => {
        await select(cdp, ['c-0002']);
        await sleep(600);
        const count = await usageCount();
        await clickSel(cdp, `[data-akari-my-style-apply=${S(motionOnlyId)}]`);
        await waitFor('captions written', async () => (await captionsText()) !== await readFile(FIXTURE_CAPTIONS, 'utf8'));
        const popover = await evalOn(cdp, POPOVER);
        assert(!popover, 'popover shown');
        await sleep(600);
        const row = (await byId())['c-0002'];
        assert(S(row.text_style.animation) === S(SOURCE_MOTION) && S(withoutKeys(row.text_style, ['animation'])) === S(withoutKeys(fixtureRows['c-0002'].text_style, ['animation'])), `c-0002 ${S(row.text_style)}`);
        const last = await nextUsage(count);
        assert(S(last.parts) === S(['motion']), `usage ${S(last)}`);
        const undo = await undoOnce(cdp);
        assert(undo.captionsEqualFixture && undo.gitStatus === '', `undo ${S(undo)}`);
        return { row: row.text_style, usage: last, undo };
    });

    // ===== 5. ＋ / ドラッグ（対応部品を全部当てる）=====
    await check('＋: プレイヘッド 5 秒で ＋ → 置いた文字に見た目 + 動き（前回の選択に関係なく全部）・利用台帳 [look, motion]・Cmd+Z 1 回で戻る', async () => {
        await evalOn(cdp, command('akari.preview.seekOutput', { editUri: editUri(), waitForReady: true, time: 5 }));
        await sleep(1500);
        const ids = new Set((await captions()).map(c => c.id));
        const count = await usageCount();
        await clickSel(cdp, `[data-akari-my-style-add=${S(styleId)}]`);
        await waitFor('placed', async () => (await captions()).some(c => !ids.has(c.id)));
        await sleep(1500);
        const placed = (await captions()).find(c => !ids.has(c.id));
        for (const k of LOOK_KEYS) assert(S(placed.text_style?.[k]) === S(SOURCE_LOOK[k]), `placed.${k} ${S(placed.text_style?.[k])}`);
        assert(S(placed.text_style?.animation) === S(SOURCE_MOTION), `placed.animation ${S(placed.text_style?.animation)}`);
        assert(placed.time_domain === 'output', 'not a placed text');
        const last = await nextUsage(count);
        assert(S(last.parts) === S(['look', 'motion']) && S(last.caption_ids) === S([placed.id]), `usage ${S(last)}`);
        await shot(cdp, '10-plus-placed');
        const undo = await undoOnce(cdp);
        assert(undo.captionsEqualFixture && undo.gitStatus === '', `undo ${S(undo)}`);
        return { placed, usage: last, undo };
    });
    await check('ドラッグ: カードをタイムラインの 10 秒へ → 置いた文字に見た目 + 動き・Cmd+Z 1 回で戻る', async () => {
        await dismissToasts(cdp);
        await widenTimeline(cdp);
        const events = []; cdp.on('Input.dragIntercepted', p => events.push(p));
        const card = await evalOn(cdp, `(()=>{const el=document.querySelector('[data-akari-my-style-card=${S(styleId).replaceAll('"', '\\"')}]');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:Math.round(r.left+r.width/2),y:Math.round(r.top+Math.min(24,r.height/2))}})()`);
        const tx = await evalOn(cdp, `(()=>{const c=document.querySelector('.akari-annotations-strip-caption[data-akari-item-id="c-0004"]');const r=c.getBoundingClientRect();const pps=r.width/2.5;return{x0:r.left-9*pps,pps,y:r.top+r.height/2}})()`);
        const drop = { x: Math.round(tx.x0 + 10 * tx.pps), y: Math.round(tx.y) };
        const ids = new Set((await captions()).map(c => c.id));
        const count = await usageCount();
        await cdp.send('Input.setInterceptDrags', { enabled: true });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x, y: card.y });
        await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: card.x, y: card.y, button: 'left', clickCount: 1 });
        for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: card.x + k * 6, y: card.y + k * 6, button: 'left', buttons: 1 }); await sleep(30); }
        await sleep(400);
        assert(events.length, 'drag not started');
        const data = events[0].data;
        const payload = data.items.filter(i => i.mimeType === 'application/x-akari-library-item').map(i => JSON.parse(i.data))[0];
        for (const type of ['dragEnter', 'dragOver', 'dragOver', 'drop']) { await cdp.send('Input.dispatchDragEvent', { type, x: drop.x, y: drop.y, data }); await sleep(150); }
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: drop.x, y: drop.y, button: 'left', clickCount: 1 });
        await cdp.send('Input.setInterceptDrags', { enabled: false });
        await waitFor('placed', async () => (await captions()).some(c => !ids.has(c.id)));
        await sleep(1500);
        const placed = (await captions()).find(c => !ids.has(c.id));
        for (const k of LOOK_KEYS) assert(S(placed.text_style?.[k]) === S(SOURCE_LOOK[k]), `placed.${k} ${S(placed.text_style?.[k])}`);
        assert(S(placed.text_style?.animation) === S(SOURCE_MOTION), `placed.animation ${S(placed.text_style?.animation)}`);
        const last = await nextUsage(count);
        assert(S(last.parts) === S(['look', 'motion']), `usage ${S(last)}`);
        const undo = await undoOnce(cdp);
        assert(undo.captionsEqualFixture && undo.gitStatus === '', `undo ${S(undo)}`);
        return { payloadKind: payload?.kind, payloadParts: payload?.style?.parts?.map(p => p.kind), drop, placed: { id: placed.id, start: placed.start, end: placed.end, animation: placed.text_style.animation }, usage: last, undo };
    });

    // ===== 6. 起動し直しても前回の選択が残る（ユーザー設定）=====
    const step = label => { (out.restartSteps ??= []).push({ label, at: new Date().toISOString() }); console.log(`step ${label} ${new Date().toISOString()}`); };
    await check('起動し直し: 「動きだけ」で当てた後にアプリを起動し直しても、次回の既定は見た目が外れたまま', async () => {
        await select(cdp, ['c-0003']);
        await sleep(600);
        step('openShelf');
        await openShelf(cdp);
        await openPopover(cdp, styleId);
        await setParts(cdp, { look: false, motion: true });
        await confirmPopover(cdp);
        await waitFor('captions written', async () => (await captionsText()) !== await readFile(FIXTURE_CAPTIONS, 'utf8'));
        await sleep(800);
        const undo = await undoOnce(cdp);
        assert(undo.captionsEqualFixture, `undo ${S(undo)}`);
        step('stop');
        await stop(session);
        step('session = preparedLaunch');
        session = await preparedLaunch(true);
        cdp = session.cdp;
        // 起動し直しでは字幕のタイムラインを開き直さない（残した user-data-dir の「開くだけ」の状態では akari.annotations.open が
        // 「タイムラインを作成」を出して戻らない = この機能と無関係）。棚のポップオーバーは字幕の選択なしで開けるので既定だけを見る。
        step('setupWindow');
        await sleep(5000);
        await key(cdp, 'Escape', 'Escape', 27);
        await setupWindow(cdp);
        step('openShelf');
        await openShelf(cdp);
        out.restartStorage = await evalOn(cdp, `Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('akari.mystyle.parts.')).map(k=>[k,localStorage.getItem(k)]))`);
        step('openPopover');
        const pop = await openPopover(cdp, styleId);
        assert(S(defaults(pop)) === S({ look: false, motion: true }), `defaults after restart ${S(pop.inputs)}`);
        await shot(cdp, '11-popover-after-restart');
        await key(cdp, 'Escape', 'Escape', 27);
        await sleep(300);
        assert((await captionsText()) === await readFile(FIXTURE_CAPTIONS, 'utf8'), 'captions changed');
        const files = await styleFiles(STYLES);
        for (const [id, text] of Object.entries(files)) assert(!ABS.test(text), `${id} absolute path`);
        return { defaults: pop, undo, styleIds: Object.keys(files).sort() };
    });
    out.usageFinal = await usage();
} catch (error) {
    out.fatal = sanitize(error, REPO).replaceAll(WORK, '<work>');
    console.log(`FATAL ${out.fatal}`);
} finally {
    await stop(session);
    out.passed = out.checks.filter(c => c.pass).length;
    out.total = out.checks.length;
    await writeFile(RESULTS, `${S(scrub(out), null, 2)}\n`);
}
console.log(S({ passed: out.passed, total: out.total, fatal: out.fatal }));
