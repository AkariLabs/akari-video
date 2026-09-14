export interface WorldStopInstruction {
    kind: 'world'; world: { id: string; label: string };
    stop: { id: string; at: number; leave: number };
}
export interface WorldEdgeInstruction {
    kind: 'world'; world: { id: string; label: string };
    edge: { id: string; from: string; to: string; type: string; transition?: { kind?: string; cover?: number | null } };
}

export function worldInstructionCopy(selection: WorldStopInstruction | WorldEdgeInstruction): string {
    if ('stop' in selection) {
        const { world, stop } = selection;
        return `ワールド「${world.label}」の停留所「${stop.id}」（${stop.at} s 〜 ${stop.leave} s）を調整してください。\n対象: planning/world-map.json の cameraStops[id="${stop.id}"]`;
    }
    const { world, edge } = selection;
    return `ワールド「${world.label}」の辺「${edge.id}」（${edge.from} → ${edge.to}・${edge.type}・transition ${edge.transition?.kind ?? 'none'}・cover ${edge.transition?.cover ?? '-'} s）を調整してください。\n対象: planning/world-map.json の edges[id="${edge.id}"]`;
}
