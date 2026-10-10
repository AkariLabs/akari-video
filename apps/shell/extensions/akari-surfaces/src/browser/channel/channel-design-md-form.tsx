import * as React from '@theia/core/shared/react';
import { HomeScrim, homePanelCss } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { DESIGN_ASSET_ROLES, DESIGN_ASSET_ROLE_LABELS, DESIGN_SECTION_HEADINGS, DESIGN_SECTION_PLACEHOLDERS,
    DesignAsset, DesignAssetRole, DesignMdValues, buildDesignMd, isDesignImageFile } from './design-md-model';

const COLOR_FIELDS = [['main', 'メインの色'], ['sub', 'サブの色'], ['text', '文字の色'], ['background', '背景の色']] as const;
const FONT_FIELDS = [['heading', '見出しの文字'], ['body', '本文の文字']] as const;
const assetCss = `
.akari-design-assets { display:grid; gap:9px; border-top:1px solid var(--theia-widget-border); padding-top:14px; font-size:12px; }
.akari-design-assets-heading,.akari-design-assets-add,.akari-design-asset-row,.akari-design-asset-confirm { display:flex; align-items:center; gap:8px; }
.akari-design-assets-heading { justify-content:space-between; }
.akari-design-assets-heading h4 { margin:0; font-size:13px; }
.akari-design-assets p { margin:0; color:var(--theia-descriptionForeground); line-height:1.5; }
.akari-design-asset-row { flex-wrap:wrap; border:1px solid var(--theia-widget-border); border-radius:7px; padding:8px; }
.akari-design-asset-thumb { display:grid; place-items:center; width:48px; height:48px; flex:0 0 48px; overflow:hidden; background:var(--theia-editor-background); font-size:11px; }
.akari-design-asset-thumb img { width:100%; height:100%; object-fit:contain; }
.akari-design-asset-name { min-width:90px; flex:1 1 90px; overflow-wrap:anywhere; }
.akari-design-asset-row input { min-width:100px; flex:1 1 120px; }
.akari-design-asset-confirm { width:100%; flex-wrap:wrap; }
.akari-home-sheet-scrim[data-akari-home-dialog=channel-design-form] .akari-home-sheet { scroll-padding-bottom:88px; }
`;

export function DesignMdForm(props: {
    channelName: string; initial: DesignMdValues; onSave: (text: string) => void; onOpenFile: (text: string) => void; onClose: () => void;
    onHelper?: () => void;
    assetUrl?: (file: string) => string;
    onAddAsset?: (role: DesignAssetRole, file: File) => Promise<DesignAsset | undefined>;
    onRemoveAssetFile?: (file: string) => Promise<void>;
    onRevealFolder?: () => void;
}): React.ReactElement {
    const [values, setValues] = React.useState<DesignMdValues>(props.initial);
    const [newHeading, setNewHeading] = React.useState('');
    const [addingHeading, setAddingHeading] = React.useState(false);
    const [assetRole, setAssetRole] = React.useState<DesignAssetRole>('logo');
    const [removingAsset, setRemovingAsset] = React.useState<number | undefined>(undefined);
    const assetInput = React.useRef<HTMLInputElement>(null);
    const assetConfirm = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (removingAsset === undefined) return;
        assetConfirm.current?.scrollIntoView({ block: 'nearest' });
        assetConfirm.current?.querySelector('button')?.focus({ preventScroll: true });
    }, [removingAsset]);
    const changeAsset = (index: number, change: Partial<DesignAsset>): void =>
        setValues(previous => ({ ...previous, assets: previous.assets.map((asset, at) => at === index ? { ...asset, ...change } : asset) }));
    const removeAsset = async (index: number, deleteFile: boolean): Promise<void> => {
        const asset = values.assets[index];
        if (!asset) return;
        if (deleteFile && props.onRemoveAssetFile) {
            try { await props.onRemoveAssetFile(asset.file); }
            catch { return; }
        }
        setValues(previous => ({ ...previous, assets: previous.assets.filter((_, at) => at !== index) }));
        setRemovingAsset(undefined);
    };
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
        <style>{homePanelCss}{channelSheetCss}{assetCss}</style>
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
            <div className='akari-design-assets'>
                <div className='akari-design-assets-heading'><h4>ロゴ・画像</h4>
                    {props.onRevealFolder && <button type='button' className='theia-button secondary' data-akari-design-asset-folder onClick={props.onRevealFolder}>フォルダを開く</button>}
                </div>
                <p>ロゴや参考画像は design/ に置きます。パートナーはここを読んで見た目を合わせます。</p>
                {props.onAddAsset && <div className='akari-design-assets-add'>
                    <select aria-label='足す素材の役割' value={assetRole} onChange={event => setAssetRole(event.currentTarget.value as DesignAssetRole)}>
                        {DESIGN_ASSET_ROLES.map(role => <option key={role} value={role}>{DESIGN_ASSET_ROLE_LABELS[role]}</option>)}
                    </select>
                    <button type='button' className='theia-button secondary' data-akari-design-asset-add onClick={() => assetInput.current?.click()}>足す…</button>
                    <input ref={assetInput} type='file' hidden data-akari-design-asset-input accept='.png,.jpg,.jpeg,.svg,.webp,.ttf,.otf,.woff2'
                        onChange={async event => {
                            const input = event.currentTarget;
                            const file = input.files?.[0];
                            input.value = '';
                            if (!file || !props.onAddAsset) return;
                            const asset = await props.onAddAsset(assetRole, file);
                            if (asset) setValues(previous => ({ ...previous, assets: [...previous.assets, asset] }));
                        }} />
                </div>}
                {values.assets.map((asset, index) => <div className='akari-design-asset-row' data-akari-design-asset-row key={`${asset.file}-${index}`}>
                    <div className='akari-design-asset-thumb'>{isDesignImageFile(asset.file) && props.assetUrl
                        ? <img src={props.assetUrl(asset.file)} alt='' /> : <span>{asset.role === 'font' ? '文字' : '素材'}</span>}</div>
                    <span className='akari-design-asset-name'>{asset.file.split('/').pop()}</span>
                    <select aria-label='素材の役割' value={asset.role} onChange={event => changeAsset(index, { role: event.currentTarget.value as DesignAssetRole })}>
                        {DESIGN_ASSET_ROLES.map(role => <option key={role} value={role}>{DESIGN_ASSET_ROLE_LABELS[role]}</option>)}
                    </select>
                    <input type='text' data-akari-design-asset-note aria-label='素材のメモ' placeholder='メモ' value={asset.note}
                        onChange={event => changeAsset(index, { note: event.currentTarget.value })} />
                    <button type='button' className='theia-button secondary' onClick={() => setRemovingAsset(index)}>外す</button>
                    {removingAsset === index && <div className='akari-design-asset-confirm' ref={assetConfirm}>
                        {props.onRemoveAssetFile && <button type='button' className='theia-button secondary' onClick={() => void removeAsset(index, true)}>ファイルも消す</button>}
                        <button type='button' className='theia-button secondary' onClick={() => void removeAsset(index, false)}>一覧から外すだけ</button>
                        <button type='button' className='theia-button secondary' onClick={() => setRemovingAsset(undefined)}>やめる</button>
                    </div>}
                </div>)}
            </div>
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
            {props.onHelper && <button type='button' className='theia-button secondary' data-akari-design-helper onClick={props.onHelper}>過去の動画からヘルパーに書いてもらう</button>}
        </div>
        <div className='akari-channel-sheet-actions'>
            <button type='button' className='theia-button secondary' onClick={() => props.onOpenFile(buildDesignMd(values, props.channelName))}>ファイルを開く</button>
            <button type='button' className='theia-button main' data-akari-design-save
                onClick={() => props.onSave(buildDesignMd(values, props.channelName))}>保存する</button>
        </div>
    </HomeScrim>;
}
