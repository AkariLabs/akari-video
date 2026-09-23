export interface AssetSite {
    id: string; name: string; tab: 'audio' | 'font' | 'visual'; entry_url: string;
    hosts: string[]; download_hosts: string[]; price: 'free' | 'subscription' | 'purchase';
    terms: { summary_ja: string; source_url: string; checked_at: string };
    attribution: { required: boolean; text: string };
    direct_fetch_allowed: false; recommendations: string[];
}
export interface AssetSiteRecommendation {
    id: string; title: string; pageUrl: string; expectedFilenames: string[]; filenamePatterns: string[];
}
export interface AssetSiteListing { site: AssetSite; recommendations: AssetSiteRecommendation[] }

/** Only explicitly listed hosts are trusted; *.example.com never includes example.com. */
export function siteUrlAllowed(raw: string, hosts: readonly string[], testHttp = false): boolean {
    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' && !(testHttp && url.protocol === 'http:' && url.hostname === '127.0.0.1')) return false;
        if (url.username || url.password) return false;
        return hosts.some(host => host.startsWith('*.')
            ? url.hostname.endsWith(host.slice(1)) && url.hostname !== host.slice(2)
            : url.hostname === host);
    } catch { return false; }
}

export function siteDownloadAllowed(raw: string, site: Pick<AssetSite, 'hosts' | 'download_hosts'>, testHttp = false): boolean {
    return siteUrlAllowed(raw, [...site.hosts, ...site.download_hosts], testHttp);
}

/** A redirect chain is accepted only if every hop is on an explicitly allowed host. */
export function siteDownloadChainAllowed(urls: readonly string[], site: Pick<AssetSite, 'hosts' | 'download_hosts'>, testHttp = false): boolean {
    return urls.length > 0 && urls.every(url => siteDownloadAllowed(url, site, testHttp));
}

/** A pure index lookup. Ties resolve to the first matching element in DOM order. */
export function highlightCandidateIndex(
    links: readonly { href: string; text: string }[], expectedFilenames: readonly string[], filenamePatterns: readonly string[]
): number {
    const filenames = expectedFilenames.map(value => value.toLowerCase()).filter(Boolean);
    const patterns = filenamePatterns.flatMap(pattern => {
        try { return [new RegExp(pattern, 'i')]; } catch { return []; }
    });
    return links.findIndex(link => {
        const haystack = `${link.href} ${link.text}`.toLowerCase();
        return filenames.some(name => haystack.includes(name)) || patterns.some(pattern => pattern.test(haystack));
    });
}

// This script only reads candidates. It never substitutes for the user's download gesture.
export const READ_HIGHLIGHT_CANDIDATES_SCRIPT = `Array.from(document.querySelectorAll('a,button')).map(el => ({
 href: el.getAttribute('href') || '', text: (el.textContent || '').trim()
}))`;
// Marking a candidate changes appearance only: no click delegation or arbitrary host fetch.
export function markHighlightScript(index: number): string {
    return `(() => { document.querySelectorAll('[data-akari-site-highlight]').forEach(el => el.removeAttribute('data-akari-site-highlight'));
 const el = document.querySelectorAll('a,button')[${Math.max(-1, Math.floor(index))}];
 if (el) el.setAttribute('data-akari-site-highlight', 'true'); return Boolean(el); })()`;
}

export function siteImportMetadata(site: AssetSite, sourceUrl: string): {
    origin: 'site'; site: string; sourceUrl: string; licenseAtSource: string; subscription: boolean; credit?: string;
} {
    return { origin: 'site', site: site.id, sourceUrl,
        licenseAtSource: site.terms.summary_ja, subscription: site.price === 'subscription',
        credit: site.attribution.required ? site.attribution.text : undefined };
}
