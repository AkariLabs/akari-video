import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AkariPreviewService } from 'akari-preview/lib/common/akari-preview-protocol';
import { VisualThumbnailCache } from 'akari-preview/lib/common/visual-thumbnail-cache';
import { visualThumbnailKey } from 'akari-preview/lib/common/visual-thumbnail-key';
import { VisualThumbnailCapture, VisualThumbnailContentRect } from 'akari-preview/lib/common/visual-thumbnail';
import { visualThumbnailCrop } from 'akari-annotations/lib/common/visual-thumbnail-crop';
import { hoverFrameTimes, hoverPopupPosition } from '../common/material-card-hover';

type AssetPage = Awaited<ReturnType<AkariPreviewService['prepareAssetVisualThumbnail']>>;
const listeners = new Set<() => void>();
/** All material cards, including duplicates, share one bounded single-flight queue. */
export const visualThumbnails = new VisualThumbnailCache(() => { for (const changed of listeners) changed(); });

interface Props { assetUri: string; service: AkariPreviewService; files: FileService; icon: string; }

/** Owns only the thumbnail and its hover listeners; the card retains click/drag/menu behavior. */
export function MaterialCardHoverPreview(props: Props): React.ReactElement {
    const ref = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        const element = ref.current;
        const card = element?.closest<HTMLElement>('[data-akari-material-path]');
        if (!element || !card) return;
        const controller = new MaterialHoverController(element, card, props);
        return () => controller.dispose();
    }, [props.assetUri, props.service, props.files, props.icon]);
    return React.createElement('div', { ref, style: { position: 'absolute', inset: 0, pointerEvents: 'none' } });
}

class MaterialHoverController {
    private alive = true;
    private visible = false;
    private generation = 0;
    private hoverGeneration = 0;
    private metadata?: AssetPage;
    private loading = false;
    private hovered = false;
    private popup?: HTMLDivElement;
    private delay?: ReturnType<typeof setTimeout>;
    private timer?: ReturnType<typeof setInterval>;
    private frames = new Map<number, VisualThumbnailCapture>();
    private current?: number;
    private observer: IntersectionObserver;
    private resizeObserver: ResizeObserver;
    private fileChanges: { dispose(): void };
    private readonly motion = window.matchMedia('(prefers-reduced-motion: reduce)');

    constructor(private readonly element: HTMLDivElement, private readonly card: HTMLElement, private readonly props: Props) {
        this.observer = new IntersectionObserver(entries => {
            this.visible = entries.some(entry => entry.isIntersecting);
            if (this.visible) this.refresh(); else this.close();
        });
        this.observer.observe(card);
        this.resizeObserver = new ResizeObserver(() => this.paint());
        this.resizeObserver.observe(element);
        const assetUri = new URI(props.assetUri);
        const watchedUri = assetUri.path.base.toLowerCase() === 'meta.json' ? assetUri.parent : assetUri;
        this.fileChanges = props.files.onDidFilesChange(event => {
            if (!event.contains(watchedUri) && !event.changes.some(change => watchedUri.isEqualOrParent(change.resource))) return;
            this.generation++; this.close(); this.metadata = undefined; this.frames.clear(); this.loading = false;
            this.paint(); this.refresh();
        });
        listeners.add(this.refresh);
        card.addEventListener('mouseenter', this.enter);
        card.addEventListener('mouseleave', this.close);
        window.addEventListener('scroll', this.close, true);
        window.addEventListener('resize', this.close);
        window.addEventListener('keydown', this.keydown);
        this.motion.addEventListener('change', this.close);
        this.paint();
    }

    private release = async (page: AssetPage): Promise<void> => {
        await Promise.all(page.streamIds.map(id => this.props.service.disposeAssetStream(id)));
    };

    private refresh = (): void => {
        if (!this.alive || !this.visible) return;
        if (!this.metadata) {
            if (this.loading) return;
            this.loading = true;
            const generation = this.generation;
            void (async () => {
                try {
                    const page = await this.props.service.prepareAssetVisualThumbnail({ assetUri: this.props.assetUri });
                    await this.release(page);
                    if (!this.alive || generation !== this.generation) return;
                    this.metadata = page;
                    this.refresh();
                } catch { /* Unavailable fragments keep the existing icon. */ }
                finally { if (generation === this.generation) this.loading = false; }
            })();
            return;
        }
        const page = this.metadata;
        const generation = this.generation;
        const hoverGeneration = this.hoverGeneration;
        const midpoint = page.duration / 2;
        const times = this.hovered && !this.motion.matches ? [midpoint, ...hoverFrameTimes(page.duration).filter(t => t !== midpoint)] : [midpoint];
        for (const time of times) {
            const wanted = (): boolean => this.alive && this.visible && generation === this.generation
                && (time === midpoint || (this.hovered && hoverGeneration === this.hoverGeneration));
            const key = visualThumbnailKey(page.assetUri, `t=${time}`, [page.mtime, page.size]);
            const value = visualThumbnails.request({ key, priority: time === midpoint ? 0 : 1, wanted, valid: wanted,
                capture: async () => {
                    const prepared = await this.props.service.prepareAssetVisualThumbnail({ assetUri: page.assetUri, time });
                    try {
                        if (!wanted() || prepared.mtime !== page.mtime || prepared.size !== page.size) throw new Error('Stale material thumbnail');
                        const api = (window as unknown as { electronAkariPreview?: {
                            captureVisualThumbnail(page: AssetPage): Promise<VisualThumbnailCapture | string>;
                        } }).electronAkariPreview;
                        if (!api) throw new Error('Visual capture unavailable');
                        const result = await api.captureVisualThumbnail(prepared);
                        return typeof result === 'string' ? { image: result } : result;
                    } finally { await this.release(prepared); }
                }
            });
            if (value && !this.frames.has(time)) {
                this.frames.set(time, value);
                // Newly delivered frames are shown immediately, then join the cycle.
                this.current = time;
            }
        }
        this.paint();
    };

    private enter = (): void => {
        if (this.delay || this.hovered) return;
        this.delay = setTimeout(() => {
            this.delay = undefined;
            if (!this.alive || !this.visible) return;
            this.hovered = true;
            this.popup = document.createElement('div');
            this.popup.className = 'akari-material-hover-preview';
            this.popup.setAttribute('role', 'tooltip');
            const position = hoverPopupPosition(this.card.getBoundingClientRect(),
                { width: window.innerWidth, height: window.innerHeight }, { width: 300, height: 334 });
            Object.assign(this.popup.style, { position: 'fixed', left: `${position.left}px`, top: `${position.top}px`,
                width: '300px', height: '334px', zIndex: '10000', pointerEvents: 'none', borderRadius: '8px', overflow: 'hidden',
                background: 'var(--theia-editor-background, #20252b)', color: 'var(--theia-editor-foreground, #eee)',
                boxShadow: '0 4px 24px #0008', border: '1px solid var(--theia-panel-border, #555)' });
            document.body.append(this.popup);
            this.refresh();
            if (!this.motion.matches) this.timer = setInterval(() => {
                const times = [...this.frames.keys()];
                if (times.length) this.current = times[(times.indexOf(this.current!) + 1) % times.length];
                this.paint();
            }, 350);
        }, 250);
    };

    private keydown = (event: KeyboardEvent): void => { if (event.key === 'Escape') this.close(); };
    private close = (): void => {
        if (this.delay) clearTimeout(this.delay);
        if (this.timer) clearInterval(this.timer);
        this.delay = undefined; this.timer = undefined;
        this.hovered = false; this.hoverGeneration++;
        this.popup?.remove(); this.popup = undefined;
        this.current = this.metadata ? this.metadata.duration / 2 : undefined;
        for (const time of this.frames.keys()) if (!this.visible || time !== this.current) this.frames.delete(time);
        this.paint();
    };

    private paint(): void {
        const page = this.metadata;
        const time = this.hovered ? this.current : page ? page.duration / 2 : undefined;
        const frame = time === undefined ? undefined : this.frames.get(time);
        this.element.dataset.akariVisualThumbnail = frame ? 'ready' : 'pending';
        this.element.dataset.time = String(time ?? '');
        // A common union keeps the crop stable as animation content moves between frames.
        const rects = [...this.frames.values()].map(value => value.contentRect).filter((r): r is VisualThumbnailContentRect => !!r);
        const union = rects.length ? { x: Math.min(...rects.map(r => r.x)), y: Math.min(...rects.map(r => r.y)),
            width: 0, height: 0 } : undefined;
        if (union) {
            union.width = Math.max(...rects.map(r => r.x + r.width)) - union.x;
            union.height = Math.max(...rects.map(r => r.y + r.height)) - union.y;
        }
        const draw = (host: HTMLElement, size: number): void => {
            host.replaceChildren();
            if (!frame || !page) {
                const icon = document.createElement('span'); icon.className = this.props.icon;
                Object.assign(icon.style, { fontSize: '1.8em', opacity: '0.5', position: 'absolute', top: '40%', left: '40%' });
                host.append(icon); return;
            }
            const crop = visualThumbnailCrop(union, page);
            const x = crop && union ? Math.max(0, union.x - union.width * 0.04) : 0;
            const y = crop && union ? Math.max(0, union.y - union.height * 0.04) : 0;
            const width = crop && union ? Math.min(page.width, union.x + union.width * 1.04) - x : page.width;
            const height = crop && union ? Math.min(page.height, union.y + union.height * 1.04) - y : page.height;
            const scale = Math.min(size / width, size / height);
            const viewport = document.createElement('div');
            Object.assign(viewport.style, { position: 'absolute', overflow: 'hidden', width: `${width * scale}px`, height: `${height * scale}px`,
                left: `${(size - width * scale) / 2}px`, top: `${(size - height * scale) / 2}px` });
            const image = document.createElement('img'); image.src = frame.image; image.alt = ''; image.draggable = false;
            Object.assign(image.style, { position: 'absolute', maxWidth: 'none', width: `${page.width * scale}px`, height: `${page.height * scale}px`,
                left: `${-x * scale}px`, top: `${-y * scale}px`, objectFit: 'contain', objectPosition: crop?.objectPosition ?? 'center' });
            viewport.append(image); host.append(viewport);
        };
        draw(this.element, this.element.clientWidth);
        if (this.popup) {
            draw(this.popup, 300);
            this.popup.dataset.time = String(time ?? '');
            const footer = document.createElement('div');
            Object.assign(footer.style, { position: 'absolute', bottom: '5px', left: '12px', right: '12px', display: 'flex', gap: '5px', alignItems: 'center' });
            for (const t of hoverFrameTimes(page?.duration ?? 5)) {
                const dot = document.createElement('span'); dot.dataset.active = String(t === time);
                Object.assign(dot.style, { flex: '1', height: '3px', borderRadius: '2px', background: t === time ? '#79b8ff' : '#666' });
                footer.append(dot);
            }
            const label = document.createElement('span'); label.textContent = `${(time ?? 0).toFixed(1)} / ${(page?.duration ?? 5).toFixed(1)} s`;
            Object.assign(label.style, { fontSize: '11px', marginLeft: '6px' }); footer.append(label); this.popup.append(footer);
        }
    }

    dispose(): void {
        this.alive = false; this.close(); this.observer.disconnect(); this.resizeObserver.disconnect(); this.fileChanges.dispose();
        listeners.delete(this.refresh);
        this.card.removeEventListener('mouseenter', this.enter); this.card.removeEventListener('mouseleave', this.close);
        window.removeEventListener('scroll', this.close, true); window.removeEventListener('resize', this.close);
        window.removeEventListener('keydown', this.keydown); this.motion.removeEventListener('change', this.close);
    }
}
