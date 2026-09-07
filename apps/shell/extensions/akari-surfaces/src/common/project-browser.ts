export type ProjectViewMode = 'cards' | 'list';
export const PROJECT_PAGE_SIZE = 24;
const VIEW_KEY = 'akari.projects.view';

export function readProjectView(): ProjectViewMode {
    try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'cards'; } catch { return 'cards'; }
}

export function saveProjectView(mode: ProjectViewMode): void {
    try { localStorage.setItem(VIEW_KEY, mode); } catch { /* 表示切り替えは保存不可でも使える。 */ }
}

export function filterProjects<T extends { name: string; channel?: string; key: string }>(rows: readonly T[], query: string): T[] {
    const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return rows.filter(row => {
        const text = `${row.name} ${row.channel ?? ''} ${row.key}`.normalize('NFKC').toLocaleLowerCase();
        return terms.every(term => text.includes(term));
    });
}
