import { t } from '@akari-video/i18n';
import type { AkariPlaybook, AkariToolCheckResponse } from '../../common/akari-new-project-protocol';

export interface PlaybookSheetRow {
    key: string;
    label: string;
    summary: string;
    items: string[];
    settingPairs?: Array<[string, string]>;
}

const describe = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value);

export function playbookCategoryLabel(category: string): string {
    return t(`surfaces.home.playbookCategory.${category === 'short-drama' ? 'shortDrama' : category}.label`);
}

/** playbook.json から確認シートの固定 9 行を作る。UI やファイル操作には依存しない。 */
export function buildPlaybookSheetRows(playbook: AkariPlaybook, tools: AkariToolCheckResponse): PlaybookSheetRow[] {
    const settings = Object.entries(playbook.settings);
    const settingPairs: Array<[string, string]> = settings.slice(0, 5).map(([key, value]) => [key, describe(value)]);
    const purpose = [playbookCategoryLabel(playbook.category)];
    if (playbook.settings.aspect !== undefined) purpose.push(t('surfaces.home.playbookPurposeAspect.message', { aspect: describe(playbook.settings.aspect) }));
    if (playbook.settings.targetDurationSec !== undefined) purpose.push(t('surfaces.home.playbookPurposeDuration.message', { duration: describe(playbook.settings.targetDurationSec) }));
    const placeholders = (playbook.placeholders ?? []).map(slot => {
        const sample = slot.sample && slot.sample.source !== 'own' && slot.sample.source !== 'site';
        return `${slot.role} · ${slot.kind} · ${sample ? t('surfaces.home.playbookSampleYes.label') : t('surfaces.home.playbookSampleNo.label')}`;
    });
    const parts = (playbook.parts ?? []).map(part =>
        `${part.kind} ${part.id} · ${part.source} · ${part.license ?? '—'} · ${part.tier === 'pro' ? t('surfaces.home.playbookProRequired.label') : t('surfaces.home.playbookProNotRequired.label')}`);
    const required = [
        ...(playbook.requires?.cli ? [t('surfaces.home.playbookRequiredCli.message', { version: playbook.requires.cli })] : []),
        ...(playbook.requires?.skills ?? []).map(skill => t('surfaces.home.playbookRequiredSkill.message', { skill })),
        ...(playbook.requires?.tools ?? []).map(id => {
            const available = tools.tools.some(tool => tool.id === id && tool.available);
            return `${id} · ${available ? t('surfaces.home.playbookToolAvailable.label') : t('surfaces.home.playbookToolMissing.label')}`;
        })
    ];
    const checkpoints = playbook.steps.filter(step => step.checkpoint).length;
    return [
        { key: 'identity', label: t('surfaces.home.playbookSheetIdentity.label'), summary: playbook.name, items: [purpose.join(' · ')] },
        { key: 'depth', label: t('surfaces.home.playbookSheetDepth.label'), summary: playbook.depth === 2 ? t('surfaces.home.playbookDepthTwo.label') : t('surfaces.home.playbookDepthOne.label'), items: [] },
        { key: 'steps', label: t('surfaces.home.playbookSheetSteps.label'), summary: t('surfaces.home.playbookStepCount.message', { count: playbook.steps.length, checkpoints }), items: playbook.steps.map((step, index) => `${index + 1}. ${step.title}${step.checkpoint ? ` · ${t('surfaces.home.playbookCheckpoint.label')}` : ''} — ${step.what}`) },
        { key: 'settings', label: t('surfaces.home.playbookSheetSettings.label'), summary: t('surfaces.home.playbookSettingCount.message', { count: settings.length }), items: [], settingPairs },
        { key: 'placeholders', label: t('surfaces.home.playbookSheetPlaceholders.label'), summary: t('surfaces.home.playbookPlaceholderCount.message', { count: placeholders.length }), items: placeholders },
        { key: 'parts', label: t('surfaces.home.playbookSheetParts.label'), summary: t('surfaces.home.playbookItemCount.message', { count: parts.length }), items: parts },
        { key: 'tools', label: t('surfaces.home.playbookSheetTools.label'), summary: t('surfaces.home.playbookItemCount.message', { count: required.length }), items: required },
        { key: 'license', label: t('surfaces.home.playbookSheetLicense.label'), summary: playbook.license, items: [] },
        { key: 'provenance', label: t('surfaces.home.playbookSheetProvenance.label'), summary: String(playbook.provenance.fromProject ?? '—'), items: Object.entries(playbook.provenance).filter(([key]) => key !== 'fromProject').map(([key, value]) => `${key}: ${describe(value)}`) }
    ];
}
