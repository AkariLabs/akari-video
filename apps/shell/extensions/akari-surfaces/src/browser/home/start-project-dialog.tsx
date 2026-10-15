import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import type { AkariPlaybookListEntry, AkariToolCheckResponse } from '../../common/akari-new-project-protocol';
import { buildPlaybookSheetRows, playbookCategoryLabel } from './playbook-sheet';
import { channelChoices, playbookCover, playbookFrames, showStandaloneExplanation } from './start-project-model';
import { startProjectCss } from './start-project-style';

export const PLAYBOOK_CATEGORIES = ['film', 'short-drama', 'mv', 'explainer', 'product', 'vlog', 'cm', 'education', 'clip', 'logo'] as const;
export type PlaybookCategory = typeof PLAYBOOK_CATEGORIES[number];
export type PlaybookSource = 'all' | 'channel' | 'local' | 'lab';

export interface StartProjectDialogProps {
    name: string; channel?: string; channels: string[]; channelMenu: boolean;
    step: 'start' | 'playbooks'; playbooks: AkariPlaybookListEntry[];
    selected?: AkariPlaybookListEntry; category?: PlaybookCategory; source: PlaybookSource;
    tools?: AkariToolCheckResponse; busy: boolean;
    onName: (value: string) => void; onChannelMenu: () => void; onChannel: (value: string) => void;
    onNewChannel: () => void; onStandalone: () => void; onStep: (step: 'start' | 'playbooks') => void;
    onCategory: (category?: PlaybookCategory) => void; onSource: (source: PlaybookSource) => void;
    onSelect: (entry: AkariPlaybookListEntry) => void; onBlank: () => void;
    onRead: (entry: AkariPlaybookListEntry) => void; onApply: (entry: AkariPlaybookListEntry) => void;
    onClose: () => void;
}

function PlaybookCard({ entry, selected, onSelect }: { entry: AkariPlaybookListEntry; selected: boolean; onSelect: () => void }): React.ReactElement {
    const frames = playbookFrames(entry);
    const [hovered, setHovered] = React.useState(false);
    const [index, setIndex] = React.useState(0);
    React.useEffect(() => {
        if (!hovered || frames.length < 2) return;
        const timer = window.setInterval(() => setIndex(value => (value + 1) % frames.length), 800);
        return () => window.clearInterval(timer);
    }, [hovered, entry.dir, entry.frameUris]);
    const image = hovered && frames.length >= 2 ? frames[index % frames.length] : playbookCover(entry);
    return <button type='button' className='akari-start-playbook-card' data-selected={selected} aria-pressed={selected}
        onMouseEnter={() => { setIndex(0); setHovered(true); }} onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)} onBlur={() => setHovered(false)} onClick={onSelect}>
        <span className='akari-start-card-cover'>{image ? <img src={image} alt='' /> : <span className='akari-start-cover-empty' aria-hidden='true'>▤</span>}
            {entry.playbook.example === true && <span className='akari-start-example'>{t('surfaces.home.playbookExample.label')}</span>}</span>
        <span className='akari-start-card-meta'><strong>{entry.playbook.name}</strong><small>{playbookCategoryLabel(entry.playbook.category)} · {t(`surfaces.home.playbookSource.${entry.source}.label`)}</small></span>
    </button>;
}

function PlaybookPreview({ entry }: { entry: AkariPlaybookListEntry }): React.ReactElement {
    const frames = playbookFrames(entry);
    const [index, setIndex] = React.useState(0);
    const [paused, setPaused] = React.useState(false);
    React.useEffect(() => { setIndex(0); setPaused(false); }, [entry.dir]);
    React.useEffect(() => {
        if (paused || frames.length < 2) return;
        const timer = window.setInterval(() => setIndex(value => (value + 1) % frames.length), 1500);
        return () => window.clearInterval(timer);
    }, [paused, entry.dir, entry.frameUris]);
    if (!frames.length) return <p className='akari-start-preview-empty'>{t('surfaces.home.playbookNoPreview.message')}</p>;
    return <div className='akari-start-preview' data-akari-playbook-preview='true'>
        <button type='button' className='akari-start-preview-main' aria-label={paused ? t('surfaces.home.playbookPreviewResume.button') : t('surfaces.home.playbookPreviewPause.button')}
            onClick={() => setPaused(value => !value)}><img src={frames[index % frames.length]} alt='' /><span>{paused ? '▶' : 'Ⅱ'}</span></button>
        <div className='akari-start-preview-strip'>{frames.map((src, frame) => <button type='button' key={frame} data-active={index === frame}
            aria-label={t('surfaces.home.playbookPreviewFrame.button', { frame: frame + 1 })} onClick={() => { setIndex(frame); setPaused(true); }}><img src={src} alt='' /></button>)}</div>
    </div>;
}

export function StartProjectDialog(p: StartProjectDialogProps): React.ReactElement {
    const visible = p.playbooks.filter(entry => (!p.category || entry.playbook.category === p.category)
        && (p.source === 'all' || entry.source === p.source));
    const selected = p.selected && visible.some(entry => entry.dir === p.selected?.dir) ? p.selected : undefined;
    const rows = selected && p.tools ? buildPlaybookSheetRows(selected.playbook, p.tools) : [];
    const sourceEntries = p.playbooks.filter(entry => p.source === 'all' || entry.source === p.source);
    const categoryCount = (category?: PlaybookCategory): number => sourceEntries.filter(entry => !category || entry.playbook.category === category).length;
    return <div className={`akari-start-project ${p.step === 'playbooks' ? 'expanded' : ''}`} data-akari-start-step={p.step}>
        <style>{startProjectCss}</style>
        <div className='akari-start-head'><h3>{t('surfaces.home.startProject.heading')}</h3><div className='akari-start-steps'>
            <span data-active={p.step === 'start'}>① {t('surfaces.home.startStepName.label')}</span><span>—</span>
            <span data-active={p.step === 'playbooks'}>② {t('surfaces.home.startStepPlaybook.label')}</span><span>—</span>
            <span>③ {t('surfaces.home.startStepCreate.label')}</span></div>
            <div className='akari-start-head-actions'>{p.step === 'playbooks' && <button type='button' className='akari-start-button' onClick={() => p.onStep('start')}>{t('surfaces.home.startBackToName.button')}</button>}
                <button type='button' className='akari-start-button' onClick={p.onClose}>{t('surfaces.home.homeScrimClose.label')}</button></div>
        </div>
        {p.step === 'start' ? <div className='akari-start-fields'>
            <label className='akari-start-field'><span>{t('surfaces.home.startName.label')}</span><input className='theia-input' data-akari-start-name='true' value={p.name} onChange={event => p.onName(event.currentTarget.value)} /></label>
            <div className='akari-start-field'><span>{t('surfaces.home.startChannel.label')}</span><div className='akari-start-channel'><button type='button' className='akari-start-channel-toggle' aria-expanded={p.channelMenu} onClick={p.onChannelMenu}>{p.channel ?? t('surfaces.home.startStandalone.button')} ▾</button>
                    {p.channelMenu && <div className='akari-start-channel-menu'>{channelChoices(p.channels).map(choice => choice.kind === 'channel'
                        ? <button type='button' key={choice.name} data-akari-channel-choice='channel' onClick={() => p.onChannel(choice.name)}>{choice.name}</button>
                        : <React.Fragment key={choice.kind}><div className='akari-start-menu-separator' role='separator' /><button type='button' data-akari-channel-choice={choice.kind}
                            onClick={choice.kind === 'new' ? p.onNewChannel : p.onStandalone}>{choice.kind === 'new' ? t('surfaces.home.startNewChannel.button') : t('surfaces.home.startStandalone.button')}</button></React.Fragment>)}</div>}
                    {showStandaloneExplanation(p.channel) && <div className='akari-start-standalone-note' data-akari-standalone-note='true'><strong>{t('surfaces.home.startStandaloneNote.heading')}</strong>
                        <p>{t('surfaces.home.startStandaloneNote.message')}</p><p>{t('surfaces.home.startStandaloneLater.message')}</p></div>}
                </div></div>
            <div className='akari-start-ways'><button type='button' data-akari-start-blank='true' disabled={p.busy} onClick={p.onBlank}><span className='akari-start-way-icon' aria-hidden='true'>＋</span><strong>{t('surfaces.home.startBlank.button')}</strong><small>{t('surfaces.home.startBlank.description')}</small><span className='akari-start-way-action'>{t('surfaces.home.startBlankAction.label')}</span></button>
                <button type='button' data-akari-start-playbook='true' onClick={() => p.onStep('playbooks')}><span className='akari-start-way-icon' aria-hidden='true'>▤</span><strong>{t('surfaces.home.startFromPlaybook.button')}</strong><small>{t('surfaces.home.startFromPlaybook.description')}</small><span className='akari-start-way-action'>{t('surfaces.home.startPlaybookAction.label')}</span></button></div>
        </div> : <div className='akari-start-browser'>
            <aside className='akari-start-filters'><h4>{t('surfaces.home.playbookCategory.label')}</h4><button type='button' data-selected={!p.category} onClick={() => p.onCategory(undefined)}><span>{t('surfaces.home.playbookAll.label')}</span><small>{categoryCount()}</small></button>
                {PLAYBOOK_CATEGORIES.map(category => <button type='button' key={category} data-selected={p.category === category} onClick={() => p.onCategory(category)}><span>{playbookCategoryLabel(category)}</span><small>{categoryCount(category)}</small></button>)}
                <h4>{t('surfaces.home.playbookSource.label')}</h4>{(['all', 'local', 'channel', 'lab'] as const).map(source => <button type='button' key={source} data-selected={p.source === source} onClick={() => p.onSource(source)}>{t(`surfaces.home.playbookSource.${source}.label`)}</button>)}
            </aside>
            <div className='akari-start-list'><h4>{t('surfaces.home.playbookListHeading.message', { category: p.category ? playbookCategoryLabel(p.category) : t('surfaces.home.playbookAll.label'), count: visible.length })}</h4><div className='akari-start-card-grid'>{visible.length === 0 ? <p data-akari-playbook-empty='true'>{t('surfaces.home.playbookEmpty.message')}</p> : visible.map(entry => <PlaybookCard key={entry.dir} entry={entry} selected={selected?.dir === entry.dir} onSelect={() => p.onSelect(entry)} />)}</div></div>
            <aside className='akari-start-detail'>{selected ? <><h4>{selected.playbook.name}</h4><div className='akari-start-sheet' data-akari-playbook-sheet='true'><PlaybookPreview entry={selected} />{p.tools ? rows.map(row => <section key={row.key} data-akari-sheet-row={row.key}><div className='akari-start-row-heading'><b>{row.label}</b><span>{row.summary}</span></div>{row.settingPairs && <div className='akari-start-settings-table'>{row.settingPairs.map(([key, value]) => <React.Fragment key={key}><small>{key}</small><small>{value}</small></React.Fragment>)}</div>}{row.items.map((item, index) => <small key={index}>{item}</small>)}</section>) : <p>{t('surfaces.home.playbookCheckingTools.message')}</p>}</div>
                <div className='akari-start-actions'><button type='button' className='akari-start-button' onClick={() => p.onRead(selected)}><span aria-hidden='true'>▤</span>{t('surfaces.home.playbookRead.button')}</button><button type='button' className='akari-start-button primary' disabled={p.busy} onClick={() => p.onApply(selected)}><span aria-hidden='true'>＋</span>{t('surfaces.home.playbookApply.button')}</button></div></> : <p>{t('surfaces.home.playbookSelectHint.message')}</p>}</aside>
        </div>}
    </div>;
}
