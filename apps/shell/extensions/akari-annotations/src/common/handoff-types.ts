import type { Event } from '@theia/core/lib/common';

export interface HandoffItem {
    id: string;
    kind: 'video' | 'audio' | 'image' | 'doc' | 'other' | 'scratch-image';
    origin: 'output' | 'material' | 'scratch' | 'external';
    ref?: string;
    path?: string;
    label: string;
    badges?: string[];
    thumb?: string;
    durationSeconds?: number;
    external: boolean;
    status?: 'ready' | 'pending' | 'failed';
    addedAt: string;
    isNew: boolean;
}
export interface HandoffProvider {
    readonly origin: HandoffItem['origin'];
    list(): Promise<HandoffItem[]>;
    readonly onDidChange: Event<void>;
}
