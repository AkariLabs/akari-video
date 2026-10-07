import type { AssetCatalogViewItem } from './akari-project-protocol';

export async function applyCatalogFont(item: AssetCatalogViewItem, actions: {
    resolveBeforeApply(item: AssetCatalogViewItem): Promise<AssetCatalogViewItem['fontAvailability']>;
    confirmDownload(title: string, bytes: number): Promise<boolean>;
    download(id: string): Promise<void>;
    offerSource(title: string, url?: string): Promise<'open' | 'apply' | undefined>;
    openSource(url: string): void;
    apply(family: string): Promise<void>;
    refresh(): Promise<void>;
}): Promise<void> {
    let availability = item.fontAvailability;
    if (!availability || availability.status === 'pending' || availability.status === 'failed') {
        availability = await actions.resolveBeforeApply(item) ?? {
            status: item.licenseSpdx === 'OFL-1.1' && item.sourceUrl?.startsWith('https://fonts.google.com/')
                ? 'download' : 'source',
            family: item.title.replace(/（.*$/u, '').trim(), bytes: availability?.bytes
        };
    }
    const family = availability?.family || item.title.replace(/（.*$/u, '').trim();
    if (availability?.status === 'download') {
        if (!await actions.confirmDownload(item.title, availability.bytes ?? 0)) return;
        await actions.download(item.id);
        await actions.apply(family);
        await actions.refresh();
        return;
    }
    if (availability?.status !== 'available') {
        const choice = await actions.offerSource(item.title, item.sourceUrl);
        if (choice === 'open' && item.sourceUrl) actions.openSource(item.sourceUrl);
        if (choice !== 'apply') return;
    }
    await actions.apply(family);
}
