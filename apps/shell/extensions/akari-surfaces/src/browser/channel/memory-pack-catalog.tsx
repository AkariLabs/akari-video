import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { HomeScrim } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { ChannelMemoryFiles } from './channel-memory-files';
import { defaultScene, initialOf, PeopleFile, WordBookFile } from './channel-people-model';
import { countPacks, emptyPacksFile, importPack, isImported, packWordExamples, PacksFile,
    removePack, removePackCounts } from './memory-pack-model';
import { MEMORY_PACK_GENRES, MEMORY_PACKS, MemoryPack, packTotal } from './memory-packs-builtin';
import { proGate } from '../../common/pro-key';
import { PRO_FEATURE_PACK } from './channel-pro-sheet';

const STYLE_ID = 'akari-channel-packs-style';
const CSS = `
.akari-home-sheet-scrim[data-akari-home-dialog=channel-packs] .akari-home-sheet{width:min(900px,95vw);max-height:90vh;overflow-y:auto}
.akari-packs-layout{display:grid;grid-template-columns:200px minmax(0,1fr) 300px;gap:14px;margin-top:16px;height:calc(100vh - 240px);min-height:300px}
.akari-packs-nav,.akari-packs-list,.akari-packs-detail{overflow-y:auto;min-height:0}
.akari-packs-detail{display:flex;flex-direction:column}
.akari-packs-detail>.akari-packs-actions,.akari-packs-detail>.akari-packs-confirm{position:sticky;bottom:0;margin-top:auto;padding:10px 0 2px;background:var(--theia-editorWidget-background,var(--theia-editor-background))}
.akari-packs-nav,.akari-packs-list{border-right:1px solid var(--theia-widget-border);padding-right:12px;min-width:0}
.akari-packs-nav{display:flex;flex-direction:column;gap:2px}
.akari-packs-nav h4{font-size:12px;color:var(--theia-descriptionForeground);margin:12px 0 3px}
.akari-packs-nav button,.akari-packs-card{border:0;border-radius:6px;background:transparent;color:var(--theia-foreground);text-align:left;cursor:pointer}
.akari-packs-nav button{display:flex;justify-content:space-between;gap:7px;padding:7px}
.akari-packs-nav button[aria-pressed=true],.akari-packs-card[aria-pressed=true]{background:var(--theia-list-activeSelectionBackground)}
.akari-packs-nav small,.akari-packs-card small,.akari-packs-detail small{color:var(--theia-descriptionForeground)}
.akari-packs-list{display:flex;flex-direction:column;gap:5px}
.akari-packs-card{display:grid;gap:5px;padding:11px;border:1px solid var(--theia-widget-border);overflow-wrap:anywhere}
.akari-packs-card:hover{background:var(--theia-list-hoverBackground)}
.akari-packs-card span{display:flex;flex-wrap:wrap;gap:5px}
.akari-packs-badge{border:1px solid var(--theia-widget-border);border-radius:4px;padding:1px 5px;font-size:11px}
.akari-packs-detail{min-width:0;overflow-wrap:anywhere}
.akari-packs-detail h4{margin:0 0 8px}
.akari-packs-detail h5{margin:16px 0 7px}
.akari-packs-detail p{margin:7px 0!important}
.akari-packs-example{display:flex;align-items:center;gap:7px;width:100%;border:0;border-radius:5px;background:transparent;color:var(--theia-foreground);text-align:left;padding:5px;cursor:pointer}
.akari-packs-example:hover,.akari-packs-example[aria-pressed=true]{background:var(--theia-list-hoverBackground)}
.akari-packs-initial{display:grid;place-items:center;flex:0 0 27px;width:27px;height:27px;border-radius:5px;border:1px solid var(--theia-widget-border);background:var(--theia-editor-background)}
.akari-packs-example-text{display:grid;gap:1px}
.akari-packs-fields{padding-left:18px;margin:6px 0}
.akari-packs-fields li{margin:3px 0}
.akari-packs-actions,.akari-packs-confirm-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:15px}
.akari-packs-actions button,.akari-packs-confirm-actions button{border:1px solid var(--theia-widget-border);border-radius:6px;padding:8px 10px;background:var(--theia-button-secondaryBackground);color:var(--theia-button-secondaryForeground);cursor:pointer}
.akari-packs-actions button:first-child,.akari-packs-confirm-actions button:first-child{background:var(--theia-button-background);color:var(--theia-button-foreground)}
.akari-packs-actions button:disabled,.akari-packs-confirm-actions button:disabled{opacity:.5;cursor:default}
.akari-packs-confirm{border:1px solid var(--theia-widget-border);border-radius:7px;background:var(--theia-editor-background);padding:11px;margin-top:12px}
.akari-packs-confirm label{display:flex;align-items:flex-start;gap:6px;margin-top:9px}
.akari-packs-error{color:var(--theia-errorForeground)!important}
@media(max-width:750px){.akari-packs-layout{grid-template-columns:150px minmax(0,1fr);height:auto}.akari-packs-nav,.akari-packs-list,.akari-packs-detail{overflow-y:visible}.akari-packs-detail{grid-column:1/-1;border-top:1px solid var(--theia-widget-border);padding-top:12px}}
@media(max-width:520px){.akari-packs-layout{grid-template-columns:1fr}.akari-packs-nav,.akari-packs-list{border-right:0;border-bottom:1px solid var(--theia-widget-border);padding:0 0 10px}.akari-packs-nav{max-height:180px;overflow-y:auto}}
`;

type Filter = 'all' | 'imported' | string;

export function MemoryPackCatalog(props: { channel: string; dir: URI; files: ChannelMemoryFiles; onClose: () => void;
    onOpenPeople: () => void; onChanged?: () => void; initialPack?: string; onToast?: (text: string) => void;
    hasProKey: boolean; onNeedPro: (feature: string) => void }): React.ReactElement {
    const [filter, setFilter] = React.useState<Filter>('all');
    const [selectedName, setSelectedName] = React.useState(props.initialPack || 'AI 業界');
    const [selectedEntry, setSelectedEntry] = React.useState(0);
    const [people, setPeople] = React.useState<PeopleFile>({ version: 0, entries: [] });
    const [book, setBook] = React.useState<WordBookFile>({ version: 0, entries: [] });
    const [packs, setPacks] = React.useState<PacksFile>(emptyPacksFile());
    const [confirm, setConfirm] = React.useState(false);
    const [keepEdited, setKeepEdited] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [error, setError] = React.useState('');

    React.useEffect(() => {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style'); style.id = STYLE_ID; style.textContent = CSS; document.head.appendChild(style);
    }, []);
    React.useEffect(() => {
        let active = true;
        void Promise.all([props.files.readPeople(props.dir), props.files.readWordBook(props.dir), props.files.readPacks(props.dir)])
            .then(([nextPeople, nextBook, nextPacks]) => { if (active) { setPeople(nextPeople); setBook(nextBook); setPacks(nextPacks); } })
            .catch(() => { if (active) setError('読み込めませんでした。もう一度開いてください。'); });
        return () => { active = false; };
    }, [props.dir.toString(), props.files]);

    const selected = MEMORY_PACKS.find(pack => pack.name === selectedName) || MEMORY_PACKS[0];
    const counts = countPacks(MEMORY_PACKS, packs);
    const shown = MEMORY_PACKS.filter(pack => filter === 'all' || (filter === 'imported' ? isImported(packs, pack.name)
        : `${pack.genre} › ${pack.group}` === filter));
    const imported = isImported(packs, selected.name);
    const removable = removePackCounts(selected.name, people, book);
    const example = selected.entries?.[selectedEntry];

    const notify = (text: string): void => { if (props.onToast) props.onToast(text); else setMessage(text); };
    const choose = (pack: MemoryPack): void => { setSelectedName(pack.name); setSelectedEntry(0); setConfirm(false); setMessage(''); setError(''); };
    const takeIn = async (): Promise<void> => {
        if (busy || selected.status !== 'ready') return;
        setBusy(true); setError(''); setMessage('');
        try {
            const [currentPeople, currentBook, currentPacks] = await Promise.all([
                props.files.readPeople(props.dir), props.files.readWordBook(props.dir), props.files.readPacks(props.dir)
            ]);
            const result = importPack(selected, currentPeople, currentBook, currentPacks);
            await props.files.writePeople(props.dir, result.people);
            await props.files.writeWordBook(props.dir, result.book);
            await props.files.writePacks(props.dir, result.packs);
            setPeople(result.people); setBook(result.book); setPacks(result.packs);
            notify(`『${selected.name}』を取り込みました。人とモノと辞書に、パックとして入りました`);
            props.onChanged?.();
        } catch { setError('取り込めませんでした。もう一度お試しください。'); }
        finally { setBusy(false); }
    };
    const takeOut = async (): Promise<void> => {
        if (busy) return;
        setBusy(true); setError(''); setMessage('');
        try {
            const [currentPeople, currentBook, currentPacks] = await Promise.all([
                props.files.readPeople(props.dir), props.files.readWordBook(props.dir), props.files.readPacks(props.dir)
            ]);
            const result = removePack(selected.name, currentPeople, currentBook, currentPacks, { keepEdited });
            await props.files.writePeople(props.dir, result.people);
            await props.files.writeWordBook(props.dir, result.book);
            await props.files.writePacks(props.dir, result.packs);
            setPeople(result.people); setBook(result.book); setPacks(result.packs); setConfirm(false);
            notify(`『${selected.name}』を外しました（${result.removed} 件）`);
            props.onChanged?.();
        } catch { setError('外せませんでした。もう一度お試しください。'); }
        finally { setBusy(false); }
    };

    return <HomeScrim kind='channel-packs' onClose={props.onClose}>
        <style>{channelSheetCss}</style>
        <h3>記憶パック</h3>
        <p>分野ごとの、人物・会社・製品のまとまりです。中身はだれでも見られます。取り込むと『人とモノ』と辞書にパックとして入り、あとからパックごと外せます。</p>
        {message && <p role='status'>{message}</p>}
        {error && <p role='alert' className='akari-packs-error'>{error}</p>}
        <div className='akari-packs-layout'>
            <nav className='akari-packs-nav' aria-label='記憶パックの分野'>
                <button type='button' aria-pressed={filter === 'all'} onClick={() => setFilter('all')}><span>すべて</span><small>{counts.all}</small></button>
                <button type='button' aria-pressed={filter === 'imported'} onClick={() => setFilter('imported')}><span>取り込み済み</span><small>{counts.imported}</small></button>
                {MEMORY_PACK_GENRES.map(item => <React.Fragment key={item.genre}><h4>{item.genre}</h4>
                    {item.groups.map(group => { const key = `${item.genre} › ${group}`;
                        return <button type='button' key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
                            <span>{group}</span><small>{MEMORY_PACKS.filter(pack => pack.genre === item.genre && pack.group === group).length}</small></button>; })}
                </React.Fragment>)}
            </nav>
            <div className='akari-packs-list' aria-label='記憶パック一覧'>
                {shown.map(pack => <button type='button' className='akari-packs-card' key={pack.id} aria-pressed={selected.name === pack.name}
                    onClick={() => choose(pack)}><strong>{pack.name}</strong><small>{pack.group} · {packTotal(pack)} 件 · Akari</small>
                    <span>{isImported(packs, pack.name) && <small className='akari-packs-badge'>取り込み済み</small>}
                        {pack.status === 'planned' && <small className='akari-packs-badge'>準備中</small>}</span></button>)}
                {!shown.length && <p>取り込み済みのパックはありません。</p>}
            </div>
            <section className='akari-packs-detail' aria-label={`${selected.name}の中身`}>
                <h4>{selected.name}</h4><p>{selected.description}</p>
                <small>人物 {selected.counts.people} · 会社 {selected.counts.orgs} · 製品 {selected.counts.products} · 言い換え {selected.counts.words}</small>
                <h5>入っているものの例</h5>
                {selected.entries?.slice(0, 6).map((entry, index) => <button type='button' className='akari-packs-example' key={entry.name}
                    aria-pressed={selectedEntry === index} onClick={() => setSelectedEntry(index)}>
                    <span className='akari-packs-initial' aria-hidden='true'>{initialOf(entry.name)}</span>
                    <span className='akari-packs-example-text'><strong>{entry.name}</strong>{entry.role && <small>{entry.role}</small>}</span></button>)}
                {!selected.entries?.length && <p>中身は準備中です。</p>}
                <h5>言い換えの例</h5>
                {packWordExamples(selected).length ? packWordExamples(selected).map(word => <p key={word}>{word}</p>) : <p>準備中です。</p>}
                <h5>1 件に入っているもの</h5>
                {example ? <ul className='akari-packs-fields'>
                    <li>名前: {example.name}</li><li>読み: {example.reading || '未登録'}</li>
                    <li>別名: {example.aliases?.join('、') || '未登録'}</li><li>役割: {example.role || '未登録'}</li>
                    <li>使う場面: {defaultScene(example.kind === 'person' ? 'person' : 'org')}</li>
                    <li>画像の在りか（参照）: 未登録</li>
                </ul> : <p>中身は準備中です。</p>}
                <p><small>見本の顔はイラストです。実際のパックは画像そのものを配らず、公式の写真やロゴの在りかと使い方の決まりを配ります（参照配布）。</small></p>
                {confirm && <div className='akari-packs-confirm'>
                    <strong>『{selected.name}』を外す</strong>
                    <p>このパックから入ったものを、まとめて消します。</p>
                    <p>人とモノ {removable.people} 件・辞書の言い換え {removable.words} 件</p>
                    <label><input type='checkbox' checked={keepEdited} onChange={event => setKeepEdited(event.target.checked)} />自分で直したもの（別名や使う場面を書き換えたもの）は残す</label>
                    <div className='akari-packs-confirm-actions'><button type='button' disabled={busy} onClick={() => void takeOut()}>外す</button>
                        <button type='button' disabled={busy} onClick={() => setConfirm(false)}>やめる</button></div>
                </div>}
                {!confirm && <div className='akari-packs-actions'>
                    {selected.status === 'planned' ? <button type='button' disabled>準備中（Lab で配布予定）</button>
                        : imported ? <><button type='button' onClick={props.onOpenPeople}>人とモノで『{selected.name}』を見る</button>
                            <button type='button' disabled={busy} onClick={() => { setKeepEdited(true); setConfirm(true); }}>外す…</button></>
                            : <button type='button' disabled={busy} onClick={() => {
                                if (!proGate('pro', props.hasProKey)) props.onNeedPro(PRO_FEATURE_PACK);
                                else void takeIn();
                            }}>☆ 『{selected.name}』を取り込む</button>}
                </div>}
            </section>
        </div>
    </HomeScrim>;
}
