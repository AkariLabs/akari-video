import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { DESIGN_SECTION_HEADINGS, DESIGN_SECTION_PLACEHOLDERS, DesignMdValues, buildDesignMd } from './design-md-model';

const COLOR_FIELDS = [['main', 'メインの色'], ['sub', 'サブの色'], ['text', '文字の色'], ['background', '背景の色']] as const;
const FONT_FIELDS = [['heading', '見出しの文字'], ['body', '本文の文字']] as const;

export function DesignMdForm(props: {
    channelName: string; initial: DesignMdValues; onSave: (text: string) => void; onOpenFile: (text: string) => void; onClose: () => void;
}): React.ReactElement {
    const [values, setValues] = React.useState<DesignMdValues>(props.initial);
    const [newHeading, setNewHeading] = React.useState('');
    const [addingHeading, setAddingHeading] = React.useState(false);
    const updateColor = (key: keyof DesignMdValues['colors'], value: string): void =>
        setValues(previous => ({ ...previous, colors: { ...previous.colors, [key]: value } }));
    const updateFont = (key: keyof DesignMdValues['fonts'], value: string): void =>
        setValues(previous => ({ ...previous, fonts: { ...previous.fonts, [key]: value } }));
    const addHeading = (): void => {
        const heading = newHeading.trim();
        if (heading && !values.sections.some(section => section.heading === heading)) {
            setValues(previous => ({ ...previous, sections: [...previous.sections, { heading, body: '' }] }));
            setNewHeading('');
            setAddingHeading(false);
        }
    };
    const sections = [...DESIGN_SECTION_HEADINGS.map(heading => values.sections.find(section => section.heading === heading) ?? { heading, body: '' }),
        ...values.sections.filter(section => !(DESIGN_SECTION_HEADINGS as readonly string[]).includes(section.heading))];
    return <HomeScrim kind='channel-design-form' onClose={props.onClose}>
        <style>{homePanelCss}{channelSheetCss}</style>
        <h3>デザイン</h3>
        <p>動画の見た目の決まりを、文章で書きます。頭の数行（色と文字の値）だけは機械も読みます。</p>
        <div className='akari-channel-form-fields'>
            {COLOR_FIELDS.map(([key, label]) => <div className='akari-channel-form-row' key={key}>
                <label htmlFor={`akari-channel-color-${key}`}>{label}</label>
                <input type='color' aria-label={`${label}を選ぶ`} value={/^#[0-9a-fA-F]{6}$/.test(values.colors[key]) ? values.colors[key] : '#000000'}
                    onChange={event => updateColor(key, event.currentTarget.value)} />
                <input id={`akari-channel-color-${key}`} type='text' data-akari-design-color={key} value={values.colors[key]}
                    onChange={event => updateColor(key, event.currentTarget.value)} />
            </div>)}
            {FONT_FIELDS.map(([key, label]) => <div className='akari-channel-form-row' key={key}>
                <label htmlFor={`akari-channel-font-${key}`}>{label}</label>
                <input id={`akari-channel-font-${key}`} type='text' data-akari-design-font={key} value={values.fonts[key]}
                    onChange={event => updateFont(key, event.currentTarget.value)} />
            </div>)}
            {sections.map(section => <div className='akari-channel-form-section' key={section.heading}>
                <label htmlFor={`akari-channel-section-${section.heading}`}>{section.heading}</label>
                <textarea id={`akari-channel-section-${section.heading}`} rows={3} data-akari-design-section={section.heading}
                    placeholder={DESIGN_SECTION_PLACEHOLDERS[DESIGN_SECTION_HEADINGS.indexOf(section.heading as typeof DESIGN_SECTION_HEADINGS[number])] ?? ''}
                    value={section.body} onChange={event => {
                        const body = event.currentTarget.value;
                        setValues(previous => ({ ...previous, sections: previous.sections.some(item => item.heading === section.heading)
                            ? previous.sections.map(item => item.heading === section.heading ? { ...item, body } : item)
                            : [...previous.sections, { heading: section.heading, body }] }));
                    }} />
            </div>)}
        </div>
        <div className='akari-channel-form-add'>
            {!addingHeading ? <button type='button' className='theia-button secondary' onClick={() => setAddingHeading(true)}>見出しを足す</button> : <>
                <input value={newHeading} placeholder='画面の余白 など' onChange={event => setNewHeading(event.currentTarget.value)}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addHeading(); } }} />
                <button type='button' className='theia-button secondary' onClick={addHeading}>足す</button>
            </>}
        </div>
        <div className='akari-channel-sheet-actions'>
            <button type='button' className='theia-button secondary' onClick={() => props.onOpenFile(buildDesignMd(values, props.channelName))}>ファイルを開く</button>
            <button type='button' className='theia-button main' data-akari-design-save
                onClick={() => props.onSave(buildDesignMd(values, props.channelName))}>保存する</button>
        </div>
    </HomeScrim>;
}
