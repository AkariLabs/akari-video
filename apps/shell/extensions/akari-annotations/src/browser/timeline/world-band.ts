import { worldBandLayout, WorldBandMap } from '../../common/world-band-layout';

export function createWorldBand(options: {
    map: WorldBandMap; top: number; height: number;
    secondsToPx: (seconds: number) => number;
    timeAtClientX: (clientX: number) => number;
    onSeek: (seconds: number) => void;
    onSelect: (target: { kind: 'world-stop' | 'world-edge'; id: string }) => void;
}): HTMLElement {
    const lane = document.createElement('div');
    lane.className = 'akari-world-band';
    Object.assign(lane.style, { position: 'absolute', left: '0', right: '0', top: `${options.top}px`, height: `${options.height}px`, pointerEvents: 'auto' });
    const layout = worldBandLayout(options.map, options.secondsToPx);
    for (const band of layout.bands) {
        const element = document.createElement('button');
        element.type = 'button'; element.dataset.akariItemKind = 'world-stop'; element.dataset.akariItemId = band.id;
        element.title = `${band.label}: ${band.at} s–${band.leave} s`;
        Object.assign(element.style, { position: 'absolute', left: `${band.left}px`, width: `${band.width}px`, top: '0', height: '100%', border: '0', background: band.color, opacity: '.78', color: '#10131a', overflow: 'hidden' });
        element.textContent = band.label;
        element.addEventListener('click', event => { event.stopPropagation(); options.onSeek(band.at); options.onSelect({ kind: 'world-stop', id: band.id }); });
        lane.appendChild(element);
    }
    for (const marker of layout.markers) {
        const element = document.createElement('button');
        element.type = 'button'; element.dataset.akariItemKind = 'world-edge'; element.dataset.akariItemId = marker.id; element.title = marker.title;
        Object.assign(element.style, { position: 'absolute', left: `${marker.left}px`, width: `${marker.width}px`, top: '0', height: '100%', border: '0', background: '#fff', padding: '0' });
        element.addEventListener('click', event => { event.stopPropagation(); options.onSelect({ kind: 'world-edge', id: marker.id }); });
        lane.appendChild(element);
    }
    lane.addEventListener('click', event => {
        const rect = lane.getBoundingClientRect();
        if (rect.width > 0) options.onSeek(options.timeAtClientX(event.clientX));
    });
    return lane;
}
