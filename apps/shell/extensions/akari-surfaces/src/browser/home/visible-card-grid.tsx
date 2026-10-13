import * as React from '@theia/core/shared/react';

export interface VisibleCardGridProps<T> {
    rows: T[];
    rowKey: (row: T) => string;
    rowLabel: (row: T) => string;
    className: string;
    initialHeight: number;
    isSettled?: (row: T) => boolean;
    renderCard: (row: T, onSettled: () => void) => React.ReactNode;
    onVisibleChange?: (keys: ReadonlySet<string>) => void;
}

export function visibleCardRange(total: number, columns: number, firstRow: number, lastRow: number, marginRows = 2): [number, number] {
    const start = Math.max(0, firstRow - marginRows) * columns;
    const end = Math.min(total, (lastRow + marginRows + 1) * columns);
    return [Math.min(total, start), Math.max(Math.min(total, start), end)];
}

export class CardSlotHeights {
    private width?: number;
    private readonly measured = new Map<string, number>();
    private estimate?: number;

    setWidth(width: number): boolean {
        if (!Number.isFinite(width) || width <= 0) return false;
        const next = Math.round(width * 64) / 64;
        if (next === this.width) return false;
        this.width = next;
        this.measured.clear();
        this.estimate = undefined;
        return true;
    }

    record(key: string, height: number, settled = true): boolean {
        if (!settled || !Number.isFinite(height) || height <= 0) return false;
        const next = Math.round(height * 64) / 64;
        if (this.measured.get(key) === next) return false;
        this.measured.set(key, next);
        const counts = new Map<number, number>();
        let estimate = next;
        let highest = 0;
        const preferred = this.estimate;
        for (const measured of this.measured.values()) {
            const count = (counts.get(measured) ?? 0) + 1;
            counts.set(measured, count);
            if (count > highest || (count === highest && measured === preferred)) {
                highest = count;
                estimate = measured;
            }
        }
        const changed = this.estimate !== estimate;
        this.estimate = estimate;
        return changed;
    }

    heightFor(key: string, initialHeight: number): number {
        return this.measured.get(key) ?? this.estimate ?? initialHeight;
    }

    has(key: string): boolean {
        return this.measured.has(key);
    }
}

export const visibleCardGridCss = '.akari-card-slot{display:grid;grid-template-columns:minmax(0,1fr);min-width:0}';

export function VisibleCardGrid<T>(props: VisibleCardGridProps<T>): React.ReactElement {
    const [visible, setVisible] = React.useState<ReadonlySet<string>>(() => new Set());
    const [focused, setFocused] = React.useState<string>();
    const [, setHeightVersion] = React.useState(0);
    const nodes = React.useRef(new Map<string, HTMLDivElement>());
    const visibleKeys = React.useRef<ReadonlySet<string>>(visible);
    const heights = React.useRef(new CardSlotHeights());
    const resizeObserver = React.useRef<ResizeObserver>();
    const observedSizes = React.useRef(new Set<Element>());
    const keys = props.rows.map(props.rowKey);
    const rowsByKey = React.useRef(new Map<string, T>());
    rowsByKey.current = new Map(props.rows.map(row => [props.rowKey(row), row]));
    const isSettled = React.useRef(props.isSettled);
    isSettled.current = props.isSettled;
    const keySignature = keys.join('\0');

    const measureSettled = (key: string): void => {
        const row = rowsByKey.current.get(key);
        if (!row || isSettled.current?.(row) === false) return;
        const button = nodes.current.get(key)?.querySelector('button');
        if (button && heights.current.record(key, button.getBoundingClientRect().height)) {
            setHeightVersion(version => version + 1);
        }
    };

    React.useEffect(() => {
        const intersecting = new Set<string>();
        const observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                const key = (entry.target as HTMLElement).dataset.akariCardKey;
                if (!key) continue;
                if (entry.isIntersecting) intersecting.add(key);
                else intersecting.delete(key);
            }
            const firstNode = nodes.current.get(keys[0]);
            const columns = firstNode?.parentElement
                ? Math.max(1, getComputedStyle(firstNode.parentElement).gridTemplateColumns.split(' ').length) : 1;
            const indices = [...intersecting].map(key => keys.indexOf(key)).filter(index => index >= 0);
            const next = new Set<string>();
            if (indices.length) {
                const [start, end] = visibleCardRange(keys.length, columns,
                    Math.floor(Math.min(...indices) / columns), Math.floor(Math.max(...indices) / columns));
                for (let index = start; index < end; index++) next.add(keys[index]);
            }
            const previous = visibleKeys.current;
            if (next.size === previous.size && [...next].every(key => previous.has(key))) return;
            visibleKeys.current = next;
            setVisible(next);
            props.onVisibleChange?.(next);
        }, { rootMargin: '400px 0px' });
        for (const node of nodes.current.values()) observer.observe(node);
        return () => observer.disconnect();
    }, [keySignature]);

    React.useLayoutEffect(() => {
        if (!focused) return;
        const button = nodes.current.get(focused)?.querySelector('button');
        button?.focus({ preventScroll: true });
    }, [focused]);

    React.useLayoutEffect(() => {
        if (!resizeObserver.current) {
            resizeObserver.current = new ResizeObserver(entries => {
                let changed = false;
                for (const entry of entries) {
                    if (!entry.target.classList.contains('akari-card-slot')) continue;
                    const box = entry.borderBoxSize[0];
                    changed = heights.current.setWidth(box?.inlineSize ?? entry.contentRect.width) || changed;
                }
                for (const entry of entries) {
                    if (entry.target.classList.contains('akari-card-slot')) continue;
                    const key = (entry.target as HTMLElement).parentElement?.dataset.akariCardKey;
                    if (!key) continue;
                    const box = entry.borderBoxSize[0];
                    const row = rowsByKey.current.get(key);
                    changed = heights.current.record(key, box?.blockSize ?? entry.target.getBoundingClientRect().height,
                        !!row && isSettled.current?.(row) !== false) || changed;
                }
                if (changed) setHeightVersion(version => version + 1);
            });
        }
        const next = new Set<Element>();
        const first = nodes.current.get(keys[0]);
        if (first) next.add(first);
        for (const key of new Set([...visibleKeys.current, ...(focused ? [focused] : [])])) {
            const button = nodes.current.get(key)?.querySelector('button');
            if (button) next.add(button);
            if (button && !heights.current.has(key)) measureSettled(key);
        }
        for (const element of observedSizes.current) {
            if (!next.has(element)) resizeObserver.current.unobserve(element);
        }
        for (const element of next) {
            if (!observedSizes.current.has(element)) resizeObserver.current.observe(element, { box: 'border-box' });
        }
        observedSizes.current = next;
    });

    React.useEffect(() => () => {
        resizeObserver.current?.disconnect();
        resizeObserver.current = undefined;
        observedSizes.current.clear();
    }, []);

    return <div className={props.className}>{props.rows.map(row => {
        const key = props.rowKey(row);
        const present = visible.has(key) || focused === key;
        return <div key={key} className='akari-card-slot' data-akari-card-key={key}
            data-akari-project-card-slot={present ? undefined : 'true'}
            style={present ? undefined : { minHeight: heights.current.heightFor(key, props.initialHeight) }}
            ref={node => { if (node) nodes.current.set(key, node); else nodes.current.delete(key); }}
            role={present ? undefined : 'button'} aria-label={present ? undefined : props.rowLabel(row)}
            tabIndex={present ? undefined : 0}
            onFocus={event => { if (event.target === event.currentTarget && !present) setFocused(key); }}
            onBlur={event => { if (focused === key && !event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(undefined); }}>
            {present ? props.renderCard(row, () => measureSettled(key)) : null}
        </div>;
    })}</div>;
}
