import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { CHANNEL_QUESTIONS, ChannelAnswers, buildChannelMarkdown, rankTypes, splitMarkdownSections } from './channel-design-model';
import { proGate } from '../../common/pro-key';
import { PRO_FEATURE_APPLY_TYPE } from './channel-pro-sheet';

export function ChannelDesignWizard(props: {
    channelName: string; initialAnswers?: ChannelAnswers; initialAppliedType?: string; rest?: string; hasProKey: boolean;
    onCreate: (markdown: string) => void; onPartner: (answers: ChannelAnswers) => void; onNotice: (text: string) => void; onClose: () => void;
    onNeedPro: (feature: string) => void;
    onCatalog?: () => void;
}): React.ReactElement {
    const [step, setStep] = React.useState(0);
    const [answers, setAnswers] = React.useState<ChannelAnswers>(props.initialAnswers ?? {});
    const [appliedType, setAppliedType] = React.useState(props.initialAppliedType);
    const [freeText, setFreeText] = React.useState('');
    const question = CHANNEL_QUESTIONS[step];
    const selected = answers[question.key] ?? [];
    const hasAnswer = Object.values(answers).some(value => value?.length);
    const choose = (value: string): void => {
        const next = question.mode === 'single' ? [value] : selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
        setAnswers({ ...answers, [question.key]: next });
    };
    const commitFreeText = (): void => {
        const value = freeText.trim();
        if (value) { setAnswers({ ...answers, [question.key]: [value] }); setFreeText(''); }
    };
    return <HomeScrim kind='channel-design-wizard' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}</style>
        <div className='akari-channel-wizard-grid'>
            <div className='akari-channel-wizard-column'>
                <h3>{t('surfaces.channel.channelDesignWizardChannelDesign.heading')}</h3>
                <div className='akari-channel-wizard-step' data-akari-wizard-step>{step + 1} / 6</div>
                <div className='akari-channel-wizard-question'>{question.title}</div><p>{question.hint}</p>
                <div className='akari-channel-wizard-options'>{question.options.map(option => <button key={option} type='button'
                    className='akari-channel-wizard-option' data-akari-wizard-option={option} aria-pressed={selected.includes(option)}
                    onClick={() => choose(option)}>{option}</button>)}</div>
                {question.freeText && <input className='akari-channel-wizard-free' placeholder={t('surfaces.channel.channelDesignWizardWriteElsewhere.label')} value={freeText}
                    onChange={event => setFreeText(event.currentTarget.value)} onBlur={commitFreeText}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitFreeText(); } }} />}
                <div className='akari-channel-wizard-nav'>
                    <button type='button' className='theia-button secondary' disabled={step === 0} onClick={() => setStep(step - 1)}>{t('surfaces.channel.channelDesignWizardBack.button')}</button>
                    <button type='button' className='theia-button secondary' onClick={() => setStep(Math.min(step + 1, 5))}>{t('surfaces.channel.channelDesignWizardLaterSkip.button')}</button>
                    <button type='button' className='theia-button secondary' disabled={step === 5} onClick={() => setStep(step + 1)}>{t('surfaces.channel.channelDesignWizardNext.button')}</button>
                </div>
            </div>
            <div className='akari-channel-wizard-column'>
                <h3>{t('surfaces.channel.channelDesignWizardDraftChannelMd.heading')}</h3>
                <pre className='akari-channel-wizard-draft' data-akari-wizard-draft>{buildChannelMarkdown(answers, props.channelName, appliedType, props.rest)}</pre>
                <h3>{t('surfaces.channel.channelDesignWizardCloseChannelType.heading')}</h3>
                {!hasAnswer ? <p>{t('surfaces.channel.channelDesignWizardAnswerOneQuestionSimilarPatternAppear.message')}</p> : <div className='akari-channel-wizard-types'>
                    {rankTypes(answers).map(type => <div key={type.name} className='akari-channel-wizard-type' data-akari-wizard-type={type.name}>
                        <b>{type.tier === 'pro' ? '☆ ' : ''}{type.name}</b><span>{t('surfaces.channel.matchingTraits.label', { traits: type.matched.join(t('surfaces.channel.channelDesignWizardList.separator')) })}</span>
                        <span>{t('surfaces.channel.channelDesignWizardTemplatesCaptionStylesSkillDraftsIncluded.label')}</span>
                        <button type='button' className='theia-button secondary' disabled={appliedType === type.name} onClick={() => {
                            if (!proGate(type.tier, props.hasProKey)) props.onNeedPro(PRO_FEATURE_APPLY_TYPE);
                            else setAppliedType(type.name);
                        }}>{appliedType === type.name ? t('surfaces.channel.channelDesignWizardSuggested.label') : t('surfaces.channel.applyType.button')}</button>
                    </div>)}
                </div>}
                {props.onCatalog && <button type='button' className='theia-button secondary' data-akari-wizard-catalog
                    onClick={props.onCatalog}>{t('surfaces.channel.channelDesignWizardSearchCatalog.button')}</button>}
            </div>
        </div>
        <div className='akari-channel-sheet-actions'>
            <button type='button' className='theia-button secondary' data-akari-wizard-partner onClick={() => props.onPartner(answers)}>{t('surfaces.channel.channelDesignWizardTooMuchTroubleTalkPartnerMake.button')}</button>
            <button type='button' className='theia-button main' data-akari-wizard-create disabled={!hasAnswer}
                onClick={() => props.onCreate(buildChannelMarkdown(answers, props.channelName, appliedType, props.rest))}>{t('surfaces.channel.channelDesignWizardMakeAnswer.button')}</button>
        </div>
    </HomeScrim>;
}

export function ChannelDesignView(props: {
    fileName: string; text: string; onRedesign: () => void; onOpenFile: () => void; onPartner: () => void; onClose: () => void;
    onCatalog?: () => void; banner?: React.ReactNode; onHelper?: () => void;
}): React.ReactElement {
    return <HomeScrim kind='channel-design-view' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}</style>
        <h3>{t('surfaces.channel.channelDesignViewChannelDesign.heading')}</h3>{props.banner}<p>{t('surfaces.channel.designFileContents.message', { file: props.fileName })}</p>
        {splitMarkdownSections(props.text).map((section, index) => <section className='akari-channel-sheet-section' key={`${section.heading}-${index}`}>
            {section.heading && <h4>{section.heading}</h4>}
            {section.body.split('\n').map((line, lineIndex) => <div key={lineIndex}>{line || '\u00a0'}</div>)}
        </section>)}
        <div className='akari-channel-sheet-actions'>
            {props.onHelper && <button type='button' className='theia-button secondary' data-akari-design-helper onClick={props.onHelper}>{t('surfaces.channel.channelDesignViewHaveHelperWritePastVideos.button')}</button>}
            {props.onCatalog && <button type='button' className='theia-button secondary' data-akari-design-catalog
                onClick={props.onCatalog}>{t('surfaces.channel.reviewType.button')}</button>}
            <button type='button' className='theia-button secondary' data-akari-design-redesign onClick={props.onRedesign}>{t('surfaces.channel.channelDesignViewRedesign.button')}</button>
            <button type='button' className='theia-button secondary' onClick={props.onOpenFile}>{t('surfaces.channel.channelDesignViewOpenFile.button')}</button>
            <button type='button' className='theia-button main' onClick={props.onPartner}>{t('surfaces.channel.channelDesignViewDigDeepPartner.button')}</button>
        </div>
    </HomeScrim>;
}

export function ChannelDesignStart(props: { onFromType: () => void; onFromQuestions: () => void; onClose: () => void }): React.ReactElement {
    return <HomeScrim kind='channel-design-start' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}</style>
        <h3>{t('surfaces.channel.channelDesignStartChannelDesign.heading')}</h3>
        <p>{t('surfaces.channel.channelDesignStartChannelMdStillEmpty.label')}</p>
        <p>{t('surfaces.channel.channelDesignStartStartChannelTypeDraftsDesignDictionarySkills.message')}</p>
        <div className='akari-channel-sheet-actions'>
            <button type='button' className='theia-button main' data-akari-design-start-type onClick={props.onFromType}>{t('surfaces.channel.createFromType.button')}</button>
            <button type='button' className='theia-button secondary' data-akari-design-start-questions onClick={props.onFromQuestions}>{t('surfaces.channel.channelDesignStartCreateSelectQuestions.button')}</button>
        </div>
    </HomeScrim>;
}
