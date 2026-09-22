/** Wire contract owned by asset-resolver/README.md. Classification stays in the resolver. */
export type LibraryImportKind = 'sfx' | 'bgm' | 'still' | 'broll' | 'font' | 'scene3d';
export interface LibraryImportFile { path: string; name: string; bytes?: number; }
export interface LibraryImportItem extends LibraryImportFile {
    category: string; kind: LibraryImportKind; ambiguous: boolean;
    durationSec: number | null; durationSource: 'ffprobe' | 'size' | null;
    proposedId: string; mtimeMs: number; folder?: string; selected?: boolean; credit?: string;
}
export interface LibraryImportDuplicate extends LibraryImportFile {
    category: string; id: string; libraryDir: string; title?: string;
}
export interface LibraryImportPlan {
    schema: 'akari-assets-add-plan/v0'; items: LibraryImportItem[];
    duplicates: LibraryImportDuplicate[]; rejected: (LibraryImportFile & { reason: string })[];
    truncated: boolean; limit: number; warnings: string[];
    credit?: string; pack?: { id: string; title: string };
}
export interface LibraryImportResult {
    added: { category: string; id: string; libraryDir: string; warnings?: string[] }[];
    duplicates: LibraryImportDuplicate[]; rejected: (LibraryImportFile & { reason: string })[];
    failures: { path?: string; reason: string }[];
}
export const LIBRARY_IMPORT_KINDS: { kind: LibraryImportKind; label: string; icon: string }[] = [
    { kind: 'sfx', label: '効果音', icon: '♫' }, { kind: 'bgm', label: 'BGM', icon: '♪' },
    { kind: 'font', label: 'フォント', icon: 'Aa' }, { kind: 'broll', label: '映像', icon: '▣' },
    { kind: 'still', label: '画像', icon: '▧' }, { kind: 'scene3d', label: '3D', icon: '◇' }
];
export function libraryImportGroups(plan: LibraryImportPlan): { kind: LibraryImportKind; label: string; icon: string; items: LibraryImportItem[] }[] {
    return LIBRARY_IMPORT_KINDS.map(group => ({ ...group, items: plan.items.filter(item => !item.ambiguous && item.kind === group.kind) }))
        .filter(group => group.items.length > 0);
}
