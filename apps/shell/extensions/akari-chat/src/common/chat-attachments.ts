export type ChatAttachment =
    | { kind: 'file'; path: string; label: string }
    | { kind: 'review'; label: string; review: ChatReviewMark };

export interface ChatReviewMark {
    tool: 'pen' | 'pin' | 'range';
    source: string;
    sourceLabel: string;
    time: number;
    timeEnd?: number;
    shape?: { x: number; y: number; w?: number; h?: number };
    elements?: string[];
    text: string;
    thumbnail?: string;
}
