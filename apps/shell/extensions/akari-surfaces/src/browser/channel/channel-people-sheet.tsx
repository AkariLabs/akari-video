import { t } from '@akari-video/i18n';
import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { HomeScrim } from '../home/home-panels';
import { channelSheetCss } from './channel-sheet-style';
import { ChannelMemoryFiles } from './channel-memory-files';
import { ChannelPersonDetail } from './channel-person-detail';
import { addPerson, AVATAR_CAPS, defaultScene, filterPeople, initialOf, mergeAliasesIntoWordBook,
    peopleCounts, PeopleFile, PersonKind, PERSON_KIND_LABELS, personPhoto, hasVoice, removePeople, splitAliases, summarizeNames,
    VoiceProfileOption } from './channel-people-model';

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
.akari-people-row-body>span:first-child{display:flex;flex-wrap:wrap;align-items:baseline;gap:7px}
.akari-people-row-body span,.akari-people-row-body small{overflow-wrap:anywhere}
.akari-people-row-open{min-width:0;flex:1;display:flex;align-items:flex-start;gap:10px;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:0;font:inherit}
.akari-people-row-open:focus-visible{outline:2px solid var(--theia-focusBorder);outline-offset:3px}
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
.akari-person-detail{max-height:min(76vh,800px);overflow-y:auto;padding-right:8px;font-family:inherit;font-size:13px}
.akari-person-detail input,.akari-person-detail select,.akari-person-detail textarea,.akari-person-detail button{font-family:inherit;font-size:13px}
.akari-person-detail select[data-akari-person-voice-profile]{min-width:220px;max-width:100%;box-sizing:border-box}
.akari-person-detail p,.akari-person-samples li{font-size:13px}
.akari-person-photo small,.akari-person-consent label{font-size:12px}
.akari-person-back{border:0;background:transparent;color:var(--theia-textLink-foreground);cursor:pointer;padding:5px 0}
.akari-person-section{border-bottom:1px solid var(--theia-widget-border);padding:12px 0 18px}
.akari-person-section h4{font-size:14px;margin:0 0 12px}.akari-person-section h5{font-size:12px;margin:14px 0 8px}
.akari-person-fields{display:grid;grid-template-columns:1fr 1fr;gap:11px 14px}
.akari-person-fields label{display:grid;gap:5px;font-size:12px}.akari-person-fields input:not([type=checkbox]),.akari-person-fields select,.akari-person-fields textarea{box-sizing:border-box;width:100%}
.akari-person-fields textarea{min-height:65px;resize:vertical}.akari-person-wide{grid-column:1/-1}
.akari-person-photos{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0}.akari-person-photo{display:flex;flex-direction:column;gap:3px;align-items:center;max-width:90px}
.akari-person-photo img{width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--theia-widget-border)}
.akari-person-photo button,.akari-person-samples button{border:0;background:transparent;color:var(--theia-textLink-foreground);cursor:pointer}
.akari-person-samples{padding-left:18px}.akari-person-samples li{margin:5px 0;overflow-wrap:anywhere}.akari-person-consent{display:flex;flex-wrap:wrap;gap:12px;margin:8px 0}
.akari-person-consent label{display:flex;align-items:center;gap:4px}
@media(max-width:650px){.akari-people-layout{grid-template-columns:1fr}.akari-people-filters{border-right:0;border-bottom:1px solid var(--theia-widget-border);padding:0 0 8px;flex-direction:row;flex-wrap:wrap}.akari-people-filters h4{width:100%}.akari-people-form{grid-template-columns:1fr}}
`;

export function ChannelPeopleSheet(props: { channel: string; dir: URI; files: ChannelMemoryFiles; onClose: () => void;
    onOpenPacks: () => void; onTypePrompt: (text: string) => void; onChanged?: () => void; packsImported?: number;
    loadVoiceProfiles?: () => Promise<VoiceProfileOption[]>; onOpenSettings?: (section: string) => void }): React.ReactElement {
    const [file, setFile] = React.useState<PeopleFile>({ version: 0, entries: [] });
    const [kindFilter, setKindFilter] = React.useState<PersonKind | 'all'>('all');
    const [sourceFilter, setSourceFilter] = React.useState<string>('all');
    const [selected, setSelected] = React.useState<string[]>([]);
    const [confirmIds, setConfirmIds] = React.useState<string[]>([]);
    const [adding, setAdding] = React.useState(false);
    const [detailId, setDetailId] = React.useState<string>();
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
        setDetailId(undefined);
        void props.files.readPeople(props.dir).then(value => { if (active) setFile(value); });
        return () => { active = false; };
    }, [props.dir.toString(), props.files]);

    const counts = peopleCounts(file);
    const shown = filterPeople(file, { kind: kindFilter, source: sourceFilter });
    const selectedSet = new Set(selected);
    const confirmEntries = file.entries.filter(entry => confirmIds.includes(entry.id));
    const detailEntry = file.entries.find(entry => entry.id === detailId);

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
        } catch { setError(t('surfaces.channel.deleteConfirmedDeleteItemTryAgain.error')); }
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
        } catch { setError(t('surfaces.channel.saveCheckDetailsTryAgain.error')); }
        finally { setBusy(false); }
    };

    return <HomeScrim kind='channel-people' onClose={props.onClose}>
        <style>{channelSheetCss}</style>
        <h3>{detailEntry ? detailEntry.name : adding ? t('surfaces.channel.channelPeopleSheetAddPeopleThings.label') : t('surfaces.channel.channelPeopleSheetPeopleThings.label')}</h3>
        {detailEntry ? <ChannelPersonDetail key={detailEntry.id} dir={props.dir} files={props.files} entry={detailEntry} file={file}
            onSaved={next => { setFile(next); setDetailId(undefined); props.onChanged?.(); }} onBack={() => setDetailId(undefined)}
            loadVoiceProfiles={props.loadVoiceProfiles} onOpenSettings={props.onOpenSettings} /> : !adding ? <>
            <p>{t('surfaces.channel.peopleRegistration.description')}</p>
            <div className='akari-people-actions'>
                <button type='button' data-akari-people-add onClick={() => { setAdding(true); setError(''); }}>{t('surfaces.channel.channelPeopleSheetAdd.button')}</button>
                <button type='button' data-akari-people-packs onClick={props.onOpenPacks}>{t('surfaces.channel.channelPeopleSheetFindMemoryPack.button')}</button>
                <button type='button' data-akari-people-find onClick={() => props.onTypePrompt(t('surfaces.channel.channelPeopleSheetFindPeopleCompaniesAppearVideosChannelMake.label'))}>{t('surfaces.channel.channelPeopleSheetGetDiscoveredVideo.button')}</button>
            </div>
            <div className='akari-people-layout'>
                <aside className='akari-people-filters'>
                    <h4>{t('surfaces.channel.channelPeopleSheetType.heading')}</h4>
                    {([['all', t('surfaces.channel.channelPeopleSheetAll.label'), counts.all], ...(['person', 'avatar', 'org'] as PersonKind[]).map(value => [value, PERSON_KIND_LABELS[value], counts.byKind[value]])] as Array<[PersonKind | 'all', string, number]>).map(([value, label, count]) =>
                        <button type='button' key={value} aria-pressed={kindFilter === value} onClick={() => setKindFilter(value)}><span>{label}</span><small>{count}</small></button>)}
                    <h4>{t('surfaces.channel.channelPeopleSheetOrigin.heading')}</h4>
                    <button type='button' aria-pressed={sourceFilter === 'all'} onClick={() => setSourceFilter('all')}><span>{t('surfaces.channel.channelPeopleSheetAll.label')}</span><small>{counts.all}</small></button>
                    {counts.bySource.map(source => <button type='button' key={source.key} aria-pressed={sourceFilter === source.key}
                        onClick={() => setSourceFilter(source.key)}><span>{source.label}</span><small>{source.count}</small></button>)}
                </aside>
                <div className='akari-people-list'>
                    <div className='akari-people-selection'>{selected.length ? <><span>{t('surfaces.channel.selectedPeopleCount.label', { count: selected.length })}</span>
                        <button type='button' disabled={busy} onClick={() => setConfirmIds(selected)}>{t('surfaces.channel.channelPeopleSheetDeleteSelectedItem.button')}</button>
                        <button type='button' onClick={() => { setSelected([]); setConfirmIds([]); }}>{t('surfaces.channel.channelPeopleSheetStopChoosing.button')}</button></>
                        : <button type='button' disabled={!shown.length} onClick={() => setSelected(shown.map(entry => entry.id))}>{t('surfaces.channel.channelPeopleSheetSelectAll.button')}</button>}</div>
                    {confirmIds.length > 0 && <div className='akari-people-confirm'>
                        <strong>{t('surfaces.channel.deletePeople.confirm', { count: confirmEntries.length, n: confirmEntries.length })}</strong>
                        <p>{summarizeNames(confirmEntries.map(entry => entry.name))}</p>
                        <div><button type='button' disabled={busy} onClick={() => void deleteConfirmed()}>{t('surfaces.channel.deletePeople.button', { count: confirmEntries.length, n: confirmEntries.length })}</button>
                            <button type='button' onClick={() => setConfirmIds([])}>{t('surfaces.channel.channelPeopleSheetStop.button')}</button></div>
                    </div>}
                    {shown.length ? shown.map(entry => <div className='akari-people-row' key={entry.id}>
                        <input type='checkbox' aria-label={t('surfaces.channel.channelPeopleSheetSelect.message', { entryName: entry.name })} checked={selectedSet.has(entry.id)} onChange={event => {
                            setSelected(event.target.checked ? [...selected, entry.id] : selected.filter(id => id !== entry.id)); setConfirmIds([]);
                        }} />
                        <button type='button' className='akari-people-row-open' data-akari-people-row={entry.id} onClick={() => { setDetailId(entry.id); setConfirmIds([]); }}>
                            {personPhoto(entry) ? <img className='akari-people-image' src={props.dir.resolve(personPhoto(entry)!).toString()} alt='' />
                                : <span className='akari-people-image' aria-hidden='true'>{initialOf(entry.name)}</span>}
                        <span className='akari-people-row-body'><span><strong>{entry.name}</strong><small>{PERSON_KIND_LABELS[entry.kind]}</small>
                            {entry.pack && <small>☆{entry.pack}</small>}{entry.profile?.birthday && <small>{t('surfaces.channel.channelPeopleSheetBirthday.label')}</small>}{hasVoice(entry) && <small>{t('surfaces.channel.channelPeopleSheetVoice.label')}</small>}</span>
                            {entry.role && <span>{entry.role}</span>}
                            {entry.aliases.length > 0 && <small>{t('surfaces.channel.personAliases.label', { aliases: entry.aliases.join(t('surfaces.channel.aliasList.separator')) })}</small>}
                            {entry.scene && <small>{t('surfaces.channel.personUsage.label', { usage: entry.scene })}</small>}</span></button>
                        <button type='button' className='akari-people-remove' aria-label={t('surfaces.channel.channelPeopleSheetDelete.message', { entryName: entry.name })} onClick={() => setConfirmIds([entry.id])}>×</button>
                    </div>) : <p>{t('surfaces.channel.channelPeopleSheetRegisteredYet.message')}</p>}
                </div>
            </div>
            <p className='akari-people-note'>{t('surfaces.channel.channelPeopleSheetAlternativeNamesAlsoDictionaryParaphrasesAlsoDelete.message')}</p>
        </> : <>
            <p>{t('surfaces.channel.channelPeopleSheetRegisterNameImageVideosChannel.message')}</p>
            <div className='akari-people-form'>
                <label>{t('surfaces.channel.channelPeopleSheetType.label')}<select value={kind} onChange={event => { const next = event.target.value as PersonKind; setKind(next); if (!sceneEdited) setScene(defaultScene(next)); }}>
                    {(['person', 'avatar', 'org'] as PersonKind[]).map(value => <option key={value} value={value}>{PERSON_KIND_LABELS[value]}</option>)}</select></label>
                <label>{t('surfaces.channel.channelPeopleSheetName.label')}<input value={name} onChange={event => setName(event.target.value)} /></label>
                <label>{t('surfaces.channel.channelPeopleSheetReading.label')}<input value={reading} onChange={event => setReading(event.target.value)} /></label>
                <label>{t('surfaces.channel.channelPeopleSheetAliasesCommaSeparated.label')}<input value={aliases} onChange={event => setAliases(event.target.value)} /></label>
                <label>{t('surfaces.channel.channelPeopleSheetRole.label')}<input value={role} onChange={event => setRole(event.target.value)} /></label>
                <label>{t('surfaces.channel.channelPeopleSheetPhotosLogos.label')}<input type='file' accept='image/*' onChange={event => setImageFile(event.target.files?.[0])} /></label>
                <label className='akari-people-wide'>{t('surfaces.channel.channelPeopleSheetSituation.label')}<textarea value={scene} onChange={event => { setScene(event.target.value); setSceneEdited(true); }} /></label>
                {kind === 'avatar' && <div className='akari-people-wide'><strong>{t('surfaces.channel.channelPeopleSheetStrong.label')}</strong><div className='akari-people-caps'>{AVATAR_CAPS.map(cap =>
                    <label key={cap.id}><input type='checkbox' checked={caps.includes(cap.id)} onChange={event => setCaps(event.target.checked ? [...caps, cap.id] : caps.filter(id => id !== cap.id))} />{cap.label}</label>)}</div></div>}
                <label className='akari-people-wide akari-people-wordbook'><input type='checkbox' checked={addToBook} onChange={event => setAddToBook(event.target.checked)} />{t('surfaces.channel.channelPeopleSheetAddAliasDictionaryParaphrase.label')}</label>
            </div>
            <div className='akari-people-form-actions'><button type='button' disabled={!name.trim() || busy} onClick={() => void save()}>{t('surfaces.channel.channelPeopleSheetSave.button')}</button>
                <button type='button' onClick={() => { setAdding(false); setError(''); }}>{t('surfaces.channel.channelPeopleSheetStop.button')}</button></div>
        </>}
        {error && <p className='akari-people-error' role='alert'>{error}</p>}
    </HomeScrim>;
}
