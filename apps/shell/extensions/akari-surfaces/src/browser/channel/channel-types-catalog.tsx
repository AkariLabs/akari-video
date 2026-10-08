import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { TYPE_FIELDS } from './channel-types-data';
import { ChannelTypeEntry, channelTypeSummary, filterChannelTypes, findChannelType, nearChannelTypes, tierLabel, typeContents } from './channel-types-model';

type AuthorFilter = 'all' | 'akari' | 'community' | 'free';
type SortMode = 'uses' | 'new';

export function ChannelTypesCatalog(props: {
    channelName: string; initialTypeId?: string; onApply: (type: ChannelTypeEntry) => void;
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
        <h3>チャンネルの型</h3>
        <p>型は channel.md を作るためのテンプレです。中身は誰でも見られます。当てる（このチャンネルに入れる）のは Akari Pro で、無料の型もあります。</p>
        <div className='akari-channel-types-filters'>
            <span>作者</span>{([['all', 'すべて'], ['akari', 'Akari'], ['community', 'みんな'], ['free', '無料']] as const).map(([id, label]) =>
                <button key={id} type='button' className='theia-button secondary' data-akari-types-author={id} aria-pressed={author === id}
                    onClick={() => { setAuthor(id); setVisibleCount(24); }}>{label}</button>)}
            <span>並び</span>{([['uses', '使われている順'], ['new', '新しい順']] as const).map(([id, label]) =>
                <button key={id} type='button' className='theia-button secondary' data-akari-types-sort={id} aria-pressed={sort === id}
                    onClick={() => setSort(id)}>{label}</button>)}
            <input data-akari-types-query aria-label='型を探す' placeholder='型を探す' value={query}
                onChange={event => { setQuery(event.currentTarget.value); setVisibleCount(24); }} />
        </div>
        <div className='akari-channel-types-grid'>
            <div className='akari-channel-types-fields'>
                {TYPE_FIELDS.map(item => <button key={item.id} type='button' data-akari-types-field={item.id}
                    aria-current={fieldId === item.id ? 'true' : undefined} onClick={() => chooseField(item.id)}>
                    <span>{item.name}</span><span>{item.sampleCount.toLocaleString()}</span></button>)}
                <small>件数は見本です</small>
            </div>
            <div className='akari-channel-types-list'>
                <p>{query.trim() ? `「${query}」で ${filtered.length} 件（見本の中から）`
                    : `${field?.name ?? ''} · ${field?.sampleCount.toLocaleString() ?? 0} 件のうち ${Math.min(visibleCount, filtered.length)} 件を表示`}</p>
                {filtered.length ? filtered.slice(0, visibleCount).map(type => <button key={type.id} type='button'
                    className='akari-channel-types-card' data-akari-types-card={type.id}
                    aria-current={selectedId === type.id ? 'true' : undefined} onClick={() => chooseType(type)}>
                    <b>{type.tier === 'pro' ? '☆ ' : ''}{type.name}</b>
                    <span>{channelTypeSummary(type)}</span>
                    <small>{type.author} · {type.uses.toLocaleString()} 回使われた{type.derivedFrom ? ` · 元にした型: ${type.derivedFrom}` : ''}</small>
                </button>) : <p>見つかりません。自分で作ることもできます。</p>}
                {filtered.length > visibleCount && <button type='button' className='theia-button secondary'
                    onClick={() => setVisibleCount(count => count + 24)}>さらに表示</button>}
            </div>
            <div className='akari-channel-types-detail' data-akari-types-detail>
                {selected && contents && <>
                    <h4>{selected.name}</h4>
                    <p>作: {selected.author}{selected.derivedFrom && <> · 元にした型: {selected.derivedFrom}</>} · {tierLabel(selected)}</p>
                    <h5>チャンネル設計（channel.md）</h5><pre>{contents.channelMd}</pre>
                    <h5>デザイン（design.md）</h5><p>{contents.designSentence}</p>
                    <h5>辞書とメモ</h5>
                    <p>言い換え: {contents.words.map(([from, to]) => `${from} → ${to}`).join('、') || 'なし'}</p>
                    <p>決まりごと: {contents.rules.map(rule => `${rule.area}: ${rule.text}`).join(' / ')}</p>
                    <h5>スキル</h5><p>{contents.skillSlugs.map(slug => `/${slug}`).join(' ') || 'なし'}</p>
                    <h5>ライブラリ（よく使うテンプレ）</h5><p>{contents.templates.join('・') || 'なし'}</p>
                    <h5>近い型</h5><div className='akari-channel-types-near'>{nearChannelTypes(selected).map(type =>
                        <button key={type.id} type='button' className='theia-button secondary' onClick={() => chooseType(type, true)}>{type.name}</button>)}</div>
                </>}
            </div>
        </div>
        <div className='akari-channel-sheet-actions'>
            <button type='button' className='theia-button secondary' data-akari-types-save-mine onClick={props.onSaveMyType}>今のチャンネルを型として残す</button>
            <div><button type='button' className='theia-button secondary' onClick={props.onClose}>閉じる</button>
                <button type='button' className='theia-button main' data-akari-types-apply disabled={!selected}
                    onClick={() => { if (selected) props.onApply(selected); }}>この型を当てる…</button></div>
        </div>
    </HomeScrim>;
}
