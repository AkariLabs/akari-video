import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { t } from '@akari-video/i18n';
import { AkariProjectStructureService } from '../../common/project-structure-protocol';
import { GRAPH_COLUMNS, GRAPH_KINDS, layoutRelations, relationEdgeKey, relationInspection, relationPath, ManifestCheck, ProjectManifest } from '../../common/project-structure-model';

const colors = ['#4a9b99', '#a886d9', '#c79550', '#7199cf', '#ca7990', '#8daf70', '#a0a5ac', '#777', '#777'];
const kindColor = (kind: string): string => {
    const index = GRAPH_KINDS.indexOf(kind as typeof GRAPH_KINDS[number]);
    return colors[index < 0 ? colors.length - 1 : index];
};
export function RelationsView({ root, service, onOpenScene, onError, onSync }: {
    root: URI; service: AkariProjectStructureService; onOpenScene(uri: URI): void; onError(message: string): void; onSync(): void;
}): React.ReactElement {
    const [manifest, setManifest] = React.useState<ProjectManifest | undefined>();
    const [check, setCheck] = React.useState<ManifestCheck | undefined>();
    const [selected, setSelected] = React.useState<string>();
    const [loading, setLoading] = React.useState(false);
    React.useEffect(() => {
        let active = true;
        void Promise.all([service.readManifest(root.toString()), service.readCheck(root.toString())]).then(([m, c]) => {
            if (active) { setManifest(m); setCheck(c); }
        }).catch(error => { if (active) onError(String(error)); });
        return () => { active = false; };
    }, [root.toString(), service]);
    const sync = async (): Promise<void> => {
        setLoading(true);
        try {
            setManifest(await service.sync(root.toString()));
            setCheck(await service.readCheck(root.toString()));
            onSync();
        }
        catch (error) { onError(String(error)); }
        finally { setLoading(false); }
    };
    if (!manifest) return <div data-akari-relations-empty='true'>{t('surfaces.structure.noRelations.message')}
        <button type='button' disabled={loading} onClick={() => void sync()}>{t('surfaces.structure.sync.button')}</button></div>;
    const graph = layoutRelations(manifest.nodes, manifest.edges);
    const { badNodes, badEdges } = relationInspection(check, graph.nodes);
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const selectedNode = nodeById.get(selected || '');
    const neighbors = new Set([selected, ...manifest.edges.filter(edge => edge.from === selected).map(edge => edge.uses),
        ...manifest.edges.filter(edge => edge.uses === selected).map(edge => edge.from)]);
    const outgoing = manifest.edges.filter(edge => edge.from === selected).map(edge => edge.uses);
    const incoming = manifest.edges.filter(edge => edge.uses === selected).map(edge => edge.from);
    return <div data-akari-relations='true' style={{ display: 'grid', gap: 12 }}>
        <div className='akari-os-relation-legend' style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
            {GRAPH_KINDS.map((kind, i) => <span key={kind} style={{ display: 'inline-flex', gap: 5, alignItems: 'center', padding: '2px 7px',
                border: '1px solid var(--theia-widget-border)', borderRadius: 999 }}>
                <i style={{ width: 8, height: 8, borderRadius: '50%', background: colors[i] }} />
                {kind === 'other' ? t('surfaces.structure.other.label') : kind}</span>)}
            <span style={{ marginLeft: 'auto', color: 'var(--theia-descriptionForeground)' }}>{t('surfaces.structure.missingNode.label')} = ⋯</span>
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid var(--theia-widget-border)', borderRadius: 8 }}>
            <svg viewBox={`0 0 ${graph.width} ${graph.height}`} width={graph.width} height={graph.height} role='img'
                aria-label={t('surfaces.structure.relations.label')}>
                <defs>
                    <marker id='akari-relations-arrow' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='6' markerHeight='6' orient='auto'>
                        <path d='M0 0 L10 5 L0 10 z' fill='currentColor' /></marker>
                    <marker id='akari-relations-arrow-bad' viewBox='0 0 10 10' refX='9' refY='5' markerWidth='6' markerHeight='6' orient='auto'>
                        <path d='M0 0 L10 5 L0 10 z' fill='#cf9250' /></marker>
                </defs>
                {graph.columns.map(({ column, x }) => <text key={column} x={x - 70} y={20} fill='currentColor' fontSize='12'>
                    {GRAPH_COLUMNS[column].map(kind => kind === 'other' ? t('surfaces.structure.other.label') : kind).join(' / ')}
                </text>)}
                {graph.edges.map((edge, i) => {
                    const from = nodeById.get(edge.from)!; const to = nodeById.get(edge.uses)!;
                    const highlighted = selected && (edge.from === selected || edge.uses === selected);
                    const bad = badEdges.has(relationEdgeKey(edge));
                    return <path key={`${edge.from}:${edge.uses}:${i}`} d={relationPath(from, to)}
                        data-akari-relation-edge={`${edge.from}→${edge.uses}`} data-akari-relation-bad={bad ? 'true' : undefined}
                        fill='none' stroke={bad ? '#cf9250' : highlighted ? '#50c2bb' : 'currentColor'}
                        strokeWidth={highlighted ? 2.5 : 1.5} opacity={selected && !highlighted ? 0.14 : bad ? 1 : 0.55}
                        strokeDasharray={bad ? '5 4' : undefined}
                        markerEnd={`url(#akari-relations-arrow${bad ? '-bad' : ''})`} />;
                })}
                {graph.nodes.map(node => <g key={node.id} transform={`translate(${node.x - 70},${node.y})`}
                    data-akari-relation-node={node.id} role='button' tabIndex={0} aria-label={node.id}
                    data-akari-relation-bad={badNodes.has(node.id) ? 'true' : undefined}
                    data-akari-relation-missing={node.missing ? 'true' : undefined}
                    onClick={() => setSelected(node.id === selected ? undefined : node.id)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setSelected(node.id === selected ? undefined : node.id); }}
                    style={{ cursor: 'pointer', opacity: selected && !neighbors.has(node.id) ? 0.25 : 1 }}>
                    <rect width='140' height='36' rx='6' fill='var(--theia-editorWidget-background)' stroke={badNodes.has(node.id) ? '#cf9250' : kindColor(node.kind)}
                        strokeWidth={node.id === selected ? 2.5 : 1.5} strokeDasharray={badNodes.has(node.id) ? '5 4' : undefined} />
                    <rect width='4' height='36' rx='2' fill={kindColor(node.kind)} />
                    <text x='10' y='15' fill='currentColor' fontSize='11'>
                        {String(node.name ?? node.id).length > 20 ? `${String(node.name ?? node.id).slice(0, 18)}…` : String(node.name ?? node.id)}</text>
                    <text x='10' y='29' fill={node.missing ? '#cf9250' : 'var(--theia-descriptionForeground)'} fontSize='9'>
                        {node.column === GRAPH_COLUMNS.length - 1 ? t('surfaces.structure.other.label') : node.kind}
                        {node.missing ? ` · ${t('surfaces.structure.missingNode.label')}` : ` · rev ${node.rev ?? 0}`}</text>
                </g>)}
            </svg>
        </div>
        {selectedNode && <div data-akari-relation-card='true' style={{ padding: 14, border: '1px solid var(--theia-widget-border)', borderRadius: 8 }}>
            <b>{selectedNode.id}</b><div>{selectedNode.kind} · {selectedNode.missing ? t('surfaces.structure.missingNode.label') : `rev ${selectedNode.rev ?? 0}`}</div>
            <div>where: {selectedNode.where ?? '—'}</div><div>source: {selectedNode.source ?? '—'}</div>
            <div>{t('surfaces.structure.uses.label')}: {outgoing.join(' · ') || '—'}</div>
            <div>{t('surfaces.structure.usedBy.label')}: {incoming.join(' · ') || '—'}</div>
            {selectedNode.kind === 'scene' && /^scenes\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selectedNode.where ?? '') &&
                <button type='button' onClick={() => onOpenScene(root.resolve(selectedNode.where!))}>{t('surfaces.home.sceneOpen.button')}</button>}
        </div>}
    </div>;
}
