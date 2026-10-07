import { lookup as dnsLookup } from 'dns/promises';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { LookupAddress } from 'dns';
import { MAX_IMAGE_BYTES } from '../common/browser-pick';
import { safeImageUrl, safeResolvedAddresses } from '../common/ssrf-guard';

export type FetchReason = 'blocked-host' | 'bad-scheme' | 'too-many-redirects' | 'too-large' | 'timeout'
    | 'http-error' | 'not-an-image' | 'network';
export class ScratchFetchError extends Error { constructor(readonly reason: FetchReason) { super(reason); } }
export interface FetchedImage { bytes: Buffer; mime: string }
export function sniffImage(bytes: Buffer): string | undefined {
    if (bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))) return 'image/gif';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp'
        && ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))) return 'image/avif';
    return undefined;
}
export function acceptImage(bytes: Buffer, contentType: string): FetchedImage {
    const mime = contentType.split(';', 1)[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(mime) || sniffImage(bytes) !== mime)
        throw new ScratchFetchError('not-an-image');
    return { bytes, mime };
}

export interface FetchOptions {
    pageUrl: string; userAgent: string; allowLoopbackForTest?: boolean; timeoutMs?: number;
    resolver?: (host: string) => Promise<LookupAddress[]>;
}
export async function fetchScratchImage(raw: string, options: FetchOptions): Promise<FetchedImage> {
    const deadline = Date.now() + (options.timeoutMs ?? 30000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
    let target = raw;
    try {
    for (let redirect = 0; redirect <= 5; redirect++) {
        let parsed: URL;
        try { parsed = new URL(target); } catch { throw new ScratchFetchError('bad-scheme'); }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new ScratchFetchError('bad-scheme');
        if (!safeImageUrl(target, options.allowLoopbackForTest)) throw new ScratchFetchError('blocked-host');
        const host = parsed.hostname.replace(/^\[|\]$/gu, '');
        let addresses: LookupAddress[];
        try { addresses = await Promise.race([(options.resolver ?? (name => dnsLookup(name, { all: true })))(host),
            new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort',
                () => reject(new ScratchFetchError('timeout')), { once: true }))]); }
        catch (error) { throw error instanceof ScratchFetchError ? error : new ScratchFetchError('network'); }
        if (!safeResolvedAddresses(addresses.map(item => item.address), options.allowLoopbackForTest))
            throw new ScratchFetchError('blocked-host');
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new ScratchFetchError('timeout');
        const result = await new Promise<{ location?: string; image?: FetchedImage }>((resolve, reject) => {
            const request = (parsed.protocol === 'https:' ? httpsRequest : httpRequest)(parsed, {
                headers: { Referer: options.pageUrl, 'User-Agent': options.userAgent }, timeout: remaining,
                signal: controller.signal,
                lookup: (_hostname, lookupOptions, callback) => {
                    const selected = addresses[0];
                    if (lookupOptions.all) callback(null, [{ address: selected.address, family: selected.family }]);
                    else callback(null, selected.address, selected.family);
                }
            }, response => {
                const status = response.statusCode ?? 0;
                if (status >= 300 && status < 400 && response.headers.location) {
                    try { const location = new URL(response.headers.location, parsed).href;
                        response.resume(); resolve({ location }); }
                    catch { response.destroy(); reject(new ScratchFetchError('bad-scheme')); }
                    return;
                }
                if (status < 200 || status >= 300) { response.destroy(); reject(new ScratchFetchError('http-error')); return; }
                const type = String(response.headers['content-type'] ?? '');
                if (!/^image\/(?:jpeg|png|webp|gif|avif)(?:\s*;|\s*$)/iu.test(type)) {
                    response.destroy(); reject(new ScratchFetchError('not-an-image')); return;
                }
                if (Number(response.headers['content-length']) > MAX_IMAGE_BYTES) {
                    response.destroy(); reject(new ScratchFetchError('too-large')); return;
                }
                const chunks: Buffer[] = []; let size = 0;
                response.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > MAX_IMAGE_BYTES) { response.destroy(); reject(new ScratchFetchError('too-large')); }
                    else chunks.push(chunk);
                });
                response.on('end', () => {
                    try { resolve({ image: acceptImage(Buffer.concat(chunks), type) }); } catch (error) { reject(error); }
                });
                response.on('error', reject);
            });
            request.on('timeout', () => request.destroy(new ScratchFetchError('timeout')));
            request.on('error', error => reject(error instanceof ScratchFetchError ? error
                : controller.signal.aborted ? new ScratchFetchError('timeout') : new ScratchFetchError('network')));
            request.end();
        });
        if (result.image) return result.image;
        if (redirect === 5) throw new ScratchFetchError('too-many-redirects');
        target = result.location!;
    }
    throw new ScratchFetchError('too-many-redirects');
    } finally { clearTimeout(timer); }
}

export function decodeDataImage(raw: string): FetchedImage {
    const match = /^data:(image\/(?:jpeg|png|webp|gif|avif));base64,([a-z0-9+/=]+)$/iu.exec(raw);
    if (!match) throw new ScratchFetchError('not-an-image');
    if (match[2].length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4) throw new ScratchFetchError('too-large');
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new ScratchFetchError('too-large');
    return acceptImage(bytes, match[1]);
}
