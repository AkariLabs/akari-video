import { AssetSite, siteDownloadChainAllowed, siteUrlAllowed } from './asset-sites';

export type SitePolicy = { hosts: readonly string[]; download_hosts: readonly string[];
    navigation?: AssetSite['navigation']; downloads?: AssetSite['downloads'] };

function blockedIpv4(host: string): boolean {
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
        || a === 192 && b === 168;
}

function blockedIpv6(host: string): boolean {
    if (!host.startsWith('[') || !host.endsWith(']')) return false;
    const value = host.slice(1, -1).toLowerCase();
    const first = Number.parseInt(value.split(':').find(Boolean) ?? '0', 16);
    if (value === '::' || value === '::1' || first >= 0xfc00 && first <= 0xfdff
        || first >= 0xfe80 && first <= 0xfebf) return true;
    // IPv4-mapped addresses are canonicalized to hexadecimal by URL.
    if (value.startsWith('::ffff:')) {
        const words = value.slice(7).split(':');
        if (words.length === 2) {
            const hi = Number.parseInt(words[0], 16); const lo = Number.parseInt(words[1], 16);
            if (Number.isFinite(hi) && Number.isFinite(lo)) return blockedIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
        }
    }
    return false;
}

export function blockedWebHost(host: string): boolean {
    const name = host.toLowerCase().replace(/\.$/, '');
    return name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')
        || name.endsWith('.internal') || blockedIpv4(name) || blockedIpv6(name);
}

export function navigationAllowed(raw: string, def: SitePolicy, testHttp = false): boolean {
    if (def.navigation !== 'open') return siteUrlAllowed(raw, def.hosts, testHttp);
    try {
        const url = new URL(raw);
        if (url.username || url.password) return false;
        if (url.href === 'about:blank') return true;
        if (testHttp && url.protocol === 'http:' && url.hostname === '127.0.0.1') return true;
        // DNS results are not available at navigation time. Fetching an image must recheck its resolved IP.
        return url.protocol === 'https:' && !blockedWebHost(url.hostname);
    } catch { return false; }
}

export function downloadChainAllowed(urls: readonly string[], def: SitePolicy, testHttp = false): boolean {
    return def.downloads === 'deny' ? false : siteDownloadChainAllowed(urls,
        { hosts: [...def.hosts], download_hosts: [...def.download_hosts] }, testHttp);
}
