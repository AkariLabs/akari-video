import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { HomeScrim } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { ChannelMemoryFiles } from './channel-memory-files';
import { WordBookEntry, WordBookFile } from './channel-people-model';
import { addInfo, addRule, addWordEntry, applyPreparedInfos, applyPreparedRules, applyPreparedWords,
    emptyNotesFile, filterWordEntries, INFO_KIND_LABELS, InfoEntry, InfoKind, NotesFile, PREPARED_INFOS,
    PREPARED_RULES, PREPARED_WORDS, removeInfo, removeRule, removeWordEntry, RULE_AREA_LABELS, RuleArea,
    updateInfo, updateRule, updateWordEntry, WORD_KIND_LABELS, wordEntryLabel, wordSourceOptions } from './channel-notes-model';

type Tab = 'words' | 'infos' | 'rules';
type WordKind = WordBookEntry['kind'];
const STYLE_ID = 'akari-channel-notes-style';
const CSS = `
.akari-home-sheet-scrim[data-akari-home-dialog=channel-notes] .akari-home-sheet{width:min(880px,95vw)}
.akari-notes-actions,.akari-notes-tabs,.akari-notes-form-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:14px 0}
.akari-notes-actions button,.akari-notes-tabs button,.akari-notes-form-actions button,.akari-notes-menu button,.akari-notes-row button{border:1px solid var(--theia-widget-border);border-radius:6px;padding:7px 10px;background:var(--theia-button-secondaryBackground);color:var(--theia-button-secondaryForeground);cursor:pointer}
.akari-notes-actions button:first-child,.akari-notes-form-actions button:first-child{background:var(--theia-button-background);color:var(--theia-button-foreground)}
.akari-notes-actions button:disabled,.akari-notes-form-actions button:disabled,.akari-notes-row button:disabled{opacity:.5;cursor:default}
.akari-notes-menu{display:grid;gap:3px;width:max-content;max-width:100%;padding:8px;border:1px solid var(--theia-widget-border);border-radius:7px;background:var(--theia-editor-background)}
.akari-notes-menu button{text-align:left}.akari-notes-menu hr{width:100%;border:0;border-top:1px solid var(--theia-widget-border)}
.akari-notes-tabs button[aria-selected=true],.akari-notes-filters button[aria-pressed=true]{background:var(--theia-list-activeSelectionBackground)}
.akari-notes-tabs small{font-size:11px;opacity:.65;margin-left:5px}
.akari-notes-layout{display:grid;grid-template-columns:minmax(150px,190px) minmax(0,1fr);gap:18px}
.akari-notes-filters{display:flex;flex-direction:column;gap:3px;border-right:1px solid var(--theia-widget-border);padding-right:13px}
.akari-notes-filters h4{margin:10px 0 5px;font-size:12px;color:var(--theia-descriptionForeground)}
.akari-notes-filters button{display:flex;justify-content:space-between;gap:8px;border:0;border-radius:6px;background:transparent;color:var(--theia-foreground);padding:7px;text-align:left;cursor:pointer}
.akari-notes-filters small{color:var(--theia-descriptionForeground)}
.akari-notes-list{min-width:0;overflow-x:auto}
.akari-notes-table{width:100%;border-collapse:collapse;table-layout:fixed}
.akari-notes-table th,.akari-notes-table td{border-bottom:1px solid var(--theia-widget-border);padding:8px 5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.akari-notes-table th{font-size:12px;color:var(--theia-descriptionForeground)}
.akari-notes-table td:last-child,.akari-notes-table th:last-child{width:32px}
.akari-notes-table tr[data-editable=true]{cursor:pointer}
.akari-notes-table tr[data-editable=true]:hover{background:var(--theia-list-hoverBackground)}
.akari-notes-muted{opacity:.55}
.akari-notes-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:15px}
.akari-notes-form label,.akari-notes-edit label{display:grid;gap:4px;font-size:12px}
.akari-notes-form input,.akari-notes-form select,.akari-notes-form textarea,.akari-notes-edit input,.akari-notes-edit select,.akari-notes-edit textarea{box-sizing:border-box;width:100%}
.akari-notes-form textarea,.akari-notes-edit textarea{min-height:60px;resize:vertical}
.akari-notes-wide{grid-column:1/-1}
.akari-notes-edit{display:grid;gap:7px}
.akari-notes-edit>div{display:flex;gap:6px}
.akari-notes-note{margin-top:16px!important;color:var(--theia-descriptionForeground)}
.akari-notes-error{color:var(--theia-errorForeground)!important}
@media(max-width:650px){.akari-notes-layout{grid-template-columns:1fr}.akari-notes-filters{border-right:0;border-bottom:1px solid var(--theia-widget-border);padding:0 0 8px;flex-direction:row;flex-wrap:wrap}.akari-notes-filters h4{width:100%}.akari-notes-form{grid-template-columns:1fr}}
`;

const splitVariants = (value: string): string[] => value.split(/[,、，]/).map(item => item.trim()).filter(Boolean);

export function ChannelNotesSheet(props: { channel: string; dir: URI; files: ChannelMemoryFiles; onClose: () => void;
    onOpenPacks: () => void; onTypePrompt: (text: string) => void; onChanged?: () => void;
    initialTab?: Tab }): React.ReactElement {
    const [tab, setTab] = React.useState<Tab>(props.initialTab || 'words');
    const [book, setBook] = React.useState<WordBookFile>({ version: 0, entries: [] });
    const [file, setFile] = React.useState<NotesFile>(emptyNotesFile());
    const [source, setSource] = React.useState('all');
    const [menu, setMenu] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [editing, setEditing] = React.useState('');
    const [heard, setHeard] = React.useState('');
    const [surface, setSurface] = React.useState('');
    const [wordKind, setWordKind] = React.useState<WordKind>('term');
    const [infoKind, setInfoKind] = React.useState<InfoKind>('link');
    const [name, setName] = React.useState('');
    const [body, setBody] = React.useState('');
    const [when, setWhen] = React.useState('');
    const [area, setArea] = React.useState<RuleArea>('caption');
    const [ruleText, setRuleText] = React.useState('');

    React.useEffect(() => {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style'); style.id = STYLE_ID; style.textContent = CSS; document.head.appendChild(style);
    }, []);
    React.useEffect(() => {
        let active = true;
        void Promise.all([props.files.readWordBook(props.dir), props.files.readNotes(props.dir)]).then(([nextBook, nextFile]) => {
            if (active) { setBook(nextBook); setFile(nextFile); }
        }).catch(() => { if (active) setError('読み込めませんでした。もう一度開いてください。'); });
        return () => { active = false; };
    }, [props.dir.toString(), props.files]);

    const saveBook = async (next: WordBookFile): Promise<boolean> => {
        if (busy) return false;
        setBusy(true); setError('');
        try { await props.files.writeWordBook(props.dir, next); setBook(next); props.onChanged?.(); return true; }
        catch { setError('保存できませんでした。もう一度お試しください。'); return false; }
        finally { setBusy(false); }
    };
    const saveNotes = async (next: NotesFile): Promise<boolean> => {
        if (busy) return false;
        setBusy(true); setError('');
        try { await props.files.writeNotes(props.dir, next); setFile(next); props.onChanged?.(); return true; }
        catch { setError('保存できませんでした。もう一度お試しください。'); return false; }
        finally { setBusy(false); }
    };
    const reset = (): void => { setEditing(''); setHeard(''); setSurface(''); setWordKind('term');
        setInfoKind('link'); setName(''); setBody(''); setWhen(''); setArea('caption'); setRuleText(''); };
    const beginWord = (entry: WordBookEntry, index: number): void => { setEditing(`w:${index}`); setHeard((entry.variants || []).join('、'));
        setSurface(entry.surface); setWordKind(entry.kind); };
    const beginInfo = (entry: InfoEntry): void => { setEditing(`i:${entry.id}`); setInfoKind(entry.kind);
        setName(entry.name); setBody(entry.body); setWhen(entry.when); };
    const beginRule = (entry: { id: string; area: RuleArea; text: string }): void => { setEditing(`r:${entry.id}`);
        setArea(entry.area); setRuleText(entry.text); };
    const saveWord = async (index?: number): Promise<void> => {
        if (!surface.trim()) return;
        const next = index === undefined ? addWordEntry(book, { surface, variants: splitVariants(heard), kind: wordKind, source: 'manual' })
            : updateWordEntry(book, index, { surface, variants: splitVariants(heard), kind: wordKind });
        if (await saveBook(next)) reset();
    };
    const saveInfo = async (id?: string): Promise<void> => {
        if (!name.trim() || !body.trim()) return;
        const input = { kind: infoKind, name: name.trim(), body: body.trim(), when: when.trim() };
        const next = id ? updateInfo(file, id, input) : addInfo(file, input);
        if (await saveNotes(next)) reset();
    };
    const saveRule = async (id?: string): Promise<void> => {
        if (!ruleText.trim()) return;
        const input = { area, text: ruleText.trim() };
        const next = id ? updateRule(file, id, input) : addRule(file, input);
        if (await saveNotes(next)) reset();
    };
    const apply = async (pack: typeof PREPARED_WORDS[number] | typeof PREPARED_INFOS[number] | typeof PREPARED_RULES[number]): Promise<void> => {
        let added = 0;
        let saved = false;
        if (tab === 'words') { const result = applyPreparedWords(book, pack as typeof PREPARED_WORDS[number]);
            added = result.added; saved = await saveBook(result.book); }
        else if (tab === 'infos') { const result = applyPreparedInfos(file, pack as typeof PREPARED_INFOS[number]);
            added = result.added; saved = await saveNotes(result.file); }
        else { const result = applyPreparedRules(file, pack as typeof PREPARED_RULES[number]);
            added = result.added; saved = await saveNotes(result.file); }
        if (saved) setMessage(`『${pack.name}』から ${added} 件足しました。直して使えます`);
        setMenu(false);
    };
    const packs = tab === 'words' ? PREPARED_WORDS : tab === 'infos' ? PREPARED_INFOS : PREPARED_RULES;
    const options = wordSourceOptions(book);
    const shownWords = filterWordEntries(book, source);
    const tabItems: Array<{ id: Tab; label: string; count: number }> = [
        { id: 'words', label: '言い換え', count: book.entries.length },
        { id: 'infos', label: 'よく使う情報', count: file.infos.length },
        { id: 'rules', label: '決まりごと', count: file.rules.length }
    ];
    const wordFields = <><label>聞こえ方（カンマ区切り）<input value={heard} onChange={event => setHeard(event.target.value)} /></label>
        <label>直したあと<input value={surface} onChange={event => setSurface(event.target.value)} /></label>
        <label>メモ<select value={wordKind} onChange={event => setWordKind(event.target.value as WordKind)}>
            {(['term', 'notation', 'reading-only'] as WordKind[]).map(kind => <option key={kind} value={kind}>{WORD_KIND_LABELS[kind]}</option>)}
            {wordKind === 'ng' && <option value='ng'>{WORD_KIND_LABELS.ng}</option>}</select></label></>;
    const infoFields = <><label>種類<select value={infoKind} onChange={event => setInfoKind(event.target.value as InfoKind)}>
        {(Object.keys(INFO_KIND_LABELS) as InfoKind[]).map(kind => <option key={kind} value={kind}>{INFO_KIND_LABELS[kind]}</option>)}</select></label>
        <label>名前<input value={name} onChange={event => setName(event.target.value)} placeholder='公式サイト' /></label>
        <label>中身<input value={body} onChange={event => setBody(event.target.value)} placeholder='https://…' /></label>
        <label>いつ使う<input value={when} onChange={event => setWhen(event.target.value)} placeholder='説明欄と最後の 1 枚に入れる' /></label></>;
    const ruleFields = <><label>どこの<select value={area} onChange={event => setArea(event.target.value as RuleArea)}>
        {(Object.keys(RULE_AREA_LABELS) as RuleArea[]).map(value => <option key={value} value={value}>{RULE_AREA_LABELS[value]}</option>)}</select></label>
        <label className='akari-notes-wide'>決まり<textarea value={ruleText} onChange={event => setRuleText(event.target.value)} placeholder='1 行は 14 字まで。超えたら 2 行に' /></label></>;

    return <HomeScrim kind='channel-notes' onClose={props.onClose}>
        <style>{channelSheetCss}</style>
        <h3>辞書とメモ</h3>
        <p>このチャンネルで、文字起こしと音声入力、AI が使う前提情報です。</p>
        <div className='akari-notes-actions'>
            <button type='button' aria-expanded={menu} onClick={() => setMenu(!menu)}>用意されたものから足す ☆ ▾</button>
            <button type='button' onClick={() => props.onTypePrompt('このチャンネルの動画の台本と会話から、言い換え・よく使う情報・決まりごとの候補を集めて')}>パートナーに集めてもらう</button>
        </div>
        {menu && <div className='akari-notes-menu'>{packs.map(pack => <button type='button' key={pack.name} disabled={busy}
            onClick={() => void apply(pack)}>{pack.name}（{pack.entries.length} 件）</button>)}<hr />
            <button type='button' onClick={props.onOpenPacks}>記憶パック…</button></div>}
        {message && <p role='status'>{message}</p>}
        <div className='akari-notes-tabs' role='tablist' aria-label='辞書とメモ'>
            {tabItems.map(item => <button type='button' role='tab' key={item.id} aria-selected={tab === item.id}
                onClick={() => { setTab(item.id); setMenu(false); reset(); }}>{item.label}<small>{item.count}</small></button>)}
        </div>
        <div className='akari-notes-layout'>
            <aside className='akari-notes-filters'>
                <h4>{tab === 'words' ? '出どころ' : '種類'}</h4>
                {tab === 'words' ? options.map(option => <button type='button' key={option.key} aria-pressed={source === option.key}
                    onClick={() => setSource(option.key)}><span>{option.label}</span><small>{option.count}</small></button>)
                    : <button type='button' aria-pressed='true'><span>すべて</span><small>{tab === 'infos' ? file.infos.length : file.rules.length}</small></button>}
            </aside>
            <div className='akari-notes-list'>
                {tab === 'words' && <>
                    <table className='akari-notes-table'><thead><tr><th>聞こえ方</th><th>直したあと</th><th>メモ</th><th>出どころ</th><th>×</th></tr></thead><tbody>
                        {shownWords.map(entry => { const index = book.entries.indexOf(entry); const label = wordEntryLabel(entry);
                            return <tr key={index} data-editable='true' onClick={() => beginWord(entry, index)}>
                                {editing === `w:${index}` ? <td colSpan={4}><div className='akari-notes-edit' onClick={event => event.stopPropagation()}>{wordFields}<div>
                                    <button type='button' disabled={busy || !surface.trim()} onClick={event => { event.stopPropagation(); void saveWord(index); }}>保存</button>
                                    <button type='button' onClick={event => { event.stopPropagation(); reset(); }}>やめる</button></div></div></td>
                                    : <><td>{label.heard || <span className='akari-notes-muted'>聞こえ方なし</span>}</td><td>{label.fixed}</td><td>{label.memo}</td><td>{label.source}</td></>}
                                <td><button type='button' disabled={busy} aria-label={`${entry.surface}を消す`} onClick={event => {
                                    event.stopPropagation(); void saveBook(removeWordEntry(book, index)); }}>×</button></td></tr>; })}
                    </tbody></table>
                    <div className='akari-notes-form'>{editing.startsWith('w:') ? null : <>{wordFields}<div className='akari-notes-form-actions akari-notes-wide'>
                        <button type='button' disabled={busy || !surface.trim()} onClick={() => void saveWord()}>足す</button></div></>}</div>
                </>}
                {tab === 'infos' && <>
                    <table className='akari-notes-table'><thead><tr><th>種類</th><th>名前</th><th>中身</th><th>いつ使う</th><th>×</th></tr></thead><tbody>
                        {file.infos.map(entry => <tr key={entry.id} data-editable='true' onClick={() => beginInfo(entry)}>
                            {editing === `i:${entry.id}` ? <td colSpan={4}><div className='akari-notes-edit' onClick={event => event.stopPropagation()}>{infoFields}<div>
                                <button type='button' disabled={busy || !name.trim() || !body.trim()} onClick={event => { event.stopPropagation(); void saveInfo(entry.id); }}>保存</button>
                                <button type='button' onClick={event => { event.stopPropagation(); reset(); }}>やめる</button></div></div></td>
                                : <><td>{INFO_KIND_LABELS[entry.kind]}</td><td>{entry.name}</td><td>{entry.body}</td><td>{entry.when}</td></>}
                            <td><button type='button' disabled={busy} aria-label={`${entry.name}を消す`} onClick={event => {
                                event.stopPropagation(); void saveNotes(removeInfo(file, entry.id)); }}>×</button></td></tr>)}
                    </tbody></table>
                    {!file.infos.length && <p>例: 締めのひとこと · それでは、また次の動画で。 · 毎回の最後</p>}
                    <div className='akari-notes-form'>{editing.startsWith('i:') ? null : <>{infoFields}<div className='akari-notes-form-actions akari-notes-wide'>
                        <button type='button' disabled={busy || !name.trim() || !body.trim()} onClick={() => void saveInfo()}>足す</button></div></>}</div>
                </>}
                {tab === 'rules' && <>
                    <table className='akari-notes-table'><thead><tr><th>どこの</th><th>決まり</th><th>×</th></tr></thead><tbody>
                        {file.rules.map(entry => <tr key={entry.id} data-editable='true' onClick={() => beginRule(entry)}>
                            {editing === `r:${entry.id}` ? <td colSpan={2}><div className='akari-notes-edit' onClick={event => event.stopPropagation()}>{ruleFields}<div>
                                <button type='button' disabled={busy || !ruleText.trim()} onClick={event => { event.stopPropagation(); void saveRule(entry.id); }}>保存</button>
                                <button type='button' onClick={event => { event.stopPropagation(); reset(); }}>やめる</button></div></div></td>
                                : <><td>{RULE_AREA_LABELS[entry.area]}</td><td>{entry.text}</td></>}
                            <td><button type='button' disabled={busy} aria-label='決まりを消す' onClick={event => {
                                event.stopPropagation(); void saveNotes(removeRule(file, entry.id)); }}>×</button></td></tr>)}
                    </tbody></table>
                    {!file.rules.length && <p>例: BGM は声より 18 dB 下げる / 冒頭 2 秒で結論を言う</p>}
                    <div className='akari-notes-form'>{editing.startsWith('r:') ? null : <>{ruleFields}<div className='akari-notes-form-actions akari-notes-wide'>
                        <button type='button' disabled={busy || !ruleText.trim()} onClick={() => void saveRule()}>足す</button></div></>}</div>
                </>}
            </div>
        </div>
        <small className='akari-notes-note'>{tab === 'words' ? 'このチャンネルの単語帳（.akari/memory/word-book.json）に入ります。台本パネルで直した語もここに足されます。'
            : tab === 'infos' ? 'パートナーが説明欄・最後の 1 枚・字幕を作るときに読みます。「いつ使う」を書いておくと、その場面でだけ入ります。'
                : '編集のたびに守ってほしいこと。パートナーと検査（edit-lint）が読みます。'}</small>
        {error && <p className='akari-notes-error' role='alert'>{error}</p>}
    </HomeScrim>;
}
