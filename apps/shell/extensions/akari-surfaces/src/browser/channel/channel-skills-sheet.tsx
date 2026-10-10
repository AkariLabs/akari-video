import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { ChannelSkillDraft, validateSkillSlug } from './channel-skills-model';
import { proGate } from '../../common/pro-key';
import { PRO_FEATURE_PRESET_SKILL } from './channel-pro-sheet';

export interface ChannelSkillRow { slug: string; title: string; description: string; copiedFrom?: string }

export function ChannelSkillsSheet(props: {
    skills: ChannelSkillRow[];
    presets: readonly ChannelSkillDraft[];
    akariSkills: { name: string; description: string }[];
    onAddPreset: (draft: ChannelSkillDraft) => void;
    hasProKey: boolean;
    onNeedPro: (feature: string) => void;
    onCreate: (draft: ChannelSkillDraft) => void;
    onCopyAkari: (name: string) => void;
    onOpen: (slug: string) => void;
    onRemove: (slug: string) => void;
    onClose: () => void;
}): React.ReactElement {
    const [mode, setMode] = React.useState<'preset' | 'create' | 'copy'>('preset');
    const [slug, setSlug] = React.useState('');
    const [title, setTitle] = React.useState('');
    const [description, setDescription] = React.useState('');
    const [steps, setSteps] = React.useState('');
    const slugError = validateSkillSlug(slug);
    const existing = new Set(props.skills.map(skill => skill.slug));
    const save = (): void => {
        if (slugError || !title.trim() || existing.has(slug)) return;
        props.onCreate({ slug, title: title.trim(), description: description.trim(), steps: steps.trim(), reads: [] });
        setSlug(''); setTitle(''); setDescription(''); setSteps('');
    };
    return <HomeScrim kind='channel-skills' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}</style>
        <h3>{t('surfaces.channel.channelSkillsSheetSkill.heading')}</h3>
        <p>{t('surfaces.channel.channelSkillsSheetSkillChannelAmongPartnersCallThemName.description')}</p>
        <div className='akari-channel-skills-list'>
            {props.skills.length === 0 && <p>{t('surfaces.channel.channelSkillsSheetYetAddButtonBelow.message')}</p>}
            {props.skills.map(skill => <div className='akari-channel-skill-row' data-akari-channel-skill={skill.slug} key={skill.slug}>
                <div className='akari-channel-skill-body'><div className='akari-channel-skill-heading'><code>/{skill.slug}</code><b>{skill.title}</b>
                    {skill.copiedFrom && <small>{t('surfaces.channel.skillCopySourcePrefix.label')}{skill.copiedFrom}</small>}</div>
                    <div className='akari-channel-skill-description'>{skill.description}</div></div>
                <div className='akari-channel-skill-actions'><button type='button' className='theia-button secondary' onClick={() => props.onOpen(skill.slug)}>{t('surfaces.channel.channelSkillsSheetOpenSkillMd.button')}</button>
                    <button type='button' className='akari-channel-skill-remove' aria-label={t('surfaces.channel.channelSkillsSheetDelete.message', { skillTitle: skill.title })} onClick={() => props.onRemove(skill.slug)}>×</button></div>
            </div>)}
        </div>
        <div className='akari-channel-skills-modes' data-akari-skills-mode={mode}>
            <button type='button' className='theia-button secondary' data-akari-skills-add-preset aria-pressed={mode === 'preset'} onClick={() => setMode('preset')}>{t('surfaces.channel.channelSkillsSheetAddPreparedItems.button')}</button>
            <button type='button' className='theia-button secondary' data-akari-skills-create aria-pressed={mode === 'create'} onClick={() => setMode('create')}>{t('surfaces.channel.channelSkillsSheetMakeYourself.button')}</button>
            <button type='button' className='theia-button secondary' data-akari-skills-copy aria-pressed={mode === 'copy'} onClick={() => setMode('copy')}>{t('surfaces.channel.channelSkillsSheetCopyAkarisSkills.button')}</button>
        </div>
        {mode === 'preset' && <div className='akari-channel-skills-options'>
            {props.presets.map(draft => <div className='akari-channel-skill-option' data-akari-skills-preset={draft.slug} key={draft.slug}>
                <div><code>☆ /{draft.slug}</code><b>{draft.title}</b><span>{draft.description}</span><small>{t('surfaces.channel.skillReads.label', { files: draft.reads.join(t('surfaces.channel.channelSkillsSheetList.separator')) })}</small></div>
                <button type='button' className='theia-button secondary' disabled={existing.has(draft.slug)} onClick={() => {
                    if (!proGate('pro', props.hasProKey)) props.onNeedPro(PRO_FEATURE_PRESET_SKILL);
                    else props.onAddPreset(draft);
                }}>{existing.has(draft.slug) ? t('surfaces.channel.channelSkillsSheetAdding.label') : t('surfaces.channel.channelSkillsSheetAdd.label')}</button>
            </div>)}
        </div>}
        {mode === 'create' && <div className='akari-channel-skills-form'>
            <label>{t('surfaces.channel.channelSkillsSheetNickname.label')}<input type='text' data-akari-skills-slug value={slug} onChange={event => setSlug(event.currentTarget.value)} /></label>
            {slugError && <small className='akari-channel-skills-error' data-akari-skills-slug-error>{slugError}</small>}
            <label>{t('surfaces.channel.channelSkillsSheetDisplayName.label')}<input type='text' value={title} onChange={event => setTitle(event.currentTarget.value)} /></label>
            <label>{t('surfaces.channel.channelSkillsSheetExplanation.label')}<input type='text' value={description} onChange={event => setDescription(event.currentTarget.value)} /></label>
            <label>{t('surfaces.channel.channelSkillsSheetProcedure.label')}<textarea rows={5} value={steps} onChange={event => setSteps(event.currentTarget.value)} /></label>
            <button type='button' className='theia-button main' data-akari-skills-save disabled={!!slugError || !title.trim() || existing.has(slug)} onClick={save}>{t('surfaces.channel.channelSkillsSheetSave.button')}</button>
        </div>}
        {mode === 'copy' && <div className='akari-channel-skills-options'>
            {props.akariSkills.length === 0 && <p>{t('surfaces.channel.channelSkillsSheetNoSkillsFoundCurrentlyOpenProject.message')}</p>}
            {props.akariSkills.map(skill => <div className='akari-channel-skill-option' key={skill.name}>
                <div><code>/{skill.name}</code><span>{skill.description.split(/\r?\n/)[0]}</span></div>
                <button type='button' className='theia-button secondary' data-akari-skills-copy-source={skill.name}
                    disabled={existing.has(`my-${skill.name}`)} onClick={() => props.onCopyAkari(skill.name)}>{existing.has(`my-${skill.name}`) ? t('surfaces.channel.channelSkillsSheetCopying.label') : t('surfaces.channel.skillCopy.button')}</button>
            </div>)}
        </div>}
    </HomeScrim>;
}
