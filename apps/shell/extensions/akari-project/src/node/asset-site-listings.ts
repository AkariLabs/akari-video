import * as fs from 'fs/promises';
import { join } from 'path';
import { AssetSite, AssetSiteListing, AssetSiteRecommendation, siteUrlAllowed } from '../common/asset-sites';

/** Read the shipped site index. A missing recommendation does not hide its site. */
export async function loadAssetSiteListings(root: string, options: { testAllowed: boolean }): Promise<AssetSiteListing[]> {
    const sitesDir = join(root, 'sites');
    const names = (await fs.readdir(sitesDir)).filter(name => name.endsWith('.json'));
    let candidates: any[] = [];
    try {
        const raw = JSON.parse(await fs.readFile(join(root, 'audio', 'candidates.json'), 'utf8'));
        candidates = raw.categories.flatMap((group: any) => group.items);
    } catch { /* Optional index. */ }
    const listings: AssetSiteListing[] = [];
    for (const name of names) {
        try {
            const site = JSON.parse(await fs.readFile(join(sitesDir, name), 'utf8')) as AssetSite;
            if (site.id !== name.slice(0, -5) || !siteUrlAllowed(site.entry_url, site.hosts, options.testAllowed)) continue;
            const recommendations: AssetSiteRecommendation[] = [];
            for (const reference of site.recommendations) {
                try {
                    const candidate = reference.startsWith('audio/candidates/')
                        ? candidates.find(item => item.id === reference.slice('audio/candidates/'.length)) : undefined;
                    const meta = candidate ? undefined : JSON.parse(await fs.readFile(join(root, reference, 'meta.json'), 'utf8'));
                    const pageUrl = candidate?.download_page_url ?? meta?.source?.url;
                    if (!pageUrl || !siteUrlAllowed(pageUrl, site.hosts, options.testAllowed)) continue;
                    recommendations.push({ id: reference, title: candidate?.title_ja ?? meta?.title ?? reference,
                        pageUrl, expectedFilenames: candidate?.expected_filenames ?? meta?.expected_filenames ?? [],
                        filenamePatterns: candidate?.filename_patterns ?? meta?.filename_patterns ?? [] });
                } catch { /* Skip only the unreadable recommendation. */ }
            }
            listings.push({ site, recommendations });
        } catch { /* A malformed site is rejected by validate-sites. */ }
    }
    return listings;
}
