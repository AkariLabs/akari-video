export interface ManifestNode { id: string; kind: string; rev?: number; where?: string; source?: string; [key: string]: unknown }
export interface ManifestEdge { from: string; uses: string; note?: string }
export interface ProjectManifest { project?: { name?: string }; nodes: ManifestNode[]; edges: ManifestEdge[] }
export interface ManifestFinding { code: string; severity: string; node?: string; edge?: ManifestEdge; message?: string }
export interface ManifestCheck { summary?: { error?: number; warning?: number }; findings?: ManifestFinding[] }
export interface SceneEditInput { id: string; title: string; edit?: unknown; editMtime?: number; exportMtimes?: number[]; captions?: boolean }
export interface CutRow { id: string; order: number; duration?: number; asset: string; placeholder: boolean }
export interface SceneTreeRow { id: string; title: string; unreadable: boolean; duration?: number; placeholders: number; captions: boolean; exported: boolean; cuts: CutRow[] }
export interface StructureTree { name: string; scenes: SceneTreeRow[] }

const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const list = (value: unknown): any[] => Array.isArray(value) ? value : [];

/** Only visual timeline items are cuts; audio, overlays and captions are not. */
export function buildStructureTree(name: string, scenes: SceneEditInput[]): StructureTree {
    return { name, scenes: scenes.map(scene => {
        const edit = record(scene.edit);
        const fps = Number(record(edit.output).fps) || 30;
        const tracks = list(edit.tracks).filter(track => record(track).lane === 'visual');
        const items = tracks.length ? tracks.flatMap(track => list(record(track).items)).sort((a, b) => (Number(record(a).at) || 0) - (Number(record(b).at) || 0))
            : list(edit.clips).length ? list(edit.clips) : list(record(edit.timeline).clips).length ? list(record(edit.timeline).clips) : list(edit.cuts);
        const sources = new Map(list(edit.sources).map(source => [String(record(source).id), String(record(source).path ?? record(source).name ?? record(source).id)]));
        const cuts = items.map((item, index) => {
            const value = record(item);
            const source = record(value.source);
            const src = String(source.src ?? value.src ?? '');
            return { id: String(value.id ?? index + 1), order: index + 1,
                duration: typeof value.duration === 'number' ? value.duration / fps : typeof value.duration_s === 'number' ? value.duration_s : undefined,
                asset: sources.get(src) ?? String(source.path ?? (src || '—')), placeholder: record(source.canvas).origin === 'plan' } as CutRow;
        });
        const duration = typeof edit.duration_s === 'number' ? edit.duration_s
            : tracks.length ? items.reduce((max, item) => Math.max(max, ((Number(record(item).at) || 0) + (Number(record(item).duration) || 0)) / fps), 0)
                : cuts.reduce((sum, cut) => sum + (cut.duration ?? 0), 0);
        return { id: scene.id, title: scene.title, unreadable: scene.edit === undefined,
            duration: scene.edit === undefined ? undefined : duration, placeholders: cuts.filter(cut => cut.placeholder).length,
            captions: !!scene.captions || list(edit.captions).length > 0,
            exported: !!scene.editMtime && (scene.exportMtimes ?? []).some(mtime => mtime > scene.editMtime!), cuts };
    }) };
}

export const GRAPH_KINDS = ['scene', 'person', 'world', 'asset', 'style', 'tool-output', 'doc', 'other'] as const;
export interface PositionedNode extends ManifestNode { column: number; x: number; y: number; missing?: boolean }
const graphColumn = (kind: string): number => {
    const index = GRAPH_KINDS.indexOf(kind as typeof GRAPH_KINDS[number]);
    return index < 0 ? GRAPH_KINDS.length - 1 : index;
};
const inferredKind = (id: string): string => {
    const prefix = id.split(':', 1)[0];
    return prefix === 'tool' ? 'tool-output' : prefix;
};
export function layoutRelations(nodes: ManifestNode[], edges: ManifestEdge[]): { nodes: PositionedNode[]; edges: ManifestEdge[]; width: number; height: number } {
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const edge of edges) for (const id of [edge.from, edge.uses]) {
        if (!byId.has(id)) byId.set(id, { id, kind: inferredKind(id) });
    }
    const positioned = [...byId.values()].map(node => ({ ...node, missing: !nodes.some(known => known.id === node.id),
        column: graphColumn(node.kind), x: 0, y: 0 })).sort((a, b) => a.column - b.column || a.id.localeCompare(b.id));
    const counts = Array(8).fill(0);
    for (const node of positioned) { node.x = 90 + node.column * 190; node.y = 48 + counts[node.column]++ * 64; }
    return { nodes: positioned, edges,
        width: 1530, height: Math.max(280, 48 + (Math.max(...counts) - 1) * 64 + 220) };
}

export function relationEndpoints(from: PositionedNode, to: PositionedNode): { x1: number; y1: number; x2: number; y2: number } {
    const direction = to.x < from.x ? -1 : 1;
    return { x1: from.x + direction * 70, y1: from.y + 18, x2: to.x - direction * 70, y2: to.y + 18 };
}

export function relationPath(from: PositionedNode, to: PositionedNode): string {
    const { x1, y1, x2, y2 } = relationEndpoints(from, to);
    const middle = (x1 + x2) / 2;
    const bulge = Math.abs(from.column - to.column) >= 2 ? 100 + 10 * Math.abs(from.column - to.column) : 0;
    return `M${x1} ${y1} C${middle} ${y1 + bulge},${middle} ${y2 + bulge},${x2} ${y2}`;
}

export interface ProjectStructureVisibility { sceneFolder: boolean; hasScenes: boolean; hasRootEdit: boolean }
export function showsSceneTabs(input: ProjectStructureVisibility): boolean {
    return !input.sceneFolder && input.hasScenes && !input.hasRootEdit;
}
export function showsInspectionBand(input: ProjectStructureVisibility): boolean {
    return input.sceneFolder || showsSceneTabs(input);
}

export function inspectionCounts(check: ManifestCheck | undefined): {
    error: number; warning: number; missing: number; broken: number; unacquired: number; otherWarning: number; affected: Set<string>
} {
    const findings = check?.findings ?? [];
    const error = findings.filter(finding => finding.severity === 'error').length;
    const warning = findings.filter(finding => finding.severity === 'warning').length;
    const missing = findings.filter(finding => finding.severity === 'error' && ['MISSING_NODE', 'MISSING_WHERE', 'INVALID_WHERE'].includes(finding.code)).length;
    const broken = error - missing;
    const unacquired = findings.filter(finding => finding.severity === 'warning' && finding.code === 'UNACQUIRED').length;
    const otherWarning = warning - unacquired;
    const affected = new Set<string>();
    for (const finding of findings) {
        if (finding.node) affected.add(finding.node);
        if (finding.edge) { affected.add(finding.edge.from); affected.add(finding.edge.uses); }
    }
    return { error, warning, missing, broken, unacquired, otherWarning, affected };
}

export function inspectionLabel(counts: ReturnType<typeof inspectionCounts>,
    translate: (key: string, params?: { count: number; n: number }) => string): string {
    return [
        counts.missing && translate('surfaces.structure.missing.label', { count: counts.missing, n: counts.missing }),
        counts.broken && translate('surfaces.structure.broken.label', { count: counts.broken, n: counts.broken }),
        counts.unacquired && translate('surfaces.structure.unacquired.label', { count: counts.unacquired, n: counts.unacquired }),
        counts.otherWarning && translate('surfaces.structure.otherWarnings.label', { count: counts.otherWarning, n: counts.otherWarning })
    ].filter(Boolean).join(translate('surfaces.structure.separator.label'));
}
