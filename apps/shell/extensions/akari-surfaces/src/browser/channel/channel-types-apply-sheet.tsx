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
        <h3>「{props.type.name}」を当てる</h3>
        <p>「{props.channelName}」にすでにあるものとの重なりです。項目ごとに決めてから当てます。あとから 1 つ前に戻せます。</p>
        <div className='akari-channel-apply-row'><b>チャンネル設計（channel.md）</b>
            <span>{channelBody ? 'すでに書いてあります' : '新しく入ります'}</span>
            <div>{option('channel', 'keep', '残す')}{option('channel', 'add', '足りない見出しだけ足す')}{option('channel', 'replace', '置き換える')}</div></div>
        <div className='akari-channel-apply-row'><b>デザイン（design.md）</b>
            <span>{designBody ? 'すでに書いてあります' : '新しく入ります'}</span>
            <div>{option('design', 'keep', '残す')}{option('design', 'add', '足す')}{option('design', 'replace', '置き換える')}</div></div>
        <div className='akari-channel-apply-row'><b>辞書とメモ</b>
            <span>言い換え 新しく {newWords} 件・決まりごと 新しく {newRules} 件（同じものはとばします）</span><div /></div>
        <div className='akari-channel-apply-row'><b>スキル</b>
            <span>新しく {newSkills.map(slug => `/${slug}`).join(' ') || 'なし'}{oldSkills.length ? `・すでにある ${oldSkills.map(slug => `/${slug}`).join(' ')}` : ''}</span>
            <div>{oldSkills.length ? <>{option('skills', 'skip', 'すでにあるものはとばす')}{option('skills', 'replace', '置き換える')}</> : null}</div></div>
        <div className='akari-channel-apply-row'><b>ライブラリ</b><span>よく使うテンプレ 新しく {contents.templates.length} 件</span><div /></div>
        {props.type.tier === 'pro' && <p className='akari-channel-apply-note'>☆ Pro の型です。いまは印だけで、当てられます。</p>}
        <div className='akari-channel-sheet-actions'><button type='button' className='theia-button secondary' onClick={props.onBack}>戻る</button>
            <button type='button' className='theia-button main' data-akari-apply-run onClick={() => props.onApply(choices)}>当てる</button></div>
    </HomeScrim>;
}

export function ChannelTypeBanner(props: { typeName: string; canUndo: boolean; onCatalog: () => void; onUndo: () => void }): React.ReactElement {
    return <div className='akari-channel-type-banner' data-akari-type-banner>
        <strong>型: {props.typeName}</strong><small>この型から作った下書きを、あなたが直したものです。</small>
        <button type='button' className='theia-button secondary' data-akari-banner-catalog onClick={props.onCatalog}>型を見る・当て直す…</button>
        {props.canUndo && <button type='button' className='theia-button secondary' data-akari-banner-undo onClick={props.onUndo}>1 つ前に戻す</button>}
    </div>;
}
