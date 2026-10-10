import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { ChannelMemoryFiles } from './channel-memory-files';
import { AVATAR_CAPS, canAddVoiceSample, isValidBirthday, PeopleFile, PersonEntry, PersonKind, PERSON_KIND_LABELS,
    personPatchFromForm, updatePerson, VoiceProfileOption, VoiceSample, VoiceSampleConsent,
    VOICE_CONSENT_LABELS } from './channel-people-model';

type PendingPhoto = { file: File; url: string };
type PendingSample = { file: File; consent: VoiceSampleConsent; added_at: string };

export function ChannelPersonDetail(props: { dir: URI; files: ChannelMemoryFiles; entry: PersonEntry; file: PeopleFile;
    onSaved: (next: PeopleFile) => void; onBack: () => void;
    loadVoiceProfiles?: () => Promise<VoiceProfileOption[]>; onOpenSettings?: (section: string) => void }): React.ReactElement {
    const { entry } = props;
    const [kind, setKind] = React.useState<PersonKind>(entry.kind);
    const [name, setName] = React.useState(entry.name);
    const [reading, setReading] = React.useState(entry.reading || '');
    const [aliases, setAliases] = React.useState(entry.aliases.join(', '));
    const [role, setRole] = React.useState(entry.role || '');
    const [scene, setScene] = React.useState(entry.scene || '');
    const [caps, setCaps] = React.useState(entry.caps || []);
    const [birthday, setBirthday] = React.useState(entry.profile?.birthday || '');
    const [personality, setPersonality] = React.useState(entry.profile?.personality || '');
    const [background, setBackground] = React.useState(entry.profile?.background || '');
    const [notes, setNotes] = React.useState(entry.profile?.notes || '');
    const [links, setLinks] = React.useState((entry.profile?.links || []).join('\n'));
    const [photos, setPhotos] = React.useState(entry.photos || []);
    const [pendingPhotos, setPendingPhotos] = React.useState<PendingPhoto[]>([]);
    const [voiceProfile, setVoiceProfile] = React.useState(entry.voice?.profile || '');
    const [voiceAvatar, setVoiceAvatar] = React.useState(entry.voice?.avatar || '');
    const [profiles, setProfiles] = React.useState<VoiceProfileOption[]>([]);
    const [samples, setSamples] = React.useState(entry.voice?.samples || []);
    const [pendingSamples, setPendingSamples] = React.useState<PendingSample[]>([]);
    const [sampleFile, setSampleFile] = React.useState<File | undefined>();
    const [consent, setConsent] = React.useState<VoiceSampleConsent | undefined>();
    const [sampleInputKey, setSampleInputKey] = React.useState(0);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState('');
    const photoUrls = React.useRef<string[]>([]);

    React.useEffect(() => {
        let active = true;
        if (props.loadVoiceProfiles) void props.loadVoiceProfiles().then(value => {
            if (active) setProfiles(Array.isArray(value) ? value : []);
        }).catch(() => { if (active) setProfiles([]); });
        return () => { active = false; };
    }, [props.loadVoiceProfiles]);
    React.useEffect(() => () => { photoUrls.current.forEach(url => URL.revokeObjectURL(url)); }, []);

    const addPhotos = (files: FileList | null): void => {
        if (!files) return;
        const next = Array.from(files).map(file => {
            const url = URL.createObjectURL(file);
            photoUrls.current.push(url);
            return { file, url };
        });
        setPendingPhotos(current => [...current, ...next]);
    };
    const addSample = (): void => {
        if (!canAddVoiceSample(consent, sampleFile?.name) || !sampleFile || !consent) return;
        setPendingSamples(current => [...current, { file: sampleFile, consent, added_at: new Date().toISOString() }]);
        setSampleFile(undefined);
        setConsent(undefined);
        setSampleInputKey(value => value + 1);
    };
    const invalidBirthday = !!birthday.trim() && !isValidBirthday(birthday.trim());
    const save = async (): Promise<void> => {
        if (!name.trim() || invalidBirthday || busy) return;
        setBusy(true);
        setError('');
        try {
            const nextPhotos = [...photos];
            for (const item of pendingPhotos) nextPhotos.push(await props.files.copyPersonPhoto(props.dir, entry.id, item.file, nextPhotos));
            const nextSamples: VoiceSample[] = [...samples];
            for (const item of pendingSamples) {
                const path = await props.files.copyVoiceSample(props.dir, entry.id, item.file, nextSamples.map(sample => sample.file));
                nextSamples.push({ file: path, consent: item.consent, added_at: item.added_at });
            }
            const next = updatePerson(props.file, entry.id, personPatchFromForm(entry, { kind, name, reading, aliases,
                role, scene, caps, birthday, personality, background, notes, links, photos: nextPhotos,
                voiceProfile, voiceAvatar, samples: nextSamples }));
            await props.files.writePeople(props.dir, next);
            props.onSaved(next);
        } catch { setError('保存できませんでした。内容を確かめてもう一度お試しください。'); }
        finally { setBusy(false); }
    };

    return <div className='akari-person-detail' data-akari-person-detail={entry.id}>
        <button type='button' className='akari-person-back' onClick={props.onBack}>← 人とモノに戻る</button>
        <section className='akari-person-section'>
            <h4>基本</h4>
            <div className='akari-person-fields'>
                <label>種類<select value={kind} onChange={event => setKind(event.target.value as PersonKind)}>
                    {(['person', 'avatar', 'org'] as PersonKind[]).map(value => <option key={value} value={value}>{PERSON_KIND_LABELS[value]}</option>)}</select></label>
                <label>名前<input value={name} onChange={event => setName(event.target.value)} /></label>
                <label>読み<input value={reading} onChange={event => setReading(event.target.value)} /></label>
                <label>別名（カンマ区切り）<input value={aliases} onChange={event => setAliases(event.target.value)} /></label>
                <label>役割<input value={role} onChange={event => setRole(event.target.value)} /></label>
                <label className='akari-person-wide'>使う場面<textarea value={scene} onChange={event => setScene(event.target.value)} /></label>
                {kind === 'avatar' && <div className='akari-person-wide'><strong>使えること</strong><div className='akari-people-caps'>{AVATAR_CAPS.map(cap =>
                    <label key={cap.id}><input type='checkbox' checked={caps.includes(cap.id)} onChange={event => setCaps(event.target.checked ? [...caps, cap.id] : caps.filter(id => id !== cap.id))} />{cap.label}</label>)}</div></div>}
            </div>
        </section>
        <section className='akari-person-section'>
            <h4>パーソナル</h4>
            <div className='akari-person-fields'>
                <label>誕生日<input value={birthday} placeholder='1990-04-01 か 04-01' onChange={event => setBirthday(event.target.value)} />
                    {invalidBirthday && <small className='akari-people-error'>誕生日は 1990-04-01 か 04-01 の形で書いてください</small>}</label>
                <label className='akari-person-wide'>性格<textarea value={personality} onChange={event => setPersonality(event.target.value)} /></label>
                <label className='akari-person-wide'>バックグラウンド<textarea value={background} onChange={event => setBackground(event.target.value)} /></label>
                <label className='akari-person-wide'>メモ<textarea value={notes} onChange={event => setNotes(event.target.value)} /></label>
                <label className='akari-person-wide'>リンク（1 行に 1 つ）<textarea value={links} onChange={event => setLinks(event.target.value)} /></label>
            </div>
        </section>
        <section className='akari-person-section'>
            <h4>写真</h4>
            <div className='akari-person-photos'>
                {photos.map((path, index) => <div className='akari-person-photo' key={`${path}-${index}`}>
                    <img src={props.dir.resolve(path).toString()} alt={`${entry.name}の写真 ${index + 1}`} />
                    <button type='button' onClick={() => setPhotos(current => current.filter((_, at) => at !== index))}>外す</button>
                </div>)}
                {!photos.length && entry.image && <div className='akari-person-photo'><img src={props.dir.resolve(entry.image).toString()} alt={`${entry.name}の以前の写真`} /></div>}
                {pendingPhotos.map((item, index) => <div className='akari-person-photo' key={item.url}>
                    <img src={item.url} alt={`${item.file.name}（保存待ち）`} /><small>保存待ち</small>
                    <button type='button' onClick={() => setPendingPhotos(current => current.filter((_, at) => at !== index))}>外す</button>
                </div>)}
            </div>
            <input type='file' accept='image/*' multiple data-akari-person-photo-input onChange={event => { addPhotos(event.target.files); event.target.value = ''; }} />
        </section>
        <section className='akari-person-section'>
            <h4>声</h4>
            <h5>この人の声のプロフィール</h5>
            <select data-akari-person-voice-profile value={voiceProfile} onChange={event => {
                const selected = profiles.find(item => item.id === event.target.value);
                setVoiceProfile(event.target.value);
                setVoiceAvatar(selected?.avatar || '');
            }}>
                <option value=''>つながない</option>
                {voiceProfile && !profiles.some(item => item.id === voiceProfile) && <option value={voiceProfile}>見つからない声: {voiceProfile}</option>}
                {profiles.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            {!profiles.length && <p data-akari-person-voice-guide>まだ声のプロフィールがありません。設定 › 読み上げ › 自分の声 で自分の声を登録すると、ここで選べます。
                {props.onOpenSettings && <> <button type='button' onClick={() => props.onOpenSettings?.('narration')}>設定を開く</button></>}</p>}
            <p>ナレーションを『この人として』作るときに使います。他の人の声を真似て作ることはしません。</p>
            <h5>話者を見分ける用の声</h5>
            <ul className='akari-person-samples'>
                {samples.map((sample, index) => <li key={`${sample.file}-${index}`}><span>{sample.file.split(/[\\/]/).pop()} — {VOICE_CONSENT_LABELS[sample.consent]}{sample.added_at && ` — ${sample.added_at.slice(0, 10)}`}</span>
                    <button type='button' onClick={() => setSamples(current => current.filter((_, at) => at !== index))}>外す</button></li>)}
                {pendingSamples.map((sample, index) => <li key={`${sample.file.name}-${index}`}><span>{sample.file.name} — {VOICE_CONSENT_LABELS[sample.consent]} — {sample.added_at.slice(0, 10)}（保存待ち）</span>
                    <button type='button' onClick={() => setPendingSamples(current => current.filter((_, at) => at !== index))}>外す</button></li>)}
            </ul>
            <input key={sampleInputKey} type='file' accept='.wav,.m4a,.mp3,audio/wav,audio/mpeg,audio/mp4' data-akari-person-voice-input onChange={event => setSampleFile(event.target.files?.[0])} />
            <p>「本人の声です」か「本人の同意を得た声です」を選んでください。</p>
            <div className='akari-person-consent'>{(['self', 'subject'] as VoiceSampleConsent[]).map(value =>
                <label key={value}><input type='radio' name={`person-consent-${entry.id}`} data-akari-person-consent={value} checked={consent === value} onChange={() => setConsent(value)} />{VOICE_CONSENT_LABELS[value]}</label>)}</div>
            {sampleFile && !consent && <p>本人の声か、本人の同意を得た声かを選ぶと足せます</p>}
            <button type='button' data-akari-person-voice-add disabled={!canAddVoiceSample(consent, sampleFile?.name)} onClick={addSample}>声を足す</button>
        </section>
        <p data-akari-person-note>写真と声はこの機械の中だけに置きます。クラウドや記憶パックには入りません。声のプロフィールはナレーションを『この人として』作るときに、声のサンプルは文字起こしの話者に名前を付けるときに使います。</p>
        {error && <p className='akari-people-error' role='alert'>{error}</p>}
        <div className='akari-people-form-actions'><button type='button' data-akari-person-save disabled={!name.trim() || invalidBirthday || busy} onClick={() => void save()}>保存</button>
            <button type='button' onClick={props.onBack}>やめる</button></div>
    </div>;
}
