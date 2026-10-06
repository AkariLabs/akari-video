import { captionPanelFontWrite, type CaptionPanel } from '../../common/caption-panel-state';
import { captionIdForTreeSelection, type InspectorWriteRequest, type TimelineCaptionSelection,
    type TimelineSelectionSnapshot } from '../timeline-selection-model';

export interface CaptionPanelSelection {
    primaryId: string;
    ids: readonly string[];
    primaryCaption?: TimelineCaptionSelection;
    multi: boolean;
}

export function captionPanelSelection(snapshot: TimelineSelectionSnapshot,
    selectedCaptionIds: readonly string[], panel: CaptionPanel): CaptionPanelSelection | undefined {
    if (!snapshot) return undefined;
    if (snapshot.kind === 'caption') return { primaryId: snapshot.id, ids: [snapshot.id],
        primaryCaption: snapshot, multi: false };
    if (snapshot.kind === 'item' && snapshot.itemKind === 'caption') {
        const id = selectedCaptionIds[0] ?? captionIdForTreeSelection(snapshot);
        return id ? { primaryId: id, ids: [id], multi: false } : undefined;
    }
    if (snapshot.kind !== 'multi' || panel !== 'font') return undefined;
    const captions = snapshot.items.filter((item): item is TimelineCaptionSelection => item.kind === 'caption');
    const ids = [...new Set([...captions.map(item => item.id), ...snapshot.items.flatMap(item =>
        item.kind === 'item' && item.itemKind === 'caption'
            ? captionIdForTreeSelection(item) ?? [] : [])])];
    if (!ids.length) return undefined;
    return { primaryId: ids[0], ids, primaryCaption: captions.find(item => item.id === ids[0]), multi: true };
}

export function captionPanelFontRequest(selection: CaptionPanelSelection,
    family: string, weight?: number): InspectorWriteRequest {
    const request = captionPanelFontWrite(selection.primaryId, family, weight);
    return selection.multi ? { ...request, targets: selection.ids.map(id => ({ kind: 'caption', id })) } : request;
}
