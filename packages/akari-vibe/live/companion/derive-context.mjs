// 橋を渡ってくる edit.json / captions.json と手元で読んだ人物 box から文脈を組み直す。
// location はローカルのパス解決にだけ使い、判断サーバーへは送らない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { editStore } from '../../src/edit-store.mjs';
import { declarations } from '../../src/v2/declared-knobs.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
import { resourcesRoot as publicRepo } from '../../src/resources-root.mjs';

/** 色の語彙は案件ごとの中身ではなく製品の固定表。プロジェクトを読まなくても出せる。 */
export const PALETTE = {
    red: ['赤', '#e5484d'], blue: ['青', '#3e63dd'], yellow: ['黄色', '#f5d90a'],
    white: ['白', '#ffffff'], black: ['黒', '#111111'], green: ['緑', '#30a46c'],
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function inside(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** 断片の置き場所を解く。location がある実物では edit.json の所在を相対パスの基準にする。 */
function fragmentDir(item, location = null) {
    const source = item?.source?.path;
    if (item?.source?.kind !== 'html' || typeof source !== 'string') return null;
    let file;
    if (source.startsWith('PUBLIC_REPO/') && !publicRepo()) return null;
    if (source.startsWith('PUBLIC_REPO/')) file = path.resolve(publicRepo(), source.slice(12));
    else if (location && typeof location.rootFsPath === 'string' && typeof location.editPath === 'string'
        && !path.isAbsolute(location.editPath) && !path.isAbsolute(source)) {
        const root = path.resolve(location.rootFsPath);
        const editFile = path.resolve(root, location.editPath);
        file = path.resolve(path.dirname(editFile), source);
        if (!inside(root, editFile) || !inside(root, file)) return null;
    } else file = path.resolve(repo, source);
    return path.dirname(file);
}

const shortName = value => typeof value === 'string' ? Array.from(value.trim()).slice(0, 40).join('') : '';
const fragmentText = item => item?.source?.kind === 'html'
    ? ['title', 'text', 'label'].map(key => shortName(item.source.params?.[key])).find(Boolean) : null;

/** カタログ名 → 断片の本文 → トラック名 → 置き場所の順。実ファイルが無くても本文は使える。 */
export function assetTitle(item, location = null, track = null) {
    if (item?.source?.kind === 'captions') return '字幕（全体）';
    const dir = fragmentDir(item, location);
    if (dir) try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
        if (shortName(meta.title)) return shortName(meta.title);
    } catch { /* meta.json が無い素材は下の名前で呼ぶ */ }
    const text = fragmentText(item);
    if (text) return `テロップ「${text}」`;
    const trackName = shortName(track?.name);
    if (trackName && ['html', 'media'].includes(item?.source?.kind)) return `「${trackName}」の素材`;
    if (!dir) return null;
    const base = path.basename(item.source.path).replace(/\.[^.]*$/, '');
    const stem = base === 'fragment' || base === 'index' ? path.basename(dir) : base;
    return /^[\w-]+$/.test(stem) ? `重ね物「${shortName(stem)}」` : null;
}

/** 素材ごとの色ツマミ。宣言（meta.json の knobs）に色が 1 つだけあればそれ、無ければ色の値を持つ vars が 1 つだけのときそれ。 */
export function colorKnobOf(item) {
    const declared = declarations(item).filter(knob => knob.type === 'color');
    if (declared.length === 1) return declared[0].cssVar;
    const vars = Object.entries(item?.source?.vars ?? {}).filter(([key, value]) => /^--[\w-]+$/.test(key) && HEX.test(String(value)));
    return vars.length === 1 ? vars[0][0] : null;
}

export function deriveLabels(edit, location = null) {
    const labels = {};
    for (const { item, track } of editStore.allLocations(edit)) {
        const title = assetTitle(item, location, track);
        if (title) labels[`item:${item.id}`] = title;
    }
    return labels;
}

export function deriveColorKnobs(edit) {
    const knobs = {};
    for (const { item } of editStore.allLocations(edit)) {
        const knob = colorKnobOf(item);
        if (knob) knobs[`item:${item.id}`] = knob;
    }
    return knobs;
}

/** 橋から来た文書とローカルの人物行から、判断に渡す文脈を作る。 */
export function deriveContext(edit, { transcript = [], vision = [], location = null, layout = {} } = {}) {
    const namedLayout = { ...layout };
    for (const { item, track } of editStore.allLocations(edit)) {
        const id = `item:${item.id}`;
        const names = [shortName(track.name), fragmentText(item)].filter(Boolean);
        const aliases = names.flatMap(name => [name,
            shortName(name.replace(/^(?:左上|右上|左下|右下|中央|左|右|上|下)\s*/, '')),
            shortName(name.replace(/([A-Za-z0-9])([^\x00-\x7f])/g, '$1 $2'))]).filter(Boolean);
        if (aliases.length) namedLayout[id] = { ...layout[id],
            candidateAliases: [...new Set([...(layout[id]?.candidateAliases ?? []), ...aliases])] };
    }
    return {
        transcript,
        vision,
        labels: deriveLabels(edit, location),
        palette: PALETTE,
        layout: namedLayout,               // 別名だけを足す。実測の表示領域は橋を渡らない（段 2）
        colorKnobs: deriveColorKnobs(edit),
    };
}
