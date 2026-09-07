export type ProjectViewMode = 'cards' | 'list';
export const PROJECT_PAGE_SIZE = 24;
const VIEW_KEY = 'akari.projects.view';
export const HOME_PROJECT_PAGE_SIZE = 3;
const SORT_KEY = 'akari.projects.sort';
export interface ProjectDetails {
    updatedAt?: number;
    hasEditData?: boolean;
}
export const PROJECT_SORT_LABELS = {
    'updated-desc': '更新が新しい順',
    'updated-asc': '更新が古い順',
    'name-asc': '名前（昇順）',
    'name-desc': '名前（降順）'
} as const;
export type ProjectSortOrder = keyof typeof PROJECT_SORT_LABELS;
export const PROJECT_VIEW_ICONS = { cards: 'codicon-dashboard', list: 'codicon-list-flat' } as const;

export function readProjectSort(scope: 'home' | 'launcher' = 'launcher'): ProjectSortOrder {
    try {
        const value = localStorage.getItem(scope === 'home' ? 'akari.home.projects.sort' : SORT_KEY);
        return Object.prototype.hasOwnProperty.call(PROJECT_SORT_LABELS, value) ? value as ProjectSortOrder : 'updated-desc';
    } catch { return 'updated-desc'; }
}

export function saveProjectSort(order: ProjectSortOrder, scope: 'home' | 'launcher' = 'launcher'): void {
    try { localStorage.setItem(scope === 'home' ? 'akari.home.projects.sort' : SORT_KEY, order); } catch { /* 保存不可でも並べ替えは使える。 */ }
}

export function sortProjects<T extends ProjectDetails & { name: string; key: string }>(rows: readonly T[], order: ProjectSortOrder): T[] {
    const byName = (a: T, b: T): number => a.name.localeCompare(b.name, 'ja', { numeric: true }) || a.key.localeCompare(b.key);
    return [...rows].sort((a, b) => {
        if (order === 'name-asc') { return byName(a, b); }
        if (order === 'name-desc') { return -byName(a, b); }
        const left = Number.isFinite(a.updatedAt) ? a.updatedAt : undefined;
        const right = Number.isFinite(b.updatedAt) ? b.updatedAt : undefined;
        // 更新日を取得できないプロジェクトは、昇順・降順とも末尾に残す。
        if (left === undefined) { return right === undefined ? byName(a, b) : 1; }
        if (right === undefined) { return -1; }
        return (order === 'updated-asc' ? left - right : right - left) || byName(a, b);
    });
}

export function formatProjectUpdatedAt(value?: number): string {
    if (!Number.isFinite(value)) { return '—'; }
    return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(value);
}

export function projectEditStatus(row: ProjectDetails): string {
    return row.hasEditData === true ? '編集データあり' : row.hasEditData === false ? '未作成' : '—';
}

export function readProjectView(scope: 'home' | 'launcher' = 'launcher'): ProjectViewMode {
    try { return localStorage.getItem(scope === 'home' ? 'akari.home.projects.view' : VIEW_KEY) === 'list' ? 'list' : 'cards'; } catch { return 'cards'; }
}

export function saveProjectView(mode: ProjectViewMode, scope: 'home' | 'launcher' = 'launcher'): void {
    try { localStorage.setItem(scope === 'home' ? 'akari.home.projects.view' : VIEW_KEY, mode); } catch { /* 表示切り替えは保存不可でも使える。 */ }
}

export function filterProjects<T extends { name: string; channel?: string; key: string }>(rows: readonly T[], query: string): T[] {
    const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return rows.filter(row => {
        const text = `${row.name} ${row.channel ?? ''} ${row.key}`.normalize('NFKC').toLocaleLowerCase();
        return terms.every(term => text.includes(term));
    });
}
