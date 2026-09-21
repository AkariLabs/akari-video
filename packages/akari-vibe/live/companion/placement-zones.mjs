const ROWS = Object.freeze([
    ['top', 0, 1 / 3],
    ['middle', 1 / 3, 2 / 3],
    ['bottom', 2 / 3, 1],
]);
const COLS = Object.freeze([
    ['left', 0, 1 / 3],
    ['center', 1 / 3, 2 / 3],
    ['right', 2 / 3, 1],
]);

// akari-preview-open-handler.ts の zoneParts と同じ公開語彙。
export const PLACEMENT_ZONES = Object.freeze([
    'top-left', 'top', 'top-right',
    'left', 'center', 'right',
    'bottom-left', 'bottom', 'bottom-right',
]);

export function zoneParts(zone) {
    if (!zone || zone === 'bottom') return { row: 'bottom', col: 'center' };
    if (zone === 'center') return { row: 'middle', col: 'center' };
    if (zone === 'top') return { row: 'top', col: 'center' };
    if (zone === 'left' || zone === 'right') return { row: 'middle', col: zone };
    const [row, col] = String(zone).split('-');
    return { row, col };
}

export function zoneRect(zone) {
    const { row, col } = zoneParts(zone);
    const rowRange = ROWS.find(([name]) => name === row) ?? ROWS[2];
    const colRange = COLS.find(([name]) => name === col) ?? COLS[1];
    return [colRange[1], rowRange[1], colRange[2] - colRange[1], rowRange[2] - rowRange[1]];
}

function zoneForPoint(x, y) {
    const col = x < 1 / 3 ? 'left' : x < 2 / 3 ? 'center' : 'right';
    const row = y < 1 / 3 ? 'top' : y < 2 / 3 ? 'middle' : 'bottom';
    if (col === 'center') return row === 'middle' ? 'center' : row;
    if (row === 'middle') return col;
    return `${row}-${col}`;
}

function itemCenter(item, width, height) {
    const x = Number(item?.transform?.x ?? 0);
    const y = Number(item?.transform?.y ?? 0);
    return [0.5 + (Number.isFinite(x) ? x : 0) / width, 0.5 + (Number.isFinite(y) ? y : 0) / height];
}

function overlaps(left, right) {
    return left[0] < right[0] + right[2] && left[0] + left[2] > right[0]
        && left[1] < right[1] + right[3] && left[1] + left[3] > right[1];
}

function sourcePath(edit, item) {
    if (item?.source?.kind === 'html') return item.source.path;
    if (item?.source?.kind === 'media') return edit.sources?.find(source => source.id === item.source.src)?.path;
    return null;
}

function pathCategory(value) {
    const match = String(value ?? '').replaceAll('\\', '/').match(/(?:^|\/)assets\/([^/]+)\/[^/]+(?:\/|$)/);
    return match?.[1] ?? null;
}

function visualItems(edit) {
    return (edit.tracks ?? []).filter(track => track?.lane === 'visual' && Array.isArray(track.items))
        .flatMap(track => track.items);
}

/** edit.json と人物の箱だけから、挿入位置と表示する候補を決める純粋関数。 */
export function planPlacementZones({ edit, atSeconds = 0, category = null, tags = [], persons = [] } = {}) {
    const width = Number(edit?.output?.width);
    const height = Number(edit?.output?.height);
    const fps = Number(edit?.output?.fps);
    if (!(width > 0) || !(height > 0) || !(fps > 0)) return { zones: [], transform: null, background: false };
    const background = category === 'still' && tags.some(tag => String(tag).toLowerCase() === 'background');
    if (background) return { zones: [], transform: null, background: true };

    const frame = Math.round(Math.max(0, atSeconds) * fps);
    const items = visualItems(edit);
    const occupied = new Set(items
        .filter(item => Number.isFinite(item?.at) && Number.isFinite(item?.duration)
            && item.at <= frame && frame < item.at + item.duration)
        .map(item => zoneForPoint(...itemCenter(item, width, height))));
    const personBoxes = persons.map(person => person?.box)
        .filter(box => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite));
    const available = PLACEMENT_ZONES.filter(zone => !occupied.has(zone)
        && !personBoxes.some(box => overlaps(zoneRect(zone), box)));

    const preferred = items
        .filter(item => pathCategory(sourcePath(edit, item)) === category
            && Number.isFinite(item?.at) && item.at < frame)
        .sort((left, right) => right.at - left.at)
        .map(item => zoneForPoint(...itemCenter(item, width, height)));
    const preferredRank = new Map(preferred.map((zone, index) => [zone, index]));
    const defaultRank = new Map(PLACEMENT_ZONES.map((zone, index) => [zone, index]));
    const zones = available.sort((left, right) => {
        const leftPreferred = preferredRank.has(left) ? preferredRank.get(left) : Infinity;
        const rightPreferred = preferredRank.has(right) ? preferredRank.get(right) : Infinity;
        return leftPreferred - rightPreferred || defaultRank.get(left) - defaultRank.get(right);
    }).slice(0, 3);
    const first = zones[0];
    if (!first) return { zones, transform: null, background: false };
    const [x, y, w, h] = zoneRect(first);
    return {
        zones,
        transform: {
            x: Math.round((x + w / 2 - 0.5) * width),
            y: Math.round((y + h / 2 - 0.5) * height),
        },
        background: false,
    };
}
