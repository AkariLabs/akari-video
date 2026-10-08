import type { ProjectStage } from '../home/project-progress-model';

export interface TitleBarCenterInput {
    scope: 'channel' | 'project';
    channel?: string;
    project?: string;
    standalone?: boolean;
}

export function titleBarCenter(input: TitleBarCenterInput): string[] {
    if (input.scope === 'channel') { return [input.channel || 'AKARI Video']; }
    return [input.standalone || !input.channel ? '単体' : input.channel, input.project || 'プロジェクト'];
}

export function channelFromRelativePath(relative: string | undefined): string | undefined {
    const segments = relative?.split('/');
    return segments?.length === 4 && segments[0] === 'channels' && segments[2] === 'videos' && !!segments[1]
        ? segments[1] : undefined;
}

export function shouldRerenderOnContextKeys(affects: (keys: Set<string>) => boolean): boolean {
    return affects(new Set(['akari.partner.busy']));
}

export function savedChip(input: { pending: number; busy: boolean }): string {
    if (input.busy) { return 'パートナー作業中'; }
    return input.pending > 0 ? '保存中…' : '保存済み';
}

export type StageDot = 'done' | 'current' | 'upcoming';

export function stageDots(stages: readonly Pick<ProjectStage, 'done' | 'current'>[] | undefined): StageDot[] {
    return Array.from({ length: 5 }, (_, index) => {
        const stage = stages?.[index];
        return stage?.current ? 'current' : stage?.done ? 'done' : 'upcoming';
    });
}

export function windowButtons(os: 'mac' | 'windows' | 'other', maximized: boolean): string[] {
    return os === 'windows' ? ['最小化', maximized ? '元に戻す' : '最大化', '閉じる'] : [];
}

export function titleBarGeometry(os: 'mac' | 'windows' | 'other', fullScreen: boolean): { height: number; leadingSpace: number; opacity: number } {
    return os === 'mac'
        ? { height: fullScreen ? 30 : 40, leadingSpace: fullScreen ? 0 : 78, opacity: fullScreen ? 0.88 : 1 }
        : { height: 40, leadingSpace: 0, opacity: 1 };
}
