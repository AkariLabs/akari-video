import { shouldAnimateOpen } from './home-open-decision';

export interface OpenOriginRect { left: number; top: number; width: number; height: number }

/** カードを画面中央へ寄せ、ひと呼吸置いて画面いっぱいへ広げる。 */
export async function animateProjectOpen(originRect: OpenOriginRect | undefined, name: string, badge?: string, thumbnail?: string): Promise<void> {
    if (!shouldAnimateOpen({ hasOrigin: !!originRect, reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches })
        || !document.body.animate) { return; }
    const origin = originRect!;
    const dim = document.createElement('div');
    dim.className = 'akari-flydim';
    Object.assign(dim.style, { position: 'fixed', inset: '0', zIndex: '19999', background: 'rgba(8,12,20,.36)', pointerEvents: 'none' });
    const card = document.createElement('div');
    card.className = 'akari-flycard';
    Object.assign(card.style, { position: 'fixed', zIndex: '20000', overflow: 'hidden', background: 'var(--theia-editor-background)', color: 'var(--theia-foreground)', pointerEvents: 'none', display: 'flex', flexDirection: 'column' });
    if (thumbnail) {
        const image = document.createElement('img'); image.src = thumbnail; image.alt = '';
        Object.assign(image.style, { display: 'block', width: '100%', aspectRatio: '16 / 9', objectFit: 'cover' });
        card.appendChild(image);
    }
    const title = document.createElement('b'); title.textContent = name; title.style.padding = '8px 12px'; card.appendChild(title);
    if (badge) { const status = document.createElement('small'); status.textContent = badge; status.style.padding = '0 12px 10px'; card.appendChild(status); }
    document.body.append(dim, card);
    const box = (left: number, top: number, width: number, height: number) => ({ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
    const midWidth = Math.min(400, window.innerWidth * .62), midHeight = midWidth * .74;
    const middle = box((window.innerWidth - midWidth) / 2, (window.innerHeight - midHeight) / 2, midWidth, midHeight);
    const from = box(origin.left, origin.top, origin.width, origin.height);
    const to = box(0, 0, window.innerWidth, window.innerHeight);
    try {
        dim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, fill: 'forwards' });
        await card.animate([{ ...from, borderRadius: '10px', boxShadow: '0 0 0 transparent' }, { ...middle, borderRadius: '18px', boxShadow: '0 34px 90px rgba(0,0,0,.38)' }],
            { duration: 720, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' }).finished;
        await card.animate([{ ...middle, borderRadius: '18px' }, { ...to, borderRadius: '0' }],
            { duration: 820, delay: 260, easing: 'cubic-bezier(.55,0,.15,1)', fill: 'forwards' }).finished;
    } finally { card.remove(); dim.remove(); }
}
