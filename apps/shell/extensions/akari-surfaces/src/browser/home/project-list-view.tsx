import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { ProjectPresence, stageSummary } from './project-progress-model';
import type { ProjectListRow } from '../akari-home-widget';
import { VisibleCardGrid, visibleCardGridCss } from './visible-card-grid';

interface CachedProjectCard {
    version: number | undefined;
    badge?: string;
    thumbnail?: string;
    pending?: Promise<void>;
    complete: boolean;
}

const projectCardCache = new Map<string, CachedProjectCard>();

export function isProjectCardSettled(row: ProjectListRow, version: number | undefined): boolean {
    const cached = projectCardCache.get(row.uri.toString());
    return !!cached?.complete && cached.version === version;
}

export interface ProjectListViewProps {
    channel: string;
    active: boolean;
    rowVersion?: (uri: URI) => number;
    rows: ProjectListRow[];
    standalone: ProjectListRow[];
    currentName?: string;
    onNew: (rect: DOMRect) => void;
    onNewStandalone: () => void;
    onRefresh: () => void;
    onOpenChannel: () => void;
    onOpen: (row: ProjectListRow, rect: DOMRect) => void;
    readPresence: (uri: URI) => Promise<ProjectPresence>;
    loadThumbnails: (uri: URI) => Promise<string[]>;
}

export function ProjectCard(props: Pick<ProjectListViewProps, 'onOpen' | 'readPresence' | 'loadThumbnails' | 'active'> & { row: ProjectListRow; compact?: boolean; rowVersion?: number; onSettled?: () => void }): React.ReactElement {
    const { row } = props;
    const initial = projectCardCache.get(row.uri.toString());
    const [badge, setBadge] = React.useState<string | undefined>(initial?.version === props.rowVersion ? initial.badge : undefined);
    const [thumbnail, setThumbnail] = React.useState<string | undefined>(initial?.version === props.rowVersion ? initial.thumbnail : undefined);
    const [settled, setSettled] = React.useState(initial?.version === props.rowVersion && initial.complete === true);
    React.useEffect(() => {
        if (!props.active) return;
        let active = true;
        const key = row.uri.toString();
        let cached = projectCardCache.get(key);
        if (!cached || cached.version !== props.rowVersion) {
            cached = { version: props.rowVersion, complete: false };
            projectCardCache.set(key, cached);
        }
        const entry = cached;
        setBadge(entry.badge); setThumbnail(entry.thumbnail);
        setSettled(entry.complete);
        if (!entry.complete && !entry.pending) {
            entry.pending = Promise.all([
                props.readPresence(row.uri).then(presence => {
                    entry.badge = stageSummary(presence);
                    if (active) setBadge(entry.badge);
                }).catch(() => undefined),
                props.loadThumbnails(row.uri).then(frames => {
                    entry.thumbnail = frames[0];
                    if (active) setThumbnail(entry.thumbnail);
                }).catch(() => undefined)
            ]).then(() => { entry.complete = true; entry.pending = undefined; });
        }
        void entry.pending?.then(() => { if (active) { setBadge(entry.badge); setThumbnail(entry.thumbnail); setSettled(true); } });
        return () => { active = false; };
    }, [row.key, row.uri.toString(), props.rowVersion, props.active]);
    React.useEffect(() => { if (settled) props.onSettled?.(); }, [settled, props.onSettled]);
    return <button type='button' className={`akari-os-card${props.compact ? ' compact' : ''}`}
        data-akari-project-card='true' aria-current={row.current ? 'true' : undefined}
        onClick={event => { if (!row.current) props.onOpen(row, event.currentTarget.getBoundingClientRect()); }}>
        <span className='akari-os-thumb'>{thumbnail
            ? <img src={thumbnail} alt='' /> : <span className='codicon codicon-device-camera-video' aria-hidden='true' />}</span>
        <span className='akari-os-card-body'><b>{row.name}</b><small>{row.current ? '開いています · ' : ''}{row.updatedAt ? new Date(row.updatedAt).toLocaleString('ja-JP') : '更新日なし'}</small>
            {badge && <span className='akari-os-stage'>{badge}</span>}</span>
    </button>;
}

export function ProjectListView(props: ProjectListViewProps): React.ReactElement {
    const rows = [...props.rows].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return <div className='akari-os-list-view'>
        {props.currentName && <p className='akari-os-note'>{props.channel} のプロジェクトです。押すと、開くか確かめます（いま開いている「{props.currentName}」はそのまま）。</p>}
        <div className='akari-os-list-actions'>
            <button type='button' className='theia-button main' onClick={event => props.onNew(event.currentTarget.getBoundingClientRect())}>＋ 新しいプロジェクトを始める</button>
            {!props.currentName && <span>名前は日時が先に入ります。あとで変えられます</span>}
            <button type='button' className='akari-os-link' data-akari-new-standalone='true' onClick={props.onNewStandalone}>チャンネルに入れずに作る…</button>
        </div>
        <section>
            <div className='akari-os-section-heading'><h3>チャンネル「{props.channel}」のプロジェクト</h3><small>{rows.length} 本 · 新しい順</small>
                <button type='button' className='theia-button secondary' onClick={props.onOpenChannel}>チャンネルを開く</button>
                <button type='button' className='theia-button secondary' disabled={false} onClick={props.onRefresh}>更新</button></div>
            {rows.length ? <VisibleCardGrid rows={rows} rowKey={row => row.key} rowLabel={row => row.name} className='akari-os-card-grid' initialHeight={183}
                isSettled={row => isProjectCardSettled(row, props.rowVersion?.(row.uri))}
                renderCard={(row, onSettled) => <ProjectCard row={row} rowVersion={props.rowVersion?.(row.uri)} active={props.active} onSettled={onSettled}
                    onOpen={props.onOpen} readPresence={props.readPresence} loadThumbnails={props.loadThumbnails} />} />
                : <p className='akari-os-note'>まだプロジェクトがありません。</p>}
        </section>
        {!!props.standalone.length && <section><div className='akari-os-section-heading'><h3>ほかの場所のプロジェクト</h3></div>
            <VisibleCardGrid rows={props.standalone} rowKey={row => row.key} rowLabel={row => row.name} className='akari-os-card-grid akari-os-compact-grid' initialHeight={69}
                isSettled={row => isProjectCardSettled(row, props.rowVersion?.(row.uri))}
                renderCard={(row, onSettled) => <ProjectCard row={row} compact rowVersion={props.rowVersion?.(row.uri)} active={props.active} onSettled={onSettled}
                    onOpen={props.onOpen} readPresence={props.readPresence} loadThumbnails={props.loadThumbnails} />} /></section>}
    </div>;
}

export const projectListCss = `
.akari-os-list-view{display:flex;flex-direction:column;gap:18px;max-width:1100px;margin:auto}
.akari-os-list-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;color:var(--theia-descriptionForeground);font-size:12px}
.akari-os-link{background:none;border:0;padding:0;color:var(--theia-textLink-foreground);font-size:12px;cursor:pointer;text-decoration:underline}
.akari-os-section-heading{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;row-gap:6px;margin-bottom:8px}
.akari-os-section-heading h3{margin:0;font-size:14px;font-weight:800}
.akari-os-section-heading small{color:var(--theia-descriptionForeground)}
.akari-os-section-heading button{white-space:nowrap}
.akari-os-section-heading button:first-of-type{margin-left:auto}
.akari-os-note{font-size:12px;color:var(--theia-descriptionForeground);margin:0}
.akari-os-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
${visibleCardGridCss}
.akari-os-card{display:flex;flex-direction:column;min-width:0;padding:0;text-align:left;border:0;border-radius:10px;overflow:hidden;background:var(--theia-editorWidget-background);color:var(--theia-foreground);cursor:pointer}
.akari-os-card:hover,.akari-os-card:focus-visible{outline:2px solid var(--theia-focusBorder);outline-offset:1px}
.akari-os-thumb{display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:16/9;background:var(--theia-editor-background);color:var(--theia-descriptionForeground)}
.akari-os-thumb img{width:100%;height:100%;object-fit:cover}
.akari-os-card-body{display:flex;flex-direction:column;gap:4px;padding:7px 9px 9px;min-width:0}
.akari-os-card-body b{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.akari-os-card-body small{color:var(--theia-descriptionForeground);font-size:10.5px}
.akari-os-stage{align-self:flex-start;border-radius:999px;padding:2px 8px;background:var(--theia-button-secondaryBackground);color:var(--theia-button-secondaryForeground);font-size:10px;font-weight:700}
.akari-os-card.compact{display:grid;grid-template-columns:70px minmax(0,1fr);align-items:center}
.akari-os-card.compact .akari-os-thumb{height:100%}
`;
