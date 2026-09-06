export interface AdjustPreviewSection {
    id: string;
    label: string;
    build: () => HTMLElement;
}

export const ADJUST_PREVIEW_SECTIONS: readonly AdjustPreviewSection[] = [];
