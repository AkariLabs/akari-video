import { t } from '@akari-video/i18n';
import type { ProjectStage } from '../home/project-progress-model';

export interface TitleBarCenterInput {
    scope: 'channel' | 'project';
    channel?: string;
    project?: string;
    standalone?: boolean;
}

export function titleBarCenter(input: TitleBarCenterInput): string[] {
    if (input.scope === 'channel') { return [input.channel || 'AKARI Video']; }
    return [input.standalone || !input.channel ? t('surfaces.titleBar.standaloneProject.label') : input.channel, input.project || t('surfaces.titleBar.titleBarCenterProject.label')];
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
    if (input.busy) { return t('surfaces.titleBar.savedChipPartnerWorking.label'); }
    return input.pending > 0 ? t('surfaces.titleBar.savedChipSaving.label') : t('surfaces.titleBar.savedChipSaved.label');
}

export type StageDot = 'done' | 'current' | 'upcoming';

export function stageDots(stages: readonly Pick<ProjectStage, 'done' | 'current'>[] | undefined): StageDot[] {
    return Array.from({ length: 5 }, (_, index) => {
        const stage = stages?.[index];
        return stage?.current ? 'current' : stage?.done ? 'done' : 'upcoming';
    });
}

export function stageDotTitles(stages: readonly Pick<ProjectStage, 'label'>[] | undefined): string[] {
    const fallback = [t('surfaces.titleBar.stageDotTitlesPlanning.label'), t('surfaces.titleBar.stageDotTitlesAssets.label'), t('surfaces.titleBar.stageDotTitlesEdit.label'), t('surfaces.titleBar.stageDotTitlesConfirmation.label'), t('surfaces.titleBar.stageDotTitlesExport.label')];
    return fallback.map((label, index) => stages?.[index]?.label || label);
}

export function windowButtonGlyphs(maximized: boolean): { label: string; glyph: string; svg: string }[] {
    const svg = (shape: string): string =>
        `<svg viewBox="0 0 10 10" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${shape}</svg>`;
    return [
        { label: t('surfaces.titleBar.windowButtonGlyphsMinimize.label'), glyph: '\uE921', svg: svg('<path d="M0 5h10"/>') },
        maximized
            ? { label: t('surfaces.titleBar.windowButtonGlyphsUndo.label'), glyph: '\uE923', svg: svg('<path d="M2.5 2.5h6v6h-6zM.5 6V.5H6"/>') }
            : { label: t('surfaces.titleBar.windowButtonGlyphsMaximize.label'), glyph: '\uE922', svg: svg('<rect x=".5" y=".5" width="9" height="9"/>') },
        { label: t('surfaces.titleBar.windowButtonGlyphsClose.label'), glyph: '\uE8BB', svg: svg('<path d="M.5.5l9 9m0-9l-9 9"/>') }
    ];
}

export function windowButtons(os: 'mac' | 'windows' | 'other', maximized: boolean): string[] {
    return os === 'windows' ? [t('surfaces.titleBar.windowButtonsMinimize.label'), maximized ? t('surfaces.titleBar.windowButtonsUndo.label') : t('surfaces.titleBar.windowButtonsMaximize.label'), t('surfaces.titleBar.windowButtonsClose.label')] : [];
}

/** ファイル・編集・ヘルプを帯に描くか。Mac は OS のメニューバーにあるので描かない。 */
export function showsMenuInTitleBar(os: 'mac' | 'windows' | 'other'): boolean {
    return os !== 'mac';
}

export function titleBarGeometry(os: 'mac' | 'windows' | 'other', fullScreen: boolean): { height: number; leadingSpace: number; opacity: number } {
    return os === 'mac'
        ? { height: fullScreen ? 30 : 40, leadingSpace: fullScreen ? 0 : 78, opacity: fullScreen ? 0.88 : 1 }
        : { height: 40, leadingSpace: 0, opacity: 1 };
}
