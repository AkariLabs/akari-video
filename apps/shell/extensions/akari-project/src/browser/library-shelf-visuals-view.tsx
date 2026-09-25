import * as React from '@theia/core/shared/react';
import type { AssetCatalogViewItem } from '../common/akari-project-protocol';
import { AKARI_SURFACE } from '../common/akari-surface-tokens';
import { fontPreviewPath } from '../common/library-shelf-visuals';
import { textAnimationSampleKeyframes } from '../common/text-animation-sample';
import { LibrarySimpleCard } from './library-card-view';

const CSS = `
[data-akari-transition-strip] { display:flex; position:relative; width:100%; height:100%; overflow:hidden; }
[data-akari-transition-frame] { width:33.333%; height:100%; background-size:300% 100%; background-repeat:no-repeat; }
[data-akari-transition-frame]:nth-child(1) { background-position:0% 50%; }
[data-akari-transition-frame]:nth-child(2) { background-position:50% 50%; }
[data-akari-transition-frame]:nth-child(3) { background-position:100% 50%; }
[data-akari-transition-hover-strip] { position:absolute; inset:0; opacity:0; background-size:500% 100%; background-repeat:no-repeat; }
[data-akari-library-transition]:hover [data-akari-transition-hover-strip] { opacity:1; animation:akari-shelf-strip .3s steps(4,end) both; }
@keyframes akari-shelf-strip { from { background-position:0% 50%; } to { background-position:100% 50%; } }
[data-akari-textanim-sample] { display:inline-block; }
@media (prefers-reduced-motion: reduce) {
    [data-akari-library-transition]:hover [data-akari-transition-hover-strip] { opacity:0; animation:none; }
}
`;

export function LibraryShelfVisualStyles(): React.ReactElement { return <style data-akari-shelf-visual-css>{CSS}</style>; }

export function LutPreview(props: { url?: string }): React.ReactElement {
    return <span data-akari-lut-preview style={{ width: '100%', height: '100%', display: 'block', background: AKARI_SURFACE.card }}>
        {props.url && <img src={props.url} alt='ビフォー｜アフター' draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
    </span>;
}

export function TransitionStrip(props: { url?: string; stripUrl?: string }): React.ReactElement {
    return <span data-akari-transition-strip style={{ background: AKARI_SURFACE.card }}>
        {[0, 1, 2].map(index => <span key={index} data-akari-transition-frame
            style={props.url ? { backgroundImage: `url("${props.url}")` } : undefined} />)}
        <span data-akari-transition-hover-strip
            style={props.stripUrl ? { backgroundImage: `url("${props.stripUrl}")` } : undefined} />
    </span>;
}

export function playTextAnimationSample(card: HTMLElement, id: string, slot: 'in' | 'loop' | 'out'): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const target = card.querySelector<HTMLElement>('[data-akari-textanim-sample]');
    if (!target) return;
    target.getAnimations().forEach(animation => animation.cancel());
    const sample = textAnimationSampleKeyframes(id, slot);
    target.animate(sample.keyframes, { duration: sample.durationMs, iterations: 1, easing: 'ease-out' });
}

export function FontShelfCard(props: { item: AssetCatalogViewItem; layout: 'grid' | 'list'; favorite: boolean;
    onApply(): void; onDragStart(event: React.DragEvent<HTMLElement>): void; onDragEnd(): void;
    onContextMenu(event: React.MouseEvent<HTMLElement>): void; onInfo(anchor: HTMLElement): void }): React.ReactElement {
    const { item } = props;
    return <LibrarySimpleCard cardKey={item.key} name={item.title} layout={props.layout} infoOpen={false}
        favorite={props.favorite} attributes={{ 'data-akari-font-card': item.id, 'data-akari-catalog-item': item.key,
            'data-akari-font-preview-path': fontPreviewPath(item.id) }}
        draggable onDragStart={props.onDragStart} onDragEnd={props.onDragEnd}
        onClick={props.onApply} onContextMenu={props.onContextMenu} onInfo={props.onInfo}
        face={item.previewUrl
            ? <img src={item.previewUrl} alt={`${item.title} の見本`} draggable={false}
                style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
            : <span data-akari-font-fallback style={{ fontFamily: item.title.replace(/（.*$/, ''), fontSize: '0.72em', textAlign: 'center', padding: '4px', color: 'var(--akari-muted)' }}>
                あア亜 ABC 123
            </span>} />;
}
