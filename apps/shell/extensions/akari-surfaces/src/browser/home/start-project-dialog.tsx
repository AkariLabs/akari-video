import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import type { AkariPlaybookListEntry, AkariToolCheckResponse } from '../../common/akari-new-project-protocol';
import { buildPlaybookSheetRows, playbookCategoryLabel } from './playbook-sheet';

export const PLAYBOOK_CATEGORIES = ['film', 'short-drama', 'mv', 'explainer', 'product', 'vlog', 'cm', 'education', 'clip', 'logo'] as const;
export type PlaybookCategory = typeof PLAYBOOK_CATEGORIES[number];
export type PlaybookSource = 'all' | 'channel' | 'local';

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

export function StartProjectDialog(p: StartProjectDialogProps): React.ReactElement {
    const visible = p.playbooks.filter(entry => (!p.category || entry.playbook.category === p.category)
        && (p.source === 'all' || entry.source === p.source));
    const selected = p.selected && visible.some(entry => entry.dir === p.selected?.dir) ? p.selected : undefined;
    const rows = selected && p.tools ? buildPlaybookSheetRows(selected.playbook, p.tools) : [];
    const sourceEntries = p.playbooks.filter(entry => p.source === 'all' || entry.source === p.source);
    const categoryCount = (category?: PlaybookCategory): number => sourceEntries.filter(entry => !category || entry.playbook.category === category).length;
    return <div className={`akari-start-project ${p.step === 'playbooks' ? 'expanded' : ''}`} data-akari-start-step={p.step}>
        <div className='akari-start-head'><h3>{t('surfaces.home.startProject.heading')}</h3><div className='akari-start-steps'>
            <span data-active={p.step === 'start'}>① {t('surfaces.home.startStepName.label')}</span><span>—</span>
            <span data-active={p.step === 'playbooks'}>② {t('surfaces.home.startStepPlaybook.label')}</span><span>—</span>
            <span>③ {t('surfaces.home.startStepCreate.label')}</span></div>
            <div className='akari-start-head-actions'>{p.step === 'playbooks' && <button type='button' className='akari-start-link' onClick={() => p.onStep('start')}>{t('surfaces.home.startBackToName.button')}</button>}
                <button type='button' className='akari-start-link' onClick={p.onClose}>{t('surfaces.home.homeScrimClose.label')}</button></div>
        </div>
        {p.step === 'start' ? <div className='akari-start-fields'>
            <label className='akari-start-field'><span>{t('surfaces.home.startName.label')}</span><input className='theia-input' data-akari-start-name='true' value={p.name} onChange={event => p.onName(event.currentTarget.value)} /></label>
            <div className='akari-start-field'><span>{t('surfaces.home.startChannel.label')}</span><div className='akari-start-channel'><button type='button' className='akari-start-channel-toggle' onClick={p.onChannelMenu}>{p.channel ?? t('surfaces.home.startNoChannel.label')} ▾</button>
                    {p.channelMenu && <div className='akari-start-channel-menu'>{p.channels.map(channel => <button type='button' key={channel} onClick={() => p.onChannel(channel)}>{channel}</button>)}<button type='button' onClick={p.onNewChannel}>{t('surfaces.home.startNewChannel.button')}</button></div>}
                    <button type='button' className='akari-start-link' onClick={p.onStandalone}>{t('surfaces.home.startStandalone.button')}</button>
                </div></div>
            <div className='akari-start-ways'><button type='button' data-akari-start-blank='true' disabled={p.busy} onClick={p.onBlank}><strong>{t('surfaces.home.startBlank.button')}</strong><small>{t('surfaces.home.startBlank.description')}</small><span>{t('surfaces.home.startBlankAction.label')}</span></button>
                <button type='button' data-akari-start-playbook='true' onClick={() => p.onStep('playbooks')}><strong>{t('surfaces.home.startFromPlaybook.button')}</strong><small>{t('surfaces.home.startFromPlaybook.description')}</small><span>{t('surfaces.home.startPlaybookAction.label')}</span></button></div>
        </div> : <div className='akari-start-browser'>
            <aside className='akari-start-filters'><h4>{t('surfaces.home.playbookCategory.label')}</h4><button type='button' data-selected={!p.category} onClick={() => p.onCategory(undefined)}><span>{t('surfaces.home.playbookAll.label')}</span><small>{categoryCount()}</small></button>
                {PLAYBOOK_CATEGORIES.map(category => <button type='button' key={category} data-selected={p.category === category} onClick={() => p.onCategory(category)}><span>{playbookCategoryLabel(category)}</span><small>{categoryCount(category)}</small></button>)}
                <h4>{t('surfaces.home.playbookSource.label')}</h4>{(['all', 'local', 'channel'] as const).map(source => <button type='button' key={source} data-selected={p.source === source} onClick={() => p.onSource(source)}>{t(`surfaces.home.playbookSource.${source}.label`)}</button>)}
            </aside>
            <div className='akari-start-list'><h4>{t('surfaces.home.playbookListHeading.message', { category: p.category ? playbookCategoryLabel(p.category) : t('surfaces.home.playbookAll.label'), count: visible.length })}</h4><div className='akari-start-card-grid'>{visible.length === 0 ? <p data-akari-playbook-empty='true'>{t('surfaces.home.playbookEmpty.message')}</p> : visible.map(entry => <button type='button' key={entry.dir} className='akari-start-playbook-card' data-selected={selected?.dir === entry.dir} onClick={() => p.onSelect(entry)}>
                {entry.coverUri && <img src={entry.coverUri} alt='' />}<span><strong>{entry.playbook.name}</strong><small>{playbookCategoryLabel(entry.playbook.category)} · {entry.source === 'channel' ? t('surfaces.home.playbookSource.channel.label') : t('surfaces.home.playbookSource.local.label')}</small></span>
            </button>)}</div></div>
            <aside className='akari-start-detail'>{selected ? <><h4>{selected.playbook.name}</h4><div className='akari-start-sheet' data-akari-playbook-sheet='true'>{p.tools ? rows.map(row => <section key={row.key} data-akari-sheet-row={row.key}><div className='akari-start-row-heading'><b>{row.label}</b><span>{row.summary}</span></div>{row.settingPairs && <div className='akari-start-settings-table'>{row.settingPairs.map(([key, value]) => <React.Fragment key={key}><small>{key}</small><small>{value}</small></React.Fragment>)}</div>}{row.items.map((item, index) => <small key={index}>{item}</small>)}</section>) : <p>{t('surfaces.home.playbookCheckingTools.message')}</p>}</div>
                <div className='akari-start-actions'><button type='button' onClick={() => p.onRead(selected)}>{t('surfaces.home.playbookRead.button')}</button><button type='button' className='theia-button main' disabled={p.busy} onClick={() => p.onApply(selected)}>{t('surfaces.home.playbookApply.button')}</button></div></> : <p>{t('surfaces.home.playbookSelectHint.message')}</p>}</aside>
        </div>}
    </div>;
}
