import * as React from '@theia/core/shared/react';
import { ThisVideoDescription } from '../../common/export-this-video';

function gcd(left: number, right: number): number {
    let a = Math.round(Math.abs(left));
    let b = Math.round(Math.abs(right));
    while (b) {
        [a, b] = [b, a % b];
    }
    return a || 1;
}

export function ratioLabel(video: ThisVideoDescription): string {
    const width = video.width ?? 16;
    const height = video.height ?? 9;
    const divisor = gcd(width, height);
    return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

export function formatDuration(seconds: number | undefined, decimals = false): string {
    if (seconds === undefined || !Number.isFinite(seconds)) {
        return '—';
    }
    const safe = Math.max(0, seconds);
    if (decimals) {
        const minutes = Math.floor(safe / 60);
        const rest = safe - minutes * 60;
        return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
    }
    const wholeSeconds = Math.round(safe);
    return `${Math.floor(wholeSeconds / 60)}:${String(wholeSeconds % 60).padStart(2, '0')}`;
}

export function formatClock(milliseconds: number | undefined): string {
    if (milliseconds === undefined) {
        return '—';
    }
    return formatDuration(milliseconds / 1000);
}

export function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined || !Number.isFinite(bytes)) {
        return '—';
    }
    if (bytes >= 1_000_000_000) {
        return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
    }
    return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function ExportFrame(props: {
    video: ThisVideoDescription;
    previewSlot?: boolean;
}): React.ReactNode {
    const width = props.video.width ?? 16;
    const height = props.video.height ?? 9;
    const portraitLike = width <= height;
    const style: React.CSSProperties = portraitLike
        ? { aspectRatio: `${width}/${height}`, height: '260px', width: 'auto' }
        : { aspectRatio: `${width}/${height}`, width: '100%' };
    return (
        <div className='framebox'>
            <div
                className='frame'
                style={style}
                {...(props.previewSlot ? { 'data-akari-export-preview-slot': '' } : {})}
            >
                <div className='safe' />
                <div className='safe in' />
                <span className='ratio'>{ratioLabel(props.video)}</span>
            </div>
        </div>
    );
}

export function VideoFacts(props: { video: ThisVideoDescription }): React.ReactNode {
    const video = props.video;
    const orientation = video.orientation === 'portrait' ? '縦' : video.orientation === 'square' ? '正方形' : '横';
    return (
        <div className='kv'>
            <span><b>{ratioLabel(video)}</b> {orientation}</span>
            {video.width && video.height && <span><b>{video.width} × {video.height}</b></span>}
            {video.fps && <span><b>{video.fps}</b> fps</span>}
            <span><b>{formatDuration(video.durationSeconds)}</b></span>
            {(video.cutCount !== undefined || video.captionCount !== undefined) && (
                <span>
                    {video.cutCount !== undefined && <>カット <b>{video.cutCount}</b></>}
                    {video.cutCount !== undefined && video.captionCount !== undefined && ' · '}
                    {video.captionCount !== undefined && <>テロップ <b>{video.captionCount}</b></>}
                </span>
            )}
        </div>
    );
}
