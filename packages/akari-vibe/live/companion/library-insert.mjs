import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import path from 'node:path';
import { byId } from '../../src/exec-support/insert_from_library_search.mjs';
import { audioAssets } from '../../src/exec-support/audio_ops_sfx.mjs';
import { planPlacementZones } from './placement-zones.mjs';

export const IMPORT_TIMEOUT_MS = 20_000;
const runtime = new AsyncLocalStorage();
const AUDIO_FILE = /\.(?:aac|flac|m4a|mp3|ogg|opus|wav)$/i;
const RUNTIME_ACCESSOR = Symbol.for('akari.vibe.library-insert-runtime');
globalThis[RUNTIME_ACCESSOR] = () => runtime.getStore() ?? {};

export function libraryRuntimeFor(env = {}) {
    const active = runtime.getStore() ?? {};
    return {
        assetPaths: env.assetPaths ?? active.assetPaths,
        placement: env.placement ?? active.placement,
        durationSeconds: env.durationSeconds ?? active.durationSeconds,
        fragmentPath: env.fragmentPath ?? active.fragmentPath,
        companion: env.companion ?? active.companion,
    };
}

export function runWithLibraryRuntime(value, apply) {
    return runtime.run(value ?? {}, apply);
}

/** CompanionLink が timer を張る同期区間だけ importAsset の待ち時間を20秒へ広げる。 */
export function sendImportAssetWithTimeout(link, assetId) {
    const previousTimeoutMs = link.timeoutMs;
    link.timeoutMs = IMPORT_TIMEOUT_MS;
    try {
        return link.sendInstruction('command', { commandId:'akari.catalog.importAsset', args:{ assetId } });
    } finally {
        link.timeoutMs = previousTimeoutMs;
    }
}

function candidateItems(ctx) {
    const value = ctx?.lastCandidates;
    if (value?.kind === 'library' && Array.isArray(value.items)) return value.items;
    if (Array.isArray(ctx?.libraryCandidates)) return ctx.libraryCandidates.map(key => ({ key }));
    return [];
}

export function libraryAssetId(decision = {}, ctx = {}) {
    let id = null;
    if (decision.op === 'insert_from_library_add') {
        const ordinal = { first: 0, second: 1, third: 2 }[decision.w11_reference];
        id = ordinal === undefined ? decision.w11_asset : candidateItems(ctx)[ordinal]?.key;
    }
    if (decision.op === 'audio_bgm_pick' && decision.audio_bgm_action === 'insert') id = decision.audio_bgm_id;
    if (decision.op === 'audio_sfx') id = decision.audio_sfx_id;
    return typeof id === 'string' && id && id !== 'none' ? id : null;
}

function firstCatalogAsset(decision, ctx) {
    if (decision.op === 'insert_from_library_search') {
        if (decision.w11_asset && decision.w11_asset !== 'none') return decision.w11_asset;
        return decision.w11_candidates?.find(id => typeof id === 'string' && id !== 'none') ?? null;
    }
    if (decision.op === 'audio_bgm_pick' && decision.audio_bgm_action === 'suggest') return decision.audio_bgm_id ?? null;
    return libraryAssetId(decision, ctx)
        ?? decision.w11_candidates?.find(id => typeof id === 'string' && id !== 'none')
        ?? candidateItems(ctx)[0]?.key
        ?? null;
}

function catalogCategory(decision, assetId) {
    if (decision.op.startsWith('audio_') || /^(?:bgm|jingle|sfx)-/.test(assetId ?? '')) return 'audio';
    return byId.get(assetId)?.category ?? null;
}

function catalogOpen(decision, ctx, text) {
    const assetId = firstCatalogAsset(decision, ctx);
    if (!assetId) return null;
    const category = catalogCategory(decision, assetId);
    const query = decision.audioQuery ?? (decision.op === 'insert_from_library_search' ? text : null);
    return {
        tab: 'library',
        ...(category ? { category } : {}),
        ...(typeof query === 'string' && query.trim() ? { query: query.trim() } : {}),
        assetId,
        pulse: true,
    };
}

function visualInsertReady(decision, confidence, ctx, insertGate) {
    const assetId = libraryAssetId(decision, ctx);
    const gate = Number(confidence?.gate ?? confidence?.op ?? 0);
    return Boolean(assetId && assetId !== 'none' && decision.w11_ambiguous !== true
        && Number.isFinite(insertGate) && gate >= insertGate);
}

/** 判断の直後、取り込み前にライブラリへ案内すべきケースを返す。 */
export function libraryIntentShellEffect({ decision = {}, confidence = {}, insertGate, ctx = {}, location = null, text = '' } = {}) {
    const searching = decision.op === 'insert_from_library_search'
        || (decision.op === 'audio_bgm_pick' && decision.audio_bgm_action === 'suggest');
    const oldShell = !location && Boolean(libraryAssetId(decision, ctx));
    const visualFallback = decision.op === 'insert_from_library_add' && !visualInsertReady(decision, confidence, ctx, insertGate);
    return searching || oldShell || visualFallback ? { catalogOpen: catalogOpen(decision, ctx, text) } : {};
}

function safeRelativePath(value) {
    return typeof value === 'string' && value.length > 0 && !path.posix.isAbsolute(value)
        && !path.win32.isAbsolute(value) && !value.includes('\0');
}

// 素材本来の長さを読む。旧ライブラリの data-duration も移行期間中は受け付ける。
// 読むのは手元のディスクだけ。長さ（数）以外は判断にも記録にも出さない。
export function fragmentDurationSeconds(location, assetPath, readFile = fs.readFileSync) {
    try {
        const fragment = (assetPath?.files ?? []).find(file => /(^|\/)fragment\.html$/.test(file));
        if (!location?.rootFsPath || !location.editPath || !fragment) return null;
        const file = path.resolve(location.rootFsPath, path.dirname(location.editPath), fragment);
        if (!file.startsWith(path.resolve(location.rootFsPath) + path.sep)) return null;
        const markup = String(readFile(file, 'utf8')).replace(/<!--[\s\S]*?-->|<(style|script)\b[^>]*>[\s\S]*?<\/\1\s*>|<link\b[^>]*>|<!doctype[^>]*>/gi, '');
        const root = markup.match(/<[a-zA-Z][^>]*>/)?.[0] ?? '';
        const attribute = name => root.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
            ?.slice(1).find(value => value !== undefined);
        const seconds = Number(attribute('data-akari-natural-duration') ?? attribute('data-duration'));
        return Number.isFinite(seconds) && seconds > 0 && seconds <= 3600 ? seconds : null;
    } catch { return null; }
}

// akari-vibe は他パッケージへの import を持てないため、断片ルートの変換をここにも閉じ込める。
// resolver / overlay-runtime と同じ規則を回帰テストで固定する。
export function withoutFragmentRootTiming(source, { preserveNaturalDuration = false } = {}) {
    let cursor = 0;
    while (cursor < source.length) {
        const start = source.indexOf('<', cursor);
        if (start < 0) break;
        if (source.startsWith('<!--', start)) {
            const end = source.indexOf('-->', start + 4);
            if (end < 0) throw new Error('HTML コメントが閉じていません');
            cursor = end + 3;
            continue;
        }
        const tag = /^<([A-Za-z][\w:-]*)(?:"[^"]*"|'[^']*'|[^'">])*>/u.exec(source.slice(start));
        if (!tag) { cursor = start + 1; continue; }
        if (/^(?:style|script)$/iu.test(tag[1])) {
            const closing = new RegExp(`</${tag[1]}\\s*>`, 'iu').exec(source.slice(start + tag[0].length));
            if (!closing) throw new Error('HTML の前置要素が閉じていません');
            cursor = start + tag[0].length + closing.index + closing[0].length;
            continue;
        }
        if (/^link$/iu.test(tag[1])) { cursor = start + tag[0].length; continue; }
        const nameEnd = tag[1].length + 1;
        const attributes = tag[0].slice(nameEnd, -1);
        const tokens = /([^\s=/>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gu;
        const removals = [];
        let duration = null;
        let hasNaturalDuration = false;
        for (const token of attributes.matchAll(tokens)) {
            if (preserveNaturalDuration && /^data-akari-natural-duration$/iu.test(token[1])) hasNaturalDuration = true;
            if (!/^data-(?:start|duration)$/iu.test(token[1])) continue;
            if (preserveNaturalDuration && /^data-duration$/iu.test(token[1])) {
                const value = token[0].match(/=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/u)?.slice(1).find(part => part !== undefined);
                if (value !== undefined && Number.isFinite(Number(value)) && Number(value) > 0) duration = value;
            }
            let from = token.index;
            while (from > 0 && /\s/u.test(attributes[from - 1])) from--;
            removals.push([from, token.index + token[0].length]);
        }
        let changed = attributes;
        for (const [from, to] of removals.reverse()) changed = changed.slice(0, from) + changed.slice(to);
        if (preserveNaturalDuration && !hasNaturalDuration && duration !== null) changed += ` data-akari-natural-duration="${duration}"`;
        return source.slice(0, start + nameEnd) + changed + source.slice(start + tag[0].length - 1);
    }
    throw new Error('HTML 断片のルート要素がありません');
}

// 取り込み済みの断片を配置時刻から独立させる。同じ素材を複数回置いても写しは不要。
export function placedFragmentCopy(location, assetPath, _placement = {}, io = fs) {
    try {
        const fragment = (assetPath?.files ?? []).find(file => /(^|\/)fragment\.html$/.test(file));
        if (!location?.rootFsPath || !location.editPath || !fragment) return null;
        const editDirectory = path.resolve(location.rootFsPath, path.dirname(location.editPath));
        const source = path.resolve(editDirectory, fragment);
        if (!source.startsWith(path.resolve(location.rootFsPath) + path.sep)) return null;
        if (!io.lstatSync(source).isFile()) return null;
        const html = String(io.readFileSync(source, 'utf8'));
        const cleaned = withoutFragmentRootTiming(html, { preserveNaturalDuration: true });
        if (cleaned !== html) io.writeFileSync(source, cleaned, 'utf8');
        return fragment;
    } catch { return null; }
}

/** 手元の文法へ渡す「画面に置ける素材の正式な名前」の一覧（id と名前だけ）。 */
export function libraryTitlesForGrammar() {
    return [...byId.values()].filter(asset => typeof asset?.title === 'string' && asset.title.trim())
        .map(asset => ({ id: asset.id, title: asset.title.trim() }));
}

export function relativeAssetPaths(editPath, imported) {
    if (!safeRelativePath(editPath) || imported?.ok !== true || !safeRelativePath(imported.dir)
        || !Array.isArray(imported.files) || !imported.files.every(safeRelativePath)) return null;
    const editDirectory = path.posix.dirname(editPath.replaceAll('\\', '/'));
    const relative = value => path.posix.relative(editDirectory, value.replaceAll('\\', '/')) || '.';
    const dir = relative(imported.dir);
    const files = imported.files.map(relative);
    if (!safeRelativePath(dir) || !files.every(safeRelativePath)) return null;
    return { dir, files };
}

function importedValue(response) {
    if (response?.ok === true && response.value && typeof response.value === 'object') return response.value;
    if (response?.ok === false && typeof response.reason === 'string') return response;
    if (response?.ok === true && typeof response.id === 'string') return response;
    return { ok: false, reason: 'failed', message: '素材を取り込めませんでした。' };
}

function placementFor({ decision, assetId, edit, playheadT, persons }) {
    if (decision.op !== 'insert_from_library_add') return null;
    const asset = byId.get(assetId);
    if (!asset) return null;
    return { assetId, ...planPlacementZones({
        edit,
        atSeconds: decision.w11_at === 'spoken' ? decision.seconds : playheadT,
        category: asset.category,
        tags: asset.tags ?? [],
        persons,
    }) };
}

/** importAsset を apply より先に実行し、同期 executor へ渡す相対パスを用意する。 */
export async function prepareLibraryInsert({ decision = {}, confidence = {}, insertGate, ctx = {}, edit, playheadT = 0,
    persons = [], companion = false, location = null, sendCommand, sendImportAsset, setBanner = () => {} } = {}) {
    const assetId = libraryAssetId(decision, ctx);
    const needsImport = Boolean(assetId) && (decision.op !== 'insert_from_library_add'
        || visualInsertReady(decision, confidence, ctx, insertGate));
    if (!companion || !assetId) return { decision, runtime: {}, shellEffect: {} };
    if (!needsImport) {
        return { decision: { ...decision, op: 'insert_from_library_search' }, runtime: { companion:true,assetPaths: {} }, shellEffect: {} };
    }
    if (!location) return { decision, runtime: { companion:true,assetPaths: {} }, shellEffect: {} };

    setBanner('素材を取得しています');
    const response = await (sendImportAsset
        ? sendImportAsset(assetId)
        : sendCommand('akari.catalog.importAsset', { assetId }));
    if (response?.error === 'timeout') {
        setBanner('素材を取得できませんでした');
        return { decision, runtime: { companion:true,assetPaths: {} }, shellEffect: {} };
    }
    const imported = importedValue(response);
    if (imported.ok !== true) {
        if (imported.reason === 'locked') {
            setBanner('有料の素材です — ライブラリで確かめてください');
            return { decision, runtime: { companion:true,assetPaths: {} }, shellEffect: { catalogOpen: catalogOpen(decision, ctx, '') } };
        }
        setBanner(imported.message || '素材を取得できませんでした');
        return { decision, runtime: { companion:true,assetPaths: {} }, shellEffect: {} };
    }
    const assetPath = relativeAssetPaths(location.editPath, imported);
    if (!assetPath) {
        setBanner('素材を取得できませんでした');
        return { decision, runtime: { companion:true,assetPaths: {} }, shellEffect: {} };
    }
    const isAudio = decision.op === 'audio_sfx' || decision.op === 'audio_bgm_pick';
    if (decision.op === 'insert_from_library_add'
        && !assetPath.files.includes(path.posix.join(assetPath.dir, 'fragment.html'))) {
        setBanner('取り込んだ素材に fragment.html がありません');
        return { decision, runtime: { companion:true,assetPaths: {} }, shellEffect: {} };
    }
    if (isAudio && !assetPath.files.some(file => AUDIO_FILE.test(file))) {
        setBanner('取り込んだ素材に音のファイルがありません');
        return { decision, runtime: { companion:true,assetPaths: {} }, shellEffect: {} };
    }
    setBanner(null);
    // 区画の候補は枠として見せるだけにして、素材そのものは動かさない（実機 2026-09-21: 全画面の断片の黒板を
    // 空いている左上の区画へ 1/3 ぶん平行移動して大半が画面外に切れた。素材の実寸はここでは分からない）。
    // 置き場所は素材のツマミ（位置・揃え）かドラッグで直す。
    const planned = placementFor({ decision, assetId, edit, playheadT, persons });
    const placement = planned ? { ...planned, transform: null } : planned;
    const durationSeconds = fragmentDurationSeconds(location, assetPath);
    return {
        decision,
        applyLabel: `素材を入れる: ${byId.get(assetId)?.title?.trim()
            || audioAssets.find(asset => asset.id === assetId)?.title?.trim() || assetId}`,
        runtime: { companion:true,assetPaths: { [assetId]: assetPath }, placement,
            durationSeconds,
            fragmentPath: decision.op === 'insert_from_library_add'
                ? placedFragmentCopy(location, assetPath)
                : null },
        shellEffect: placement?.zones?.length ? { zoneHint: { zones: placement.zones, durationMs: 4000 } } : {},
    };
}
