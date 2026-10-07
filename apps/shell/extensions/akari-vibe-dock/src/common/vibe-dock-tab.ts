import { Disposable, Event } from '@theia/core/lib/common';
import { AkariEarClient } from './ear-protocol';

export type EarClient = AkariEarClient;

export interface PointedTarget {
    target: string;
    label: string;
    at: number; // epoch ms
    source: 'dom' | 'preview';
}

export interface VibeDockTabContribution {
    readonly id: 'now' | 'next' | 'handoff' | 'canvas' | 'settings' | string;
    readonly label: string;
    readonly icon: string;
    readonly order: number;
    badge?(): { count: number; tone?: 'info' | 'warn' } | undefined;
    isAvailable?(): boolean;
    render(host: HTMLElement, ctx: VibeDockContext): Disposable;
}

export interface VibeDockContext {
    readonly ear: EarClient;
    readonly status: { set(line: string, tone?: 'info' | 'warn' | 'error'): Disposable };
    readonly pointed: Event<PointedTarget | undefined>;
    readonly layout: { expanded: boolean; requestExpand(on: boolean): void };
    readonly project: { rootUri: string; reviewUri: string; editUri: string } | undefined;
}
