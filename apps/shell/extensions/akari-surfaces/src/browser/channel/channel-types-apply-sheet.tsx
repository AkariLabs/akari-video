import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { ApplyChoices, ApplyInputs, channelMdHasBody, countNewRules, countNewWords, defaultChoices, designMdHasBody, parseNotes, parseWordBook } from './channel-types-apply';
import { ChannelTypeEntry, typeContents } from './channel-types-model';

export function ChannelTypeApplySheet(props: {
    type: ChannelTypeEntry; channelName: string; inputs: ApplyInputs; onApply: (choices: ApplyChoices) => void;
    onBack: () => void; onClose: () => void;
}): React.ReactElement {
    const contents = typeContents(props.type);
    const [choices, setChoices] = React.useState<ApplyChoices>(() => defaultChoices(props.inputs, contents));
    const channelBody = channelMdHasBody(props.inputs.channelMd);
    const designBody = designMdHasBody(props.inputs.designMd);
    const words = parseWordBook(props.inputs.wordBookText);
    const newWords = words.readOnly ? 0 : countNewWords(words.book, contents.words);
    const newRules = countNewRules(parseNotes(props.inputs.notesText), contents.rules);
    const newSkills = contents.skillSlugs.filter(slug => !props.inputs.existingSkillSlugs.includes(slug));
    const oldSkills = contents.skillSlugs.filter(slug => props.inputs.existingSkillSlugs.includes(slug));
    const option = <K extends keyof ApplyChoices>(key: K, value: ApplyChoices[K], label: string): React.ReactElement =>
        <button key={value} type='button' className='theia-button secondary' data-akari-apply-channel={key === 'channel' ? value : undefined}
            data-akari-apply-design={key === 'design' ? value : undefined} data-akari-apply-skills={key === 'skills' ? value : undefined}
            aria-pressed={choices[key] === value} onClick={() => setChoices(previous => ({ ...previous, [key]: value }))}>{label}</button>;
    return <HomeScrim kind='channel-types-apply' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}</style>
        <h3>{t('surfaces.channel.applyType.heading', { name: props.type.name })}</h3>
        <p>{t('surfaces.channel.applyType.description', { name: props.channelName })}</p>
        <div className='akari-channel-apply-row'><b>{t('surfaces.channel.channelTypeApplySheetChannelDesignChannelMd.label')}</b>
            <span>{channelBody ? t('surfaces.channel.channelTypeApplySheetAlreadyWritten.label') : t('surfaces.channel.channelTypeApplySheetNewArrival.label')}</span>
            <div>{option('channel', 'keep', t('surfaces.channel.channelTypeApplySheetLeave.label'))}{option('channel', 'add', t('surfaces.channel.channelTypeApplySheetAddMissingHeadings.label'))}{option('channel', 'replace', t('surfaces.channel.channelTypeApplySheetReplace.label'))}</div></div>
        <div className='akari-channel-apply-row'><b>{t('surfaces.channel.channelTypeApplySheetDesignDesignMd.label')}</b>
            <span>{designBody ? t('surfaces.channel.channelTypeApplySheetAlreadyWritten.label') : t('surfaces.channel.channelTypeApplySheetNewArrival.label')}</span>
            <div>{option('design', 'keep', t('surfaces.channel.channelTypeApplySheetLeave.label'))}{option('design', 'add', t('surfaces.channel.channelTypeApplySheetAdd.label'))}{option('design', 'replace', t('surfaces.channel.channelTypeApplySheetReplace.label'))}</div></div>
        <div className='akari-channel-apply-row'><b>{t('surfaces.channel.channelTypeApplySheetDictionaryNotes.label')}</b>
            <span>{t('surfaces.channel.applyType.dictionarySummary.label', { words: newWords, rules: newRules })}</span><div /></div>
        <div className='akari-channel-apply-row'><b>{t('surfaces.channel.channelTypeApplySheetSkill.label')}</b>
            <span>{oldSkills.length ? t('surfaces.channel.applyType.skillsWithExisting.label', { skills: newSkills.map(slug => `/${slug}`).join(' ') || t('surfaces.channel.channelTypeApplySheetNone.label'), existing: oldSkills.map(slug => `/${slug}`).join(' ') }) : t('surfaces.channel.applyType.newSkills.label', { skills: newSkills.map(slug => `/${slug}`).join(' ') || t('surfaces.channel.channelTypeApplySheetNone.label') })}</span>
            <div>{oldSkills.length ? <>{option('skills', 'skip', t('surfaces.channel.channelTypeApplySheetSkipWhatsAlready.label'))}{option('skills', 'replace', t('surfaces.channel.channelTypeApplySheetReplace.label'))}</> : null}</div></div>
        <div className='akari-channel-apply-row'><b>{t('surfaces.channel.channelTypeApplySheetLibrary.label')}</b><span>{t('surfaces.channel.applyType.newTemplateCount.label', { count: contents.templates.length, n: contents.templates.length })}</span><div /></div>
        {props.type.tier === 'pro' && <p className='akari-channel-apply-note'>{t('surfaces.channel.proTypeAvailability.message')}</p>}
        <div className='akari-channel-sheet-actions'><button type='button' className='theia-button secondary' onClick={props.onBack}>{t('surfaces.channel.channelTypeApplySheetBack.button')}</button>
            <button type='button' className='theia-button main' data-akari-apply-run onClick={() => props.onApply(choices)}>{t('surfaces.channel.applyType.button')}</button></div>
    </HomeScrim>;
}

export function ChannelTypeBanner(props: { typeName: string; canUndo: boolean; onCatalog: () => void; onUndo: () => void }): React.ReactElement {
    return <div className='akari-channel-type-banner' data-akari-type-banner>
        <strong>{t('surfaces.channel.appliedType.label', { name: props.typeName })}</strong><small>{t('surfaces.channel.editedTypeDraft.message')}</small>
        <button type='button' className='theia-button secondary' data-akari-banner-catalog onClick={props.onCatalog}>{t('surfaces.channel.reviewType.button')}</button>
        {props.canUndo && <button type='button' className='theia-button secondary' data-akari-banner-undo onClick={props.onUndo}>{t('surfaces.channel.channelTypeBannerGoBackOneStep.button')}</button>}
    </div>;
}
