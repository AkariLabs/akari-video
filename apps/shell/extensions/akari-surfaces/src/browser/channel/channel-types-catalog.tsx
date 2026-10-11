import { t, formatNumber } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { TYPE_FIELDS } from './channel-types-data';
import { ChannelTypeEntry, channelTypeSummary, filterChannelTypes, findChannelType, nearChannelTypes, tierLabel, typeContents } from './channel-types-model';
import { proGate } from '../../common/pro-key';
import { PRO_FEATURE_APPLY_TYPE } from './channel-pro-sheet';

type AuthorFilter = 'all' | 'akari' | 'community' | 'free';
type SortMode = 'uses' | 'new';

export function ChannelTypesCatalog(props: {
    channelName: string; initialTypeId?: string; onApply: (type: ChannelTypeEntry) => void;
    hasProKey: boolean; onNeedPro: (feature: string) => void;
    onSaveMyType: () => void; onClose: () => void;
}): React.ReactElement {
    const initial = findChannelType(props.initialTypeId ?? '') ?? findChannelType('daily-basic');
    const [fieldId, setFieldId] = React.useState(initial?.fieldId ?? 'life');
    const [query, setQuery] = React.useState('');
    const [author, setAuthor] = React.useState<AuthorFilter>('all');
    const [sort, setSort] = React.useState<SortMode>('uses');
    const [selectedId, setSelectedId] = React.useState(initial?.id ?? 'daily-basic');
    const [visibleCount, setVisibleCount] = React.useState(24);
    const filtered = filterChannelTypes({ fieldId, query, author, sort });
    const selected = findChannelType(selectedId);
    const contents = selected ? typeContents(selected) : undefined;
    const field = TYPE_FIELDS.find(item => item.id === fieldId);
    const chooseField = (id: string): void => { setFieldId(id); setQuery(''); setVisibleCount(24); };
    const chooseType = (type: ChannelTypeEntry, clearQuery = false): void => {
        setSelectedId(type.id);
        setFieldId(type.fieldId);
        if (clearQuery) setQuery('');
    };
    return <HomeScrim kind='channel-types-catalog' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}</style>
        <h3>{t('surfaces.channel.channelTypesCatalogChannelType.heading')}</h3>
        <p>{t('surfaces.channel.typeCatalog.description')}</p>
        <div className='akari-channel-types-filters'>
            <span>{t('surfaces.channel.channelTypesCatalogAuthor.label')}</span>{([['all', t('surfaces.channel.channelTypesCatalogAll.label')], ['akari', 'Akari'], ['community', t('surfaces.channel.channelTypesCatalogEveryone.label')], ['free', t('surfaces.channel.channelTypesCatalogFree.label')]] as const).map(([id, label]) =>
                <button key={id} type='button' className='theia-button secondary' data-akari-types-author={id} aria-pressed={author === id}
                    onClick={() => { setAuthor(id); setVisibleCount(24); }}>{label}</button>)}
            <span>{t('surfaces.channel.channelTypesCatalogLineUp.label')}</span>{([['uses', t('surfaces.channel.channelTypesCatalogOrder.label')], ['new', t('surfaces.channel.channelTypesCatalogNewestFirst.label')]] as const).map(([id, label]) =>
                <button key={id} type='button' className='theia-button secondary' data-akari-types-sort={id} aria-pressed={sort === id}
                    onClick={() => setSort(id)}>{label}</button>)}
            <input data-akari-types-query aria-label={t('surfaces.channel.channelTypesCatalogFindType.label')} placeholder={t('surfaces.channel.channelTypesCatalogFindType.label')} value={query}
                onChange={event => { setQuery(event.currentTarget.value); setVisibleCount(24); }} />
        </div>
        <div className='akari-channel-types-grid'>
            <div className='akari-channel-types-fields'>
                {TYPE_FIELDS.map(item => <button key={item.id} type='button' data-akari-types-field={item.id}
                    aria-current={fieldId === item.id ? 'true' : undefined} onClick={() => chooseField(item.id)}>
                    <span>{item.name}</span><span>{formatNumber(item.sampleCount)}</span></button>)}
                <small>{t('surfaces.channel.channelTypesCatalogNumberCasesSample.label')}</small>
            </div>
            <div className='akari-channel-types-list'>
                <p>{query.trim() ? t('surfaces.channel.channelTypesCatalogSample.message', { query: query, filteredCount: filtered.length })
                    : t('surfaces.channel.channelTypesCatalogShowingResults.message', { field: field?.name ?? '', totalCount: field ? formatNumber(field.sampleCount) : 0, n: field?.sampleCount ?? 0, visibleCount: Math.min(visibleCount, filtered.length) })}</p>
                {filtered.length ? filtered.slice(0, visibleCount).map(type => <button key={type.id} type='button'
                    className='akari-channel-types-card' data-akari-types-card={type.id}
                    aria-current={selectedId === type.id ? 'true' : undefined} onClick={() => chooseType(type)}>
                    <b>{type.tier === 'pro' ? '☆ ' : ''}{type.name}</b>
                    <span>{channelTypeSummary(type)}</span>
                    <small>{type.derivedFrom ? t('surfaces.channel.typeUsageWithSource.label', { author: type.author, count: formatNumber(type.uses), n: type.uses, source: type.derivedFrom }) : t('surfaces.channel.typeUsage.label', { author: type.author, count: formatNumber(type.uses), n: type.uses })}</small>
                </button>) : <p>{t('surfaces.channel.channelTypesCatalogFoundAlsoMakeOwn.message')}</p>}
                {filtered.length > visibleCount && <button type='button' className='theia-button secondary'
                    onClick={() => setVisibleCount(count => count + 24)}>{t('surfaces.channel.channelTypesCatalogShowMore.button')}</button>}
            </div>
            <div className='akari-channel-types-detail' data-akari-types-detail>
                {selected && contents && <>
                    <h4>{selected.name}</h4>
                    <p>{selected.derivedFrom ? t('surfaces.channel.typeDetailsWithSource.label', { author: selected.author, source: selected.derivedFrom, tier: tierLabel(selected) }) : t('surfaces.channel.typeDetails.label', { author: selected.author, tier: tierLabel(selected) })}</p>
                    <h5>{t('surfaces.channel.channelTypesCatalogChannelDesignChannelMd.heading')}</h5><pre>{contents.channelMd}</pre>
                    <h5>{t('surfaces.channel.channelTypesCatalogDesignDesignMd.heading')}</h5><p>{contents.designSentence}</p>
                    <h5>{t('surfaces.channel.channelTypesCatalogDictionaryNotes.heading')}</h5>
                    <p>{t('surfaces.channel.typeReplacements.label', { replacements: contents.words.map(([from, to]) => `${from} → ${to}`).join(t('surfaces.channel.aliasList.separator')) || t('surfaces.channel.channelTypesCatalogNone.label') })}</p>
                    <p>{t('surfaces.channel.typeRules.label', { rules: contents.rules.map(rule => `${rule.area}: ${rule.text}`).join(' / ') })}</p>
                    <h5>{t('surfaces.channel.channelTypesCatalogSkill.heading')}</h5><p>{contents.skillSlugs.map(slug => `/${slug}`).join(' ') || t('surfaces.channel.channelTypesCatalogNone.label')}</p>
                    <h5>{t('surfaces.channel.channelTypesCatalogLibraryFrequentlyTemplates.heading')}</h5><p>{contents.templates.join(t('surfaces.channel.channelTypesCatalogList.separator')) || t('surfaces.channel.channelTypesCatalogNone.label')}</p>
                    <h5>{t('surfaces.channel.channelTypesCatalogSimilarType.heading')}</h5><div className='akari-channel-types-near'>{nearChannelTypes(selected).map(type =>
                        <button key={type.id} type='button' className='theia-button secondary' onClick={() => chooseType(type, true)}>{type.name}</button>)}</div>
                </>}
            </div>
        </div>
        <div className='akari-channel-sheet-actions'>
            <button type='button' className='theia-button secondary' data-akari-types-save-mine onClick={props.onSaveMyType}>{t('surfaces.channel.channelTypesCatalogLeaveCurrentChannelTemplate.button')}</button>
            <div><button type='button' className='theia-button secondary' onClick={props.onClose}>{t('surfaces.channel.channelTypesCatalogClose.button')}</button>
                <button type='button' className='theia-button main' data-akari-types-apply disabled={!selected}
                    onClick={() => {
                        if (!selected) return;
                        if (!proGate(selected.tier, props.hasProKey)) props.onNeedPro(PRO_FEATURE_APPLY_TYPE);
                        else props.onApply(selected);
                    }}>{t('surfaces.channel.channelTypesCatalogApplyType.button')}</button></div>
        </div>
    </HomeScrim>;
}
