import * as React from '@theia/core/shared/react';
import { VibeDockIconName } from '../common/vibe-dock-tab';

const h = React.createElement;

/** Paths and geometry from mock-sample-A-excerpt.html #dockTabs and #expand. */
const paths: Record<VibeDockIconName | 'handoff' | 'expand' | 'more', React.ReactNode[]> = {
    now: [h('path', { key: 'a', d: 'M3 4h10M3 8h7M3 12h5' })],
    next: [h('path', { key: 'a', d: 'M3 4.5l1.5 1.5L7 3.5M3 9.5l1.5 1.5L7 8.5M9 5h4M9 10h4' })],
    handoff: [h('path', { key: 'a', d: 'M1.5 4.5h4l1.5 1.5h7.5v7h-13z' })],
    canvas: [h('rect', { key: 'a', x: 2.5, y: 2.5, width: 11, height: 11, rx: 1.5 }),
        h('path', { key: 'b', d: 'M5 11l2.5-3 2 2 1.5-2 2 3' })],
    settings: [h('circle', { key: 'a', cx: 8, cy: 8, r: 2.2 }),
        h('path', { key: 'b', d: 'M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1' })],
    expand: [h('path', { key: 'a', d: 'M4 10l4-4 4 4' })],
    more: [h('circle', { key: 'a', cx: 4, cy: 8, r: .8, fill: 'currentColor', stroke: 'none' }),
        h('circle', { key: 'b', cx: 8, cy: 8, r: .8, fill: 'currentColor', stroke: 'none' }),
        h('circle', { key: 'c', cx: 12, cy: 8, r: .8, fill: 'currentColor', stroke: 'none' })]
};

export function vibeDockIcon(name: VibeDockIconName | 'expand' | 'more'): React.ReactElement {
    return h('svg', {
        viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: name === 'settings' ? 1.4 : 1.5,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
    }, ...paths[name]);
}
