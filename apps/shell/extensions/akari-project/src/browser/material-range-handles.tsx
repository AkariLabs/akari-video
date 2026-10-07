import * as React from '@theia/core/shared/react';
import { clampMaterialRange, materialRangeLabel, MaterialRange } from '../common/material-range';

interface Props {
    durationSeconds: number;
    range?: MaterialRange;
    onChange: (range: MaterialRange | null) => void;
}

/** Overlay on a selected filmstrip; the strip image itself remains untouched. */
export function MaterialRangeHandles({ durationSeconds, range, onChange }: Props): React.ReactElement {
    const root = React.useRef<HTMLDivElement>(null);
    const label = React.useRef<HTMLDivElement>(null);
    const [width, setWidth] = React.useState(0);
    const [labelWidth, setLabelWidth] = React.useState(0);
    React.useEffect(() => {
        const element = root.current;
        if (!element) return;
        const resize = (): void => setWidth(element.clientWidth);
        const resizeLabel = (): void => setLabelWidth(label.current?.getBoundingClientRect().width ?? 0);
        resize();
        resizeLabel();
        const observer = new ResizeObserver(resize);
        observer.observe(element);
        const labelObserver = new ResizeObserver(resizeLabel);
        if (label.current) labelObserver.observe(label.current);
        return () => { observer.disconnect(); labelObserver.disconnect(); };
    }, []);
    const current = range ?? { in: 0, out: durationSeconds };
    const left = width * current.in / durationSeconds;
    const right = width * current.out / durationSeconds;
    const labelCenter = Math.max(labelWidth / 2 + 2,
        Math.min(width - labelWidth / 2 - 2, (left + right) / 2));
    const handleStyle: React.CSSProperties = {
        position: 'absolute', top: 0, bottom: 0, width: '10px', background: '#f97316',
        cursor: 'ew-resize', touchAction: 'none', zIndex: 3
    };
    const begin = (which: 'in' | 'out') => (event: React.PointerEvent<HTMLDivElement>): void => {
        event.preventDefault(); event.stopPropagation();
        const handle = event.currentTarget;
        handle.setPointerCapture(event.pointerId);
        const move = (next: PointerEvent): void => {
            const bounds = root.current?.getBoundingClientRect();
            if (!bounds?.width) return;
            const time = Math.max(0, Math.min(durationSeconds,
                (next.clientX - bounds.left) / bounds.width * durationSeconds));
            const updated = clampMaterialRange({ ...current, [which]: time }, durationSeconds, bounds.width, which);
            onChange(updated);
        };
        const finish = (): void => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', finish);
            handle.removeEventListener('pointercancel', finish);
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', finish);
        handle.addEventListener('pointercancel', finish);
    };
    const shade: React.CSSProperties = { position: 'absolute', top: 0, bottom: 0,
        background: 'rgba(0,0,0,.62)', pointerEvents: 'none' };
    return <div ref={root} data-akari-material-range-handles
        style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none' }}>
        <div className='shade' style={{ ...shade, left: 0, width: left }} />
        <div className='shade' style={{ ...shade, left: right, right: 0 }} />
        {(['in', 'out'] as const).map(which => <div key={which}
            className={`hnd ${which === 'in' ? 'l' : 'r'}`}
            draggable={false} onPointerDown={begin(which)} onClick={event => event.stopPropagation()}
            style={{ ...handleStyle, left: which === 'in' ? Math.max(0, left - 10) : Math.min(width - 10, right),
                borderRadius: which === 'in' ? '3px 0 0 3px' : '0 3px 3px 0', pointerEvents: 'auto' }}>
            <span style={{ position: 'absolute', top: '50%', left: '4px', width: '2px', height: '14px',
                marginTop: '-7px', background: '#000', opacity: .55 }} />
        </div>)}
        <div ref={label} className='range-lbl' onClick={event => event.stopPropagation()}
            style={{ position: 'absolute', top: '3px', left: labelCenter,
            transform: 'translateX(-50%)', font: '600 10px/1 monospace', color: '#000',
            background: '#ffb47a', padding: '2px 5px', borderRadius: '3px', whiteSpace: 'nowrap',
            pointerEvents: 'auto', zIndex: 4 }}>
            {materialRangeLabel(current, width < 240)}
            <button type='button' title='範囲をなしに戻す' onClick={event => { event.stopPropagation(); onChange(null); }}
                style={{ marginLeft: '4px', border: 0, padding: 0, background: 'transparent', cursor: 'pointer' }}>×</button>
        </div>
    </div>;
}
