const SHA_PRIMES: number[] = [];
for (let candidate = 2; SHA_PRIMES.length < 64; candidate++) {
    if (SHA_PRIMES.every(prime => candidate % prime !== 0)) SHA_PRIMES.push(candidate);
}
const SHA_K = SHA_PRIMES.map(prime => Math.floor((Math.cbrt(prime) % 1) * 0x100000000) >>> 0);
const SHA_INITIAL = SHA_PRIMES.slice(0, 8).map(prime => Math.floor((Math.sqrt(prime) % 1) * 0x100000000) >>> 0);
const HASH_CACHE = new Map<string, string>();

function assetHash(category: string, id: string): string {
    const reference = `${category}/${id}`;
    let hash = HASH_CACHE.get(reference);
    if (hash === undefined) {
        hash = sha256(reference);
        HASH_CACHE.set(reference, hash);
    }
    return hash;
}

/** Synchronous SHA-256 for catalogue ordering in both browser and Node. */
export function sha256(value: string): string {
    const input = new TextEncoder().encode(value);
    const length = Math.ceil((input.length + 9) / 64) * 64;
    const bytes = new Uint8Array(length);
    bytes.set(input);
    bytes[input.length] = 0x80;
    const view = new DataView(bytes.buffer);
    const bitLength = input.length * 8;
    view.setUint32(length - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(length - 4, bitLength >>> 0, false);
    const h = [...SHA_INITIAL];
    const rotate = (n: number, bits: number): number => (n >>> bits) | (n << (32 - bits));
    for (let offset = 0; offset < length; offset += 64) {
        const w = new Uint32Array(64);
        for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
        for (let i = 16; i < 64; i++) {
            const a = w[i - 15], b = w[i - 2];
            w[i] = (w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3))
                + w[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))) >>> 0;
        }
        let [a, b, c, d, e, f, g, j] = h;
        for (let i = 0; i < 64; i++) {
            const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
            const t1 = (j + s1 + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) >>> 0;
            const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
            const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
            j = g; g = f; f = e; e = (d + t1) >>> 0;
            d = c; c = b; b = a; a = (t1 + t2) >>> 0;
        }
        for (const [index, word] of [a, b, c, d, e, f, g, j].entries()) h[index] = (h[index] + word) >>> 0;
    }
    return h.map(word => word.toString(16).padStart(8, '0')).join('');
}

export function mixOrder<T extends { category: string; id: string; tier?: string }>(
    items: readonly T[], { screen = 12, minFree = 3 }: { screen?: number; minFree?: number } = {}
): T[] {
    const keys = new Map(items.map(item => [item, assetHash(item.category, item.id)]));
    const key = (item: T): string => keys.get(item)!;
    const compare = (a: T, b: T): number => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    const ordered = [...items].sort(compare);
    const head = ordered.slice(0, screen);
    const tail = ordered.slice(screen);
    const needed = minFree - head.filter(item => item.tier !== 'pro').length;
    if (needed <= 0) return ordered;
    const promoted = tail.filter(item => item.tier !== 'pro').slice(0, needed);
    if (!promoted.length) return ordered;
    const demoted: T[] = [];
    for (let p = head.length - 1; p >= 0 && demoted.length < promoted.length; p--) {
        if (head[p].tier === 'pro') demoted.unshift(head.splice(p, 1)[0]);
    }
    const promotedSet = new Set(promoted);
    return [...head, ...promoted].sort(compare).concat(demoted, tail.filter(item => !promotedSet.has(item)));
}
