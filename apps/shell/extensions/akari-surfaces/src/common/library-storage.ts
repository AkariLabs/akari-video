import { t } from '@akari-video/i18n';
export type LibrarySource = 'lab' | 'site' | 'own';

export interface LibraryStorageItem {
    id: string;
    category: string;
    title: string;
    sourceKind: LibrarySource;
    libraryDir?: string;
    files?: Array<{ bytes?: number }>;
}

export interface LibraryStorageSummary {
    totalBytes: number;
    bySource: Record<LibrarySource, { count: number; bytes: number }>;
    cleanup: Array<{ id: string; category: string; title: string; libraryDir: string; bytes: number }>;
    cleanupBytes: number;
}

/** 未取得の Lab 行は libraryDir を持たない。重複ディレクトリも一度だけ数える。 */
export function summarizeLibraryStorage(items: readonly LibraryStorageItem[]): LibraryStorageSummary {
    const bySource = {
        lab: { count: 0, bytes: 0 }, site: { count: 0, bytes: 0 }, own: { count: 0, bytes: 0 }
    };
    const cleanup: LibraryStorageSummary['cleanup'] = [];
    const seen = new Set<string>();
    for (const item of items) {
        if (!item.libraryDir || seen.has(item.libraryDir)) { continue; }
        seen.add(item.libraryDir);
        const bytes = (item.files ?? []).reduce((sum, file) => sum + Math.max(0, file.bytes ?? 0), 0);
        bySource[item.sourceKind].count++;
        bySource[item.sourceKind].bytes += bytes;
        if (item.sourceKind === 'lab') {
            cleanup.push({ id: item.id, category: item.category, title: item.title, libraryDir: item.libraryDir, bytes });
        }
    }
    return {
        totalBytes: bySource.lab.bytes + bySource.site.bytes + bySource.own.bytes,
        bySource, cleanup,
        cleanupBytes: cleanup.reduce((sum, item) => sum + item.bytes, 0)
    };
}

export function librarySyncChoices(state: string | null): readonly string[] {
    return state === 'pending' ? [t('surfaces.library.libraryStepChoice.label'), t('surfaces.library.chooseSyncLocationChooseAnotherLocation.label'), t('surfaces.library.chooseSyncLocationMoveLater.label')] : [];
}

export function libraryMoveCopy(
    state: string | null,
    previous: { count: number; bytes: number },
    cloud: string | null
): { transfer?: string; sync?: string; retained?: string } {
    if (state === 'declined') {
        return { retained: t('surfaces.library.libraryMoveCopyKeepCurrentLocationMoveLaterSettingsChange.message') };
    }
    if (state === 'done') return {};
    return {
        ...(previous.count > 0 ? { transfer: t('surfaces.library.libraryMoveCopyMovePiecesApproximatelyNewLocation.message', { previousCount: previous.count, n: previous.count, size: formatLibraryBytes(previous.bytes) }) } : {}),
        ...(state === 'pending' ? { sync: previous.bytes > 0
            ? t('surfaces.library.libraryMoveCopyLocationSyncApproximatelySync.message', { cloud: cloud ?? t('surfaces.library.libraryMoveCopyCloud.label'), size: formatLibraryBytes(previous.bytes) })
            : t('surfaces.library.libraryMoveCopyLocationSyncInputAssetSynchronized.message', { cloud: cloud ?? t('surfaces.library.libraryMoveCopyCloud.label') }) } : {})
    };
}

export function formatLibraryBytes(bytes: number): string {
    return bytes > 0 && bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB`
        : bytes >= 1024 * 1024 * 1024 ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
        : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
