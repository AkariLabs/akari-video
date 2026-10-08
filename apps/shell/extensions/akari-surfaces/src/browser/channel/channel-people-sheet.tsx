import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { HomeScrim } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { ChannelMemoryFiles } from './channel-memory-files';
import { addPerson, AVATAR_CAPS, defaultScene, filterPeople, initialOf, mergeAliasesIntoWordBook,
    peopleCounts, PeopleFile, PersonKind, PERSON_KIND_LABELS, removePeople, splitAliases, summarizeNames } from './channel-people-model';

const STYLE_ID = 'akari-channel-people-style';
const CSS = `
.akari-home-sheet-scrim[data-akari-home-dialog=channel-people] .akari-home-sheet{width:min(880px,95vw)}
.akari-people-actions,.akari-people-selection,.akari-people-form-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:14px 0}
.akari-people-actions button,.akari-people-selection button,.akari-people-form-actions button,.akari-people-confirm button{border:1px solid var(--theia-widget-border);border-radius:6px;padding:7px 10px;background:var(--theia-button-secondaryBackground);color:var(--theia-button-secondaryForeground);cursor:pointer}
.akari-people-actions button:first-child,.akari-people-form-actions button:first-child{background:var(--theia-button-background);color:var(--theia-button-foreground)}
.akari-people-actions button:disabled,.akari-people-form-actions button:disabled{opacity:.5;cursor:default}
.akari-people-layout{display:grid;grid-template-columns:minmax(150px,190px) minmax(0,1fr);gap:18px}
.akari-people-filters{display:flex;flex-direction:column;gap:3px;border-right:1px solid var(--theia-widget-border);padding-right:13px}
.akari-people-filters h4{margin:10px 0 5px;font-size:12px;color:var(--theia-descriptionForeground)}
.akari-people-filters button{display:flex;justify-content:space-between;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--theia-foreground);padding:7px;text-align:left;cursor:pointer}
.akari-people-filters button[aria-pressed=true]{background:var(--theia-list-activeSelectionBackground)}
.akari-people-filters small,.akari-people-row small{color:var(--theia-descriptionForeground)}
.akari-people-list{min-width:0}
.akari-people-row{display:flex;gap:10px;align-items:flex-start;border-bottom:1px solid var(--theia-widget-border);padding:10px 0}
.akari-people-row input[type=checkbox]{margin-top:12px}
.akari-people-image{flex:0 0 42px;width:42px;height:42px;border-radius:7px;display:grid;place-items:center;object-fit:cover;background:var(--theia-editor-background);border:1px solid var(--theia-widget-border);font-size:20px}
.akari-people-row-body{min-width:0;flex:1;display:grid;gap:3px}
.akari-people-row-body>div{display:flex;flex-wrap:wrap;align-items:baseline;gap:7px}
.akari-people-row-body span,.akari-people-row-body small{overflow-wrap:anywhere}
.akari-people-remove{border:0;background:transparent;color:var(--theia-descriptionForeground);cursor:pointer;font-size:19px}
.akari-people-note{margin-top:16px!important}
.akari-people-confirm{border:1px solid var(--theia-widget-border);border-radius:8px;background:var(--theia-editor-background);padding:12px;margin:10px 0;display:grid;gap:9px}
.akari-people-confirm p{margin:0!important}
.akari-people-confirm>div{display:flex;gap:8px}
.akari-people-form{display:grid;grid-template-columns:1fr 1fr;gap:11px 14px}
.akari-people-form label{display:grid;gap:5px;font-size:12px}
.akari-people-form input:not([type=checkbox]),.akari-people-form select,.akari-people-form textarea{box-sizing:border-box;width:100%}
.akari-people-form textarea{min-height:65px;resize:vertical}
.akari-people-wide{grid-column:1/-1}
.akari-people-caps{display:flex;flex-wrap:wrap;gap:12px}
.akari-people-caps label,.akari-people-wordbook{display:flex!important;align-items:center;gap:5px}
.akari-people-error{color:var(--theia-errorForeground)!important;margin:8px 0!important}
@media(max-width:650px){.akari-people-layout{grid-template-columns:1fr}.akari-people-filters{border-right:0;border-bottom:1px solid var(--theia-widget-border);padding:0 0 8px;flex-direction:row;flex-wrap:wrap}.akari-people-filters h4{width:100%}.akari-people-form{grid-template-columns:1fr}}
`;

export function ChannelPeopleSheet(props: { channel: string; dir: URI; files: ChannelMemoryFiles; onClose: () => void;
    onOpenPacks: () => void; onTypePrompt: (text: string) => void; onChanged?: () => void; packsImported?: number }): React.ReactElement {
    const [file, setFile] = React.useState<PeopleFile>({ version: 0, entries: [] });
    const [kindFilter, setKindFilter] = React.useState<PersonKind | 'all'>('all');
    const [sourceFilter, setSourceFilter] = React.useState<string>('all');
    const [selected, setSelected] = React.useState<string[]>([]);
    const [confirmIds, setConfirmIds] = React.useState<string[]>([]);
    const [adding, setAdding] = React.useState(false);
    const [kind, setKind] = React.useState<PersonKind>('person');
    const [name, setName] = React.useState('');
    const [reading, setReading] = React.useState('');
    const [aliases, setAliases] = React.useState('');
    const [role, setRole] = React.useState('');
    const [scene, setScene] = React.useState(defaultScene('person'));
    const [sceneEdited, setSceneEdited] = React.useState(false);
    const [imageFile, setImageFile] = React.useState<File | undefined>();
    const [caps, setCaps] = React.useState<string[]>([]);
    const [addToBook, setAddToBook] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');

    React.useEffect(() => {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }, []);
    React.useEffect(() => {
        let active = true;
        setFile({ version: 0, entries: [] });
        setSelected([]);
        setConfirmIds([]);
        setSourceFilter('all');
        setKindFilter('all');
        void props.files.readPeople(props.dir).then(value => { if (active) setFile(value); });
        return () => { active = false; };
    }, [props.dir.toString(), props.files]);

    const counts = peopleCounts(file);
    const shown = filterPeople(file, { kind: kindFilter, source: sourceFilter });
    const selectedSet = new Set(selected);
    const confirmEntries = file.entries.filter(entry => confirmIds.includes(entry.id));

    const deleteConfirmed = async (): Promise<void> => {
        setBusy(true);
        setError('');
        try {
            const next = removePeople(file, confirmIds);
            await props.files.writePeople(props.dir, next);
            setFile(next);
            setSelected([]);
            setConfirmIds([]);
            props.onChanged?.();
        } catch { setError('消せませんでした。もう一度お試しください。'); }
        finally { setBusy(false); }
    };

    const save = async (): Promise<void> => {
        const cleanName = name.trim();
        if (!cleanName || busy) return;
        setBusy(true);
        setError('');
        try {
            const split = splitAliases(aliases);
            const result = addPerson(file, { kind, name: cleanName, reading: reading.trim() || undefined, aliases: split,
                role: role.trim() || undefined, scene: scene.trim() || undefined, caps: kind === 'avatar' ? caps : undefined });
            if (imageFile) {
                const ext = imageFile.name.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || 'png';
                const image = `people/${result.entry.id}.${ext}`;
                await props.files.copyInto(imageFile, props.dir.resolve(image));
                result.entry.image = image;
            }
            await props.files.writePeople(props.dir, result.file);
            setFile(result.file);
            props.onChanged?.();
            if (addToBook) {
                const book = await props.files.readWordBook(props.dir);
                await props.files.writeWordBook(props.dir, mergeAliasesIntoWordBook(book, cleanName, split, 'people'));
                props.onChanged?.();
            }
            setAdding(false);
            setName(''); setReading(''); setAliases(''); setRole(''); setKind('person');
            setScene(defaultScene('person')); setSceneEdited(false); setImageFile(undefined); setCaps([]); setAddToBook(true);
        } catch { setError('保存できませんでした。内容を確かめてもう一度お試しください。'); }
        finally { setBusy(false); }
    };

    return <HomeScrim kind='channel-people' onClose={props.onClose}>
        <style>{channelSheetCss}</style>
        <h3>{adding ? '人とモノを足す' : '人とモノ'}</h3>
        {!adding ? <>
            <p>動画に出てくる人・キャラクター・会社や製品です。名前と写真（ロゴ）を登録しておくと、文字起こしの直し・テロップの名前・画像を入れる場面で使われます。</p>
            <div className='akari-people-actions'>
                <button type='button' data-akari-people-add onClick={() => { setAdding(true); setError(''); }}>足す…</button>
                <button type='button' data-akari-people-packs onClick={props.onOpenPacks}>記憶パックを探す</button>
                <button type='button' data-akari-people-find onClick={() => props.onTypePrompt('このチャンネルの動画に出てくる人と会社を見つけて、人とモノの候補にして')}>動画から見つけてもらう</button>
            </div>
            <div className='akari-people-layout'>
                <aside className='akari-people-filters'>
                    <h4>種類</h4>
                    {([['all', 'すべて', counts.all], ...(['person', 'avatar', 'org'] as PersonKind[]).map(value => [value, PERSON_KIND_LABELS[value], counts.byKind[value]])] as Array<[PersonKind | 'all', string, number]>).map(([value, label, count]) =>
                        <button type='button' key={value} aria-pressed={kindFilter === value} onClick={() => setKindFilter(value)}><span>{label}</span><small>{count}</small></button>)}
                    <h4>出どころ</h4>
                    <button type='button' aria-pressed={sourceFilter === 'all'} onClick={() => setSourceFilter('all')}><span>すべて</span><small>{counts.all}</small></button>
                    {counts.bySource.map(source => <button type='button' key={source.key} aria-pressed={sourceFilter === source.key}
                        onClick={() => setSourceFilter(source.key)}><span>{source.label}</span><small>{source.count}</small></button>)}
                </aside>
                <div className='akari-people-list'>
                    <div className='akari-people-selection'>{selected.length ? <><span>{selected.length} 件を選択中</span>
                        <button type='button' disabled={busy} onClick={() => setConfirmIds(selected)}>選んだものを消す</button>
                        <button type='button' onClick={() => { setSelected([]); setConfirmIds([]); }}>選ぶのをやめる</button></>
                        : <button type='button' disabled={!shown.length} onClick={() => setSelected(shown.map(entry => entry.id))}>すべて選ぶ</button>}</div>
                    {confirmIds.length > 0 && <div className='akari-people-confirm'>
                        <strong>{confirmEntries.length} 件を消しますか？</strong>
                        <p>{summarizeNames(confirmEntries.map(entry => entry.name))}</p>
                        <div><button type='button' disabled={busy} onClick={() => void deleteConfirmed()}>{confirmEntries.length} 件を消す</button>
                            <button type='button' onClick={() => setConfirmIds([])}>やめる</button></div>
                    </div>}
                    {shown.length ? shown.map(entry => <div className='akari-people-row' key={entry.id}>
                        <input type='checkbox' aria-label={`${entry.name}を選ぶ`} checked={selectedSet.has(entry.id)} onChange={event => {
                            setSelected(event.target.checked ? [...selected, entry.id] : selected.filter(id => id !== entry.id)); setConfirmIds([]);
                        }} />
                        {entry.image ? <img className='akari-people-image' src={props.dir.resolve(entry.image).toString()} alt='' />
                            : <span className='akari-people-image' aria-hidden='true'>{initialOf(entry.name)}</span>}
                        <div className='akari-people-row-body'><div><strong>{entry.name}</strong><small>{PERSON_KIND_LABELS[entry.kind]}</small>
                            {entry.pack && <small>☆{entry.pack}</small>}</div>
                            {entry.role && <span>{entry.role}</span>}
                            {entry.aliases.length > 0 && <small>別名: {entry.aliases.join('、')}</small>}
                            {entry.scene && <small>使う場面: {entry.scene}</small>}</div>
                        <button type='button' className='akari-people-remove' aria-label={`${entry.name}を消す`} onClick={() => setConfirmIds([entry.id])}>×</button>
                    </div>) : <p>まだ登録されていません。</p>}
                </div>
            </div>
            <p className='akari-people-note'>別名は辞書の「言い換え」にもつながります。パックから入ったものも 1 件ずつ消せます。</p>
        </> : <>
            <p>名前や画像を登録すると、このチャンネルの動画で使えます。</p>
            <div className='akari-people-form'>
                <label>種類<select value={kind} onChange={event => { const next = event.target.value as PersonKind; setKind(next); if (!sceneEdited) setScene(defaultScene(next)); }}>
                    {(['person', 'avatar', 'org'] as PersonKind[]).map(value => <option key={value} value={value}>{PERSON_KIND_LABELS[value]}</option>)}</select></label>
                <label>名前<input value={name} onChange={event => setName(event.target.value)} /></label>
                <label>読み<input value={reading} onChange={event => setReading(event.target.value)} /></label>
                <label>別名（カンマ区切り）<input value={aliases} onChange={event => setAliases(event.target.value)} /></label>
                <label>役割<input value={role} onChange={event => setRole(event.target.value)} /></label>
                <label>写真・ロゴ<input type='file' accept='image/*' onChange={event => setImageFile(event.target.files?.[0])} /></label>
                <label className='akari-people-wide'>使う場面<textarea value={scene} onChange={event => { setScene(event.target.value); setSceneEdited(true); }} /></label>
                {kind === 'avatar' && <div className='akari-people-wide'><strong>使えること</strong><div className='akari-people-caps'>{AVATAR_CAPS.map(cap =>
                    <label key={cap.id}><input type='checkbox' checked={caps.includes(cap.id)} onChange={event => setCaps(event.target.checked ? [...caps, cap.id] : caps.filter(id => id !== cap.id))} />{cap.label}</label>)}</div></div>}
                <label className='akari-people-wide akari-people-wordbook'><input type='checkbox' checked={addToBook} onChange={event => setAddToBook(event.target.checked)} />別名を辞書の言い換えにも入れる</label>
            </div>
            <div className='akari-people-form-actions'><button type='button' disabled={!name.trim() || busy} onClick={() => void save()}>保存</button>
                <button type='button' onClick={() => { setAdding(false); setError(''); }}>やめる</button></div>
        </>}
        {error && <p className='akari-people-error' role='alert'>{error}</p>}
    </HomeScrim>;
}
