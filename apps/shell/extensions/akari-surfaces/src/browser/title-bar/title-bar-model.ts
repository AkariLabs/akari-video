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

export function stageDotTitles(stages: readonly Pick<ProjectStage, 'label'>[] | undefined): string[] {
    const fallback = ['企画', '素材', '編集', '確認', '書き出し'];
    return fallback.map((label, index) => stages?.[index]?.label || label);
}

export function windowButtonGlyphs(maximized: boolean): { label: string; glyph: string; svg: string }[] {
    const svg = (shape: string): string =>
        `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${shape}</svg>`;
    return [
        { label: '最小化', glyph: '\uE921', svg: svg('<path d="M0 5h10"/>') },
        maximized
            ? { label: '元に戻す', glyph: '\uE923', svg: svg('<path d="M2.5 2.5h6v6h-6zM.5 6V.5H6"/>') }
            : { label: '最大化', glyph: '\uE922', svg: svg('<rect x=".5" y=".5" width="9" height="9"/>') },
        { label: '閉じる', glyph: '\uE8BB', svg: svg('<path d="M.5.5l9 9m0-9l-9 9"/>') }
    ];
}

export function windowButtons(os: 'mac' | 'windows' | 'other', maximized: boolean): string[] {
    return os === 'windows' ? ['最小化', maximized ? '元に戻す' : '最大化', '閉じる'] : [];
}

export function titleBarGeometry(os: 'mac' | 'windows' | 'other', fullScreen: boolean): { height: number; leadingSpace: number; opacity: number } {
    return os === 'mac'
        ? { height: fullScreen ? 30 : 40, leadingSpace: fullScreen ? 0 : 78, opacity: fullScreen ? 0.88 : 1 }
        : { height: 40, leadingSpace: 0, opacity: 1 };
}
