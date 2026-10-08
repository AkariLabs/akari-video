import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { CHANNEL_QUESTIONS, ChannelAnswers, buildChannelMarkdown, rankTypes, splitMarkdownSections } from './channel-design-model';

export function ChannelDesignWizard(props: {
    channelName: string; initialAnswers?: ChannelAnswers; initialAppliedType?: string; rest?: string; hasProKey: boolean;
    onCreate: (markdown: string) => void; onPartner: (answers: ChannelAnswers) => void; onNotice: (text: string) => void; onClose: () => void;
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
                <h3>チャンネル設計</h3>
                <div className='akari-channel-wizard-step' data-akari-wizard-step>{step + 1} / 6</div>
                <div className='akari-channel-wizard-question'>{question.title}</div><p>{question.hint}</p>
                <div className='akari-channel-wizard-options'>{question.options.map(option => <button key={option} type='button'
                    className='akari-channel-wizard-option' data-akari-wizard-option={option} aria-pressed={selected.includes(option)}
                    onClick={() => choose(option)}>{option}</button>)}</div>
                {question.freeText && <input className='akari-channel-wizard-free' placeholder='ほかに書く' value={freeText}
                    onChange={event => setFreeText(event.currentTarget.value)} onBlur={commitFreeText}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitFreeText(); } }} />}
                <div className='akari-channel-wizard-nav'>
                    <button type='button' className='theia-button secondary' disabled={step === 0} onClick={() => setStep(step - 1)}>戻る</button>
                    <button type='button' className='theia-button secondary' onClick={() => setStep(Math.min(step + 1, 5))}>あとで（飛ばす）</button>
                    <button type='button' className='theia-button secondary' disabled={step === 5} onClick={() => setStep(step + 1)}>次へ</button>
                </div>
            </div>
            <div className='akari-channel-wizard-column'>
                <h3>channel.md の下書き</h3>
                <pre className='akari-channel-wizard-draft' data-akari-wizard-draft>{buildChannelMarkdown(answers, props.channelName, appliedType, props.rest)}</pre>
                <h3>近いチャンネルの型</h3>
                {!hasAnswer ? <p>1 つ答えると、近い型が出てきます。</p> : <div className='akari-channel-wizard-types'>
                    {rankTypes(answers).map(type => <div key={type.name} className='akari-channel-wizard-type' data-akari-wizard-type={type.name}>
                        <b>{type.tier === 'pro' ? '☆ ' : ''}{type.name}</b><span>合う: {type.matched.join('・')}</span>
                        <span>テンプレ・字幕スタイル・スキルの下書きつき</span>
                        <button type='button' className='theia-button secondary' disabled={appliedType === type.name} onClick={() => {
                            if (type.tier === 'pro' && !props.hasProKey) props.onNotice('☆ この型を当てるのは Akari Pro です。中身は見られます');
                            else setAppliedType(type.name);
                        }}>{appliedType === type.name ? '当てています' : '当てる'}</button>
                    </div>)}
                </div>}
                {props.onCatalog && <button type='button' className='theia-button secondary' data-akari-wizard-catalog
                    onClick={props.onCatalog}>カタログで探す…</button>}
            </div>
        </div>
        <div className='akari-channel-sheet-actions'>
            <button type='button' className='theia-button secondary' data-akari-wizard-partner onClick={() => props.onPartner(answers)}>面倒なら、パートナーと話して作る</button>
            <button type='button' className='theia-button main' data-akari-wizard-create disabled={!hasAnswer}
                onClick={() => props.onCreate(buildChannelMarkdown(answers, props.channelName, appliedType, props.rest))}>この答えで作る</button>
        </div>
    </HomeScrim>;
}

export function ChannelDesignView(props: {
    fileName: string; text: string; onRedesign: () => void; onOpenFile: () => void; onPartner: () => void; onClose: () => void;
    onCatalog?: () => void; banner?: React.ReactNode; onHelper?: () => void;
}): React.ReactElement {
    return <HomeScrim kind='channel-design-view' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}</style>
        <h3>チャンネル設計</h3>{props.banner}<p>{props.fileName} の中身です。</p>
        {splitMarkdownSections(props.text).map((section, index) => <section className='akari-channel-sheet-section' key={`${section.heading}-${index}`}>
            {section.heading && <h4>{section.heading}</h4>}
            {section.body.split('\n').map((line, lineIndex) => <div key={lineIndex}>{line || '\u00a0'}</div>)}
        </section>)}
        <div className='akari-channel-sheet-actions'>
            {props.onHelper && <button type='button' className='theia-button secondary' data-akari-design-helper onClick={props.onHelper}>過去の動画からヘルパーに書いてもらう</button>}
            {props.onCatalog && <button type='button' className='theia-button secondary' data-akari-design-catalog
                onClick={props.onCatalog}>型を見る・当て直す…</button>}
            <button type='button' className='theia-button secondary' data-akari-design-redesign onClick={props.onRedesign}>設計し直す</button>
            <button type='button' className='theia-button secondary' onClick={props.onOpenFile}>ファイルを開く</button>
            <button type='button' className='theia-button main' onClick={props.onPartner}>パートナーと深掘り</button>
        </div>
    </HomeScrim>;
}

export function ChannelDesignStart(props: { onFromType: () => void; onFromQuestions: () => void; onClose: () => void }): React.ReactElement {
    return <HomeScrim kind='channel-design-start' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}</style>
        <h3>チャンネル設計</h3>
        <p>channel.md がまだ空です</p>
        <p>チャンネルの型から始めると、設計・デザイン・辞書・スキル・ライブラリの下書きがまとめて入ります。</p>
        <div className='akari-channel-sheet-actions'>
            <button type='button' className='theia-button main' data-akari-design-start-type onClick={props.onFromType}>チャンネルの型から作る</button>
            <button type='button' className='theia-button secondary' data-akari-design-start-questions onClick={props.onFromQuestions}>選ぶだけの質問から作る</button>
        </div>
    </HomeScrim>;
}
