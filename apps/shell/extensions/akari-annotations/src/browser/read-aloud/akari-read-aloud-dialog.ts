import { t } from '@akari-video/i18n';
import URI from '@theia/core/lib/common/uri';
import { AbstractDialog, ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { CommandService } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { channelPeopleLocation, eligibleNarrationPeople, parseChannelPeople, selectNarrationPerson,
    type ChannelPerson } from '../../common/channel-people-reader';
import type { AkariAnnotationsService, GenerateNarrationResult, NarrationEngine, NarrationVoice, VerifyNarrationResult, VoiceProfileSummary } from '../../common/akari-annotations-protocol';
import { batchNarrationEstimate, batchRetryAction, compareNarrationDuration, defaultOverflowAction, falKeyAvailable, irodoriCustomVoiceMissing, narrationEstimate, orderedVoiceProfiles, prepareReadAloudEngine, readAloudAutoVerify, readAloudCopyEngines, readAloudCopyNote, readAloudCopyOptionLabel, readAloudEngineGroups, readAloudKeyMissing, readAloudPrice, readAloudPreviewPlan, readAloudProvider, readAloudProvenanceLabel, readAloudStyleEnabled, selectReadAloudEngine, selectReadAloudVoice, voiceProfileConsent, type OverflowChoice, type ReadAloudRow } from '../../common/read-aloud-model';

export interface ReadAloudTarget {
    captionIds: string[]; captionId?: string; text: string; start: number; end?: number;
    frameSeconds?: number; timeDomain?: 'source' | 'output'; projectRootUri: string;
    rows?: ReadAloudRow[]; replaceIds?: string[];
}
export interface ReadAloudPlacement { result: GenerateNarrationResult; script: string; reading: string; t: number;
    captionId?: string; extendEnd?: number; overflow?: number }

interface BatchRowState { row: ReadAloudRow; reading: string; status: 'wait' | 'running' | 'done' | 'failed';
    result?: GenerateNarrationResult; verification?: VerifyNarrationResult; verificationError?: string;
    verifiedReading?: string; error?: string; choice: OverflowChoice; remainder: number; extendEnd?: number; retried?: boolean }

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, content?: string): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag); if (content !== undefined) node.textContent = content; return node;
};

export class AkariReadAloudDialog extends AbstractDialog<ReadAloudPlacement[] | undefined> {
    protected readonly body = element('div');
    protected readonly cards = element('div');
    protected readonly voiceSelect = element('select');
    protected readonly reading = element('textarea');
    protected readonly freeScript = element('textarea');
    protected readonly speed = element('input');
    protected readonly speedRow = element('label');
    protected readonly styleInput = element('input');
    protected readonly styleRow = element('label');
    protected readonly estimate = element('div');
    protected readonly resultNode = element('div');
    protected readonly notice = element('div');
    protected readonly foot = element('div');
    protected readonly footnote = element('span');
    protected readonly previewButton = element('button', t('annotationscommon.readAloudDialog.label.listening'));
    protected readonly verifyButton = element('button', t('annotationscommon.readAloudDialog.label.makeSureHear'));
    protected readonly verifyNode = element('div');
    protected readonly verifyBatch = element('input');
    protected verificationAvailable = false;
    protected readonly placeButton = element('button', t('annotationscommon.readAloudDialog.action.place'));
    protected engines: NarrationEngine[] = [];
    protected engine?: NarrationEngine;
    protected voices: NarrationVoice[] = [];
    protected profiles: VoiceProfileSummary[] = [];
    protected defaultProfile?: string;
    protected selectedProfile?: VoiceProfileSummary;
    protected voiceMode = false;
    protected readonly profileSelect = element('select');
    protected readonly copyRow = element('label');
    protected readonly copySelect = element('select');
    protected readonly copyNote = element('small');
    protected cloudExpanded = false;
    protected lastCopyEngine?: string;
    protected readonly voiceLabel = element('label', t('annotationscommon.readAloudDialog.label.voice'));
    protected readonly personRow = element('label', t('annotationscommon.readAloudDialog.label.person'));
    protected readonly personSelect = element('select');
    protected people: ChannelPerson[] = [];
    protected result?: GenerateNarrationResult;
    protected audioUrl?: string;
    protected running = false;
    protected overflowChoice: 'extend' | 'retry' | 'keep' = 'extend';
    protected placement?: ReadAloudPlacement;
    protected placements?: ReadAloudPlacement[];
    protected readonly batchRows: BatchRowState[];
    protected readonly batchList = element('div');
    protected readonly progress = element('div');
    protected readonly cancelButton = element('button', t('annotationscommon.readAloudDialog.action.stopRest'));
    protected cancelled = false;

    constructor(protected readonly target: ReadAloudTarget, protected readonly service: AkariAnnotationsService,
        protected readonly files: FileService, protected readonly preferences: PreferenceService,
        protected readonly commands: CommandService,
        protected readonly onPlace: (placements: ReadAloudPlacement[]) => Promise<void>) {
        super({ title: t('annotationscommon.readAloudDialog.title.narration') });
        this.batchRows = (target.rows ?? []).map(row => ({ row, reading: row.text, status: 'wait', choice: 'keep', remainder: 0 }));
        this.node.dataset.akariReadAloudDialog = 'true';
        this.controlPanel.style.display = 'none';
        Object.assign(this.contentNode.parentElement!.style, { width: 'min(760px, calc(100vw - 40px))', maxHeight: 'calc(100vh - 40px)', borderRadius: '12px' });
        Object.assign(this.contentNode.style, { padding: '0', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: 'calc(100vh - 80px)' });
        Object.assign(this.body.style, { padding: '16px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' });
        Object.assign(this.cards.style, { display: 'flex', flexDirection: 'column', gap: '10px' });
        this.body.append(element('h2', this.batchRows.length > 1 ? t('annotationscommon.readAloudDialog.action.readLines', { count: this.batchRows.length, n: this.batchRows.length })
            : target.captionId ? t('annotationscommon.readAloudDialog.action.readOneLine') : t('annotationscommon.readAloudDialog.action.narrateCustomText')));
        if (target.captionId && this.batchRows.length <= 1) {
            this.body.append(element('div', target.text), element('small', t('annotationscommon.readAloudDialog.message.keepCaptionEditReading')));
            this.reading.value = target.text;
        } else if (this.batchRows.length <= 1) {
            this.freeScript.placeholder = t('annotationscommon.readAloudDialog.placeholder.hitTextWantRead');
            this.freeScript.setAttribute('aria-label', t('annotationscommon.readAloudDialog.placeholder.hitTextWantRead'));
            this.body.append(this.freeScript);
            this.freeScript.addEventListener('input', () => { this.invalidate(); this.updateEstimate(); });
        }
        this.personRow.hidden = true;
        this.personSelect.setAttribute('aria-label', t('annotationscommon.readAloudDialog.label.person'));
        this.personSelect.addEventListener('change', () => {
            const person = this.people.find(item => item.id === this.personSelect.value);
            const selection = person && selectNarrationPerson(person, this.profiles, this.engine?.id);
            if (selection) void this.chooseProfile(selection.profile.id, selection.engineId);
        });
        this.personRow.append(this.personSelect);
        this.body.append(this.personRow, this.cards);
        this.estimate.dataset.readAloudEstimate = 'true';
        this.copyRow.dataset.readAloudCopyRow = 'true';
        this.copyNote.dataset.readAloudCopyNote = 'true';
        this.voiceSelect.setAttribute('aria-label', t('annotationscommon.readAloudDialog.label.voice'));
        this.voiceSelect.addEventListener('change', () => { this.invalidate(); this.updateStyleInput(); this.updateEstimate(); void this.saveVoice(); });
        this.body.append(this.voiceLabel, this.voiceSelect);
        this.speed.type = 'range'; this.speed.min = '0.5'; this.speed.max = '2'; this.speed.step = '0.05'; this.speed.value = '1';
        this.speedRow.append(element('span', t('annotationscommon.readAloudDialog.label.speed')), this.speed, element('span', '1.00×'));
        this.speed.addEventListener('input', () => { this.speedRow.lastElementChild!.textContent = `${Number(this.speed.value).toFixed(2)}×`; this.invalidate(); });
        this.body.append(this.speedRow);
        this.styleInput.placeholder = t('annotationscommon.readAloudDialog.placeholder.talkingInstructionOptional'); this.styleInput.setAttribute('aria-label', t('annotationscommon.readAloudDialog.placeholder.talkingInstructionOptional'));
        this.styleRow.append(element('span', t('annotationscommon.readAloudDialog.label.talkingInstructionOptional')), this.styleInput);
        this.styleInput.addEventListener('input', () => { this.invalidate(); this.updatePreviewAvailability(); });
        this.body.append(this.styleRow);
        this.reading.placeholder = t('annotationscommon.readAloudDialog.placeholder.readMore'); this.reading.setAttribute('aria-label', t('annotationscommon.readAloudDialog.placeholder.readMore'));
        this.reading.addEventListener('input', () => { this.invalidate(); this.updateEstimate(); });
        if (this.batchRows.length > 1) {
            this.verifyBatch.type = 'checkbox'; this.verifyBatch.disabled = true;
            this.verifyBatch.dataset.readAloudVerifyBatch = 'true';
            const verifyLabel = element('label', t('annotationscommon.readAloudDialog.message.ifCanCheck')); verifyLabel.prepend(this.verifyBatch);
            this.body.append(verifyLabel, element('small', t('annotationscommon.readAloudDialog.message.listeningOnlyAvailablePcNoCostsTransmissions')), this.batchList, this.progress);
            this.renderBatchRows();
            this.body.append(this.estimate, this.resultNode, this.notice);
        } else {
            this.verifyButton.disabled = true; this.verifyButton.style.display = 'none';
            this.verifyButton.dataset.readAloudAction = 'verify';
            this.verifyButton.addEventListener('click', () => void this.verifySingle());
            this.body.append(element('label', t('annotationscommon.readAloudDialog.placeholder.readMore')), this.reading, this.estimate, this.resultNode,
                this.verifyButton, this.verifyNode, element('small', t('annotationscommon.readAloudDialog.message.listeningOnlyAvailablePcNoCostsTransmissions')), this.notice);
        }
        Object.assign(this.foot.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', borderTop: '1px solid #555' });
        this.footnote.style.flex = '1';
        this.previewButton.dataset.readAloudAction = 'preview';
        this.placeButton.dataset.readAloudAction = 'place';
        this.previewButton.disabled = true;
        this.previewButton.addEventListener('click', () => void this.preview());
        this.placeButton.disabled = true;
        this.placeButton.addEventListener('click', () => void this.place());
        this.cancelButton.dataset.readAloudAction = 'cancel';
        this.cancelButton.style.display = 'none';
        this.cancelButton.addEventListener('click', () => {
            this.cancelled = true;
            if (this.running) void this.service.cancelNarration(this.target.projectRootUri);
        });
        this.foot.append(this.footnote, this.cancelButton, this.previewButton, this.placeButton);
        this.contentNode.append(this.body, this.foot);
        this.toDispose.push({ dispose: () => {
            if (this.running) void this.service.cancelNarration(this.target.projectRootUri);
            if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
        } });
        void this.refreshEngines();
        void this.refreshVerificationBackend();
    }

    get value(): ReadAloudPlacement[] | undefined { return this.placements; }
    protected override handleEnter(_event: KeyboardEvent): boolean { return false; }
    protected script(): string { return this.target.captionId ? this.target.text : this.freeScript.value; }
    protected readingText(): string { return this.reading.value.trim() || this.script(); }
    protected irodoriUrl(): string { return this.preferences.get<string>('akari.narration.irodoriUrl', 'http://127.0.0.1:8088'); }
    protected customVoiceMissing(): boolean { return irodoriCustomVoiceMissing(this.engine?.id, this.voiceSelect.value, this.styleInput.value); }
    protected updateStyleInput(): void {
        const custom = readAloudStyleEnabled(this.engine, this.voiceSelect.value, this.voiceMode)
            && this.engine?.id === 'irodori';
        this.styleRow.style.display = readAloudStyleEnabled(this.engine, this.voiceSelect.value, this.voiceMode) ? '' : 'none';
        this.styleRow.firstElementChild!.textContent = custom ? t('annotationscommon.readAloudDialog.label.requiredVoiceInstructionWithSpace') : t('annotationscommon.readAloudDialog.label.talkingInstructionOptional');
        this.styleInput.setAttribute('aria-label', custom ? t('annotationscommon.readAloudDialog.label.requiredVoiceInstruction') : t('annotationscommon.readAloudDialog.placeholder.talkingInstructionOptional'));
        this.styleInput.placeholder = custom ? t('annotationscommon.readAloudDialog.label.enterVoiceCharacteristicsHowTalk') : t('annotationscommon.readAloudDialog.placeholder.talkingInstructionOptional');
        this.styleInput.required = custom;
        this.updatePreviewAvailability();
    }
    protected updatePreviewAvailability(): void {
        this.previewButton.disabled = !this.engine || !this.voiceSelect.value || this.customVoiceMissing() || this.running
            || this.voiceMode && !this.selectedProfile;
    }
    protected invalidate(): void {
        this.result = undefined; this.placeButton.disabled = true; this.resultNode.replaceChildren();
        this.verifyNode.replaceChildren(); this.verifyButton.style.display = 'none';
        for (const state of this.batchRows) { state.status = 'wait'; state.result = undefined; state.verification = undefined; state.retried = false; }
        if (this.batchRows.length > 1) this.renderBatchRows();
    }

    protected async refreshEngines(): Promise<readonly NarrationEngine[]> {
        try {
            const response = await this.service.listNarrationEngines(this.target.projectRootUri, this.irodoriUrl());
            this.engines = response.engines;
            const fetched = await this.service.voiceProfiles();
            this.defaultProfile = await this.service.voiceDefaultProfile();
            const ordered = orderedVoiceProfiles(fetched.profiles, this.defaultProfile);
            this.profiles = ordered.map(row => row.profile);
            const location = channelPeopleLocation(this.target.projectRootUri);
            let people: ChannelPerson[] = [];
            if (location) {
                try { people = parseChannelPeople((await this.files.readFile(new URI(location.peopleUri))).value.toString()); }
                catch { /* 登録前のチャンネル */ }
            }
            this.people = eligibleNarrationPeople(people, this.profiles);
            this.personRow.hidden = this.people.length === 0;
            this.personSelect.replaceChildren();
            const emptyPerson = element('option', t('annotationscommon.readAloudDialog.action.selectPerson')); emptyPerson.value = '';
            this.personSelect.append(emptyPerson);
            for (const person of this.people) {
                const option = element('option', person.name); option.value = person.id;
                this.personSelect.append(option);
            }
            const preferred = this.voiceMode ? `voice:${this.selectedProfile?.id ?? ''}` : this.engine?.id ?? this.preferences.get<string>('akari.narration.engine', 'voicevox');
            const selected = selectReadAloudEngine(this.engines, preferred);
            this.cards.replaceChildren();
            const groups = readAloudEngineGroups(this.engines, preferred);
            const localGroup = element('section'); localGroup.dataset.engineGroup = 'local';
            localGroup.append(element('h3', t('annotationscommon.readAloudDialog.label.free')));
            const cloudGroup = element('section'); cloudGroup.dataset.engineGroup = 'cloud';
            cloudGroup.append(element('h3', t('annotationscommon.readAloudDialog.label.cloudPerPerson')));
            for (const engine of [...groups.local, ...(this.cloudExpanded ? groups.cloud : groups.visible)]) {
                const card = element('label'); card.dataset.engine = engine.id;
                Object.assign(card.style, { display: 'block', padding: '7px 10px', marginBottom: '4px', border: '1px solid #777', borderRadius: '6px', opacity: readAloudKeyMissing(engine) ? '.5' : '1' });
                const radio = element('input'); radio.type = 'radio'; radio.name = 'read-aloud-engine'; radio.value = engine.id;
                radio.disabled = engine.availability.state !== 'available'
                    && !(engine.id === 'voicevox' && engine.availability.state === 'needs');
                radio.checked = !preferred.startsWith('voice:') && selected?.id === engine.id;
                radio.addEventListener('change', () => void this.chooseEngine(engine));
                const line = element('div');
                Object.assign(line.style, { display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '8px', rowGap: '2px' });
                line.append(radio, element('strong', engine.id === 'irodori' ? t('annotationscommon.readAloudDialog.label.irodoriTrial') : engine.label),
                    element('span', `${engine.place === 'cloud' ? readAloudProvider(engine) : engine.place === 'network' ? t('annotationscommon.readAloudDialog.label.anotherPc') : t('annotationscommon.readAloudDialog.label.computer')} · ${readAloudPrice(engine)}`));
                card.append(line);
                if (engine.caution) { const caution = element('small', engine.caution); caution.style.display = 'block'; card.append(caution); }
                if (engine.id === 'irodori') { const note = element('small', t('annotationscommon.readAloudDialog.label.gpuRecommendedHeavyProcessing')); note.style.display = 'block'; card.append(note); }
                if (engine.availability.state === 'needs' || engine.availability.state === 'unconfigured') {
                    const badge = element('button', engine.availability.label);
                    badge.dataset.availability = engine.availability.state;
                    badge.style.marginTop = '4px';
                    badge.addEventListener('click', () => {
                    void this.commands.executeCommand('akari.settings.open', engine.place === 'cloud' ? 'connections' : 'narration')
                        .then(() => this.refreshEngines());
                    });
                    card.append(badge);
                }
                (engine.place === 'cloud' ? cloudGroup : localGroup).append(card);
            }
            if (groups.hidden.length || this.cloudExpanded) {
                const more = element('button', this.cloudExpanded ? t('annotationscommon.readAloudDialog.action.close') : t('annotationscommon.readAloudDialog.label.otherClouds', { count: groups.hidden.length, n: groups.hidden.length }));
                more.dataset.readAloudMoreCloud = 'true';
                more.addEventListener('click', () => { this.cloudExpanded = !this.cloudExpanded; void this.refreshEngines(); });
                cloudGroup.append(more);
            }
            this.cards.append(localGroup, cloudGroup);
            const card = element('section'); card.dataset.engine = 'voice'; card.dataset.engineGroup = 'voice';
            Object.assign(card.style, { padding: '10px', border: '1px solid #777', borderRadius: '8px' });
            card.append(element('h3', t('annotationscommon.readAloudDialog.label.myVoiceWithIcon')));
            const radio = element('input'); radio.type = 'radio'; radio.name = 'read-aloud-engine'; radio.value = 'voice';
            radio.checked = preferred.startsWith('voice:');
            radio.addEventListener('change', () => void this.chooseProfile(
                this.profiles.find(profile => profile.id === this.profileSelect.value && voiceProfileConsent(profile))?.id
                ?? this.profiles.find(voiceProfileConsent)?.id ?? ''));
            const profileRow = element('div');
            Object.assign(profileRow.style, { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' });
            const radioLabel = element('label'); radioLabel.append(radio, element('span', t('annotationscommon.readAloudDialog.label.voice')));
            profileRow.append(radioLabel);
            this.profileSelect.setAttribute('aria-label', t('annotationscommon.readAloudDialog.label.myVoice'));
            this.profileSelect.replaceChildren(...ordered.map(({ profile, selectable }) => {
                const option = element('option', `${profile.label}${profile.legacy ? t('annotationscommon.readAloudDialog.label.oldPlace') : ''}`);
                option.value = profile.id; option.disabled = !selectable; return option;
            }));
            const create = element('option', t('annotationscommon.readAloudDialog.message.newlyMade')); create.value = '__create__'; this.profileSelect.append(create);
            this.profileSelect.onchange = () => {
                if (this.profileSelect.value === '__create__') void this.commands.executeCommand('akari.voice.create').then(() => this.refreshEngines());
                else void this.chooseProfile(this.profileSelect.value);
            };
            profileRow.append(this.profileSelect); card.append(profileRow);
            this.copySelect.setAttribute('aria-label', t('annotationscommon.readAloudDialog.action.makeOwnVoice'));
            this.copySelect.dataset.readAloudCopyEngine = 'true';
            this.copyRow.hidden = this.copyNote.hidden = !this.voiceMode;
            Object.assign(this.copyRow.style, { display: this.voiceMode ? 'block' : 'none', marginTop: '8px' });
            Object.assign(this.copySelect.style, { display: 'block', width: '100%', boxSizing: 'border-box', marginTop: '4px' });
            Object.assign(this.copyNote.style, { display: this.voiceMode ? 'block' : 'none', marginTop: '4px' });
            this.copySelect.onchange = () => void this.chooseCopyEngine(this.copySelect.value);
            this.copyRow.replaceChildren(element('span', t('annotationscommon.readAloudDialog.label.provider')), this.copySelect);
            card.append(this.copyRow, this.copyNote);
            if (!this.profiles.length) {
                const empty = element('button', t('annotationscommon.readAloudDialog.label.notYetMake'));
                empty.addEventListener('click', () => void this.commands.executeCommand('akari.voice.create').then(() => this.refreshEngines()));
                card.append(empty);
            }
            const badge = element('div'); badge.dataset.voiceCopyBadge = 'true'; badge.hidden = true;
            card.append(badge); this.cards.append(card);
            if (preferred.startsWith('voice:') && this.profiles.length) {
                const valid = this.profiles.filter(voiceProfileConsent);
                const id = valid.some(profile => profile.id === preferred.slice(6)) ? preferred.slice(6)
                    : valid.find(profile => profile.id === this.defaultProfile)?.id ?? valid[0]?.id;
                if (!id) { if (selected) await this.chooseEngine(selected); return this.engines; }
                this.profileSelect.value = id;
                const profile = this.profiles.find(item => item.id === id);
                if (profile && this.voiceMode && this.selectedProfile?.id === id) await this.chooseProfile(id, this.engine?.id);
                else await this.chooseProfile(id);
            } else if (selected && !this.voiceMode && this.engine?.id === selected.id) this.engine = selected;
            else if (selected) await this.chooseEngine(selected);
        } catch (error) { this.notice.textContent = String(error); }
        return this.engines;
    }

    protected async refreshVerificationBackend(): Promise<void> {
        try {
            const result = await this.service.narrationVerificationBackend(this.target.projectRootUri);
            this.verificationAvailable = result.status === 'ok';
            const tooltip = t('annotationscommon.readAloudDialog.error.localTranscriptionWhisperRequired');
            this.verifyButton.disabled = !this.verificationAvailable || !this.result;
            this.verifyButton.title = this.verificationAvailable ? '' : tooltip;
            this.verifyBatch.disabled = !this.verificationAvailable;
            this.verifyBatch.title = this.verificationAvailable ? '' : tooltip;
            if (!this.verificationAvailable) this.verifyBatch.checked = false;
        } catch {
            this.verificationAvailable = false;
            this.verifyButton.disabled = true; this.verifyBatch.disabled = true;
            this.verifyButton.title = this.verifyBatch.title = t('annotationscommon.readAloudDialog.error.localTranscriptionWhisperRequired');
        }
    }

    protected async ensureVoicevoxReady(): Promise<void> {
        if (!this.engine || this.engine.id !== 'voicevox' || this.engine.availability.state !== 'needs') return;
        this.notice.textContent = t('annotationscommon.readAloudDialog.text.voicevoxLaunched');
        await prepareReadAloudEngine(this.engine,
            () => this.service.startNarrationEngine(this.target.projectRootUri, 'voicevox'),
            () => this.refreshEngines());
        this.notice.textContent = '';
    }

    protected async prepareGenerationEngine(engine: NarrationEngine): Promise<void> {
        await this.ensureVoicevoxReady();
        await this.refreshEngines();
        await this.ensureVoicevoxReady();
        if (this.engine?.id !== engine.id || this.engine.availability.state !== 'available'
            && !falKeyAvailable(this.engine)) {
            throw new Error(t('annotationscommon.readAloudDialog.error.notAvailable', { engineName: engine.label }));
        }
    }

    protected async chooseEngine(engine: NarrationEngine): Promise<void> {
        if (engine.availability.state !== 'available'
            && !(engine.id === 'voicevox' && engine.availability.state === 'needs')) return;
        this.voiceMode = false; this.selectedProfile = undefined;
        this.copyRow.hidden = this.copyNote.hidden = true;
        this.copyRow.style.display = this.copyNote.style.display = 'none';
        this.voiceLabel.style.display = this.voiceSelect.style.display = '';
        this.engine = engine; this.invalidate();
        this.previewButton.disabled = true;
        this.cards.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach(radio => { radio.checked = radio.value === engine.id; });
        this.speedRow.style.display = engine.supports?.speed ? '' : 'none';
        this.styleRow.style.display = readAloudStyleEnabled(engine, this.voiceSelect.value, false) ? '' : 'none';
        this.speed.min = engine.id === 'irodori' ? '0.25' : '0.5'; this.speed.max = engine.id === 'irodori' ? '4' : '2';
        const plan = readAloudPreviewPlan(engine, this.readingText());
        this.previewButton.textContent = this.batchRows.length > 1
            ? engine.place === 'cloud' ? t('annotationscommon.readAloudDialog.message.costsSeeMake') : t('annotationscommon.readAloudDialog.action.make') : plan.buttonLabel;
        this.footnote.textContent = this.batchRows.length > 1 && engine.place === 'cloud'
            ? t('annotationscommon.readAloudDialog.message.cloudCostApprovalOneTimeTotalQuotation') : plan.footnote;
        await this.preferences.set('akari.narration.engine', engine.id, PreferenceScope.User);
        try {
            const response = await this.service.listNarrationVoices(this.target.projectRootUri, engine.id, this.irodoriUrl());
            if (this.engine?.id !== engine.id || this.voiceMode) return;
            this.voices = response.voices;
            this.voiceSelect.replaceChildren(...response.voices.map(voice => {
                const option = element('option', voice.label); option.value = voice.id; return option;
            }));
            const saved = this.preferences.get<Record<string, string>>('akari.narration.voice', {});
            this.voiceSelect.value = selectReadAloudVoice(response.voices, saved[engine.id])?.id ?? '';
            this.updateStyleInput();
            this.updateEstimate();
        } catch (error) { this.notice.textContent = String(error); }
    }
    protected async chooseProfile(id: string, current?: string): Promise<void> {
        const profile = this.profiles.find(item => item.id === id);
        if (!profile || !voiceProfileConsent(profile)) return;
        const savedCopy = this.preferences.get<Record<string, string>>('akari.narration.voice', {})[`voice-maker:${id}`];
        const choice = readAloudCopyEngines(profile, this.engines, savedCopy ?? this.lastCopyEngine);
        const selected = choice.options.some(row => row.engine.id === current && row.usable) ? current : choice.selected;
        const changed = !this.voiceMode || this.selectedProfile?.id !== id || this.engine?.id !== selected;
        this.voiceMode = true; this.selectedProfile = profile;
        this.copyRow.hidden = this.copyNote.hidden = false;
        this.copyRow.style.display = this.copyNote.style.display = 'block';
        this.profileSelect.value = id;
        this.cards.querySelectorAll<HTMLInputElement>('input[type=radio]').forEach(radio => { radio.checked = radio.value === 'voice'; });
        this.copySelect.replaceChildren(...choice.options.map(row => {
            const option = element('option', readAloudCopyOptionLabel(row));
            option.value = row.engine.id; option.disabled = !row.usable; return option;
        }));
        this.copySelect.value = selected ?? '';
        this.renderVoiceBadge(selected ? '' : t('annotationscommon.readAloudDialog.label.noMakerAvailable'), !selected);
        if (changed) this.invalidate();
        this.voiceLabel.style.display = this.voiceSelect.style.display = 'none';
        this.voiceSelect.replaceChildren();
        const option = element('option', profile.label); option.value = profile.id; this.voiceSelect.append(option); this.voiceSelect.value = profile.id;
        this.engine = selected ? this.engines.find(item => item.id === selected) : undefined;
        const copy = choice.options.find(row => row.engine.id === selected);
        this.copyNote.textContent = !selected || !copy ? t('annotationscommon.readAloudDialog.message.checkKeyCopySettingReadUp') : readAloudCopyNote(copy);
        this.speedRow.style.display = this.engine?.supports?.speed ? '' : 'none';
        this.styleRow.style.display = readAloudStyleEnabled(this.engine, this.voiceSelect.value, true) ? '' : 'none';
        if (this.engine) {
            const plan = readAloudPreviewPlan(this.engine, this.readingText());
            this.previewButton.textContent = this.batchRows.length > 1 ? this.engine.place === 'cloud' ? t('annotationscommon.readAloudDialog.message.costsSeeMake') : t('annotationscommon.readAloudDialog.action.make') : plan.buttonLabel;
            this.footnote.textContent = this.engine.supports?.clone === 'per-request'
                ? t('annotationscommon.readAloudDialog.message.cloudOnceHaveCostApprovalBeforeListening') : plan.footnote;
        }
        else { this.estimate.textContent = t('annotationscommon.readAloudDialog.label.noMakerAvailable'); this.footnote.textContent = t('annotationscommon.readAloudDialog.text.checkSettingReadUpCopyOwnVoice'); }
        this.updateEstimate(); this.updatePreviewAvailability();
        if (selected) await this.preferences.set('akari.narration.engine', `voice:${id}`, PreferenceScope.User);
    }
    protected async chooseCopyEngine(id: string): Promise<void> {
        if (!this.selectedProfile) return;
        const saved = this.preferences.get<Record<string, string>>('akari.narration.voice', {});
        await this.preferences.set('akari.narration.voice', { ...saved, [`voice-maker:${this.selectedProfile.id}`]: id }, PreferenceScope.User);
        this.lastCopyEngine = id;
        await this.chooseProfile(this.selectedProfile.id, id);
    }
    protected renderVoiceBadge(label: string, missing: boolean): void {
        const host = this.cards.querySelector<HTMLElement>('[data-voice-copy-badge]');
        if (!host) return;
        host.hidden = !label;
        const pill = element(missing ? 'button' : 'span', label);
        if (missing) pill.addEventListener('click', () => void this.commands.executeCommand('akari.settings.open', 'narration'));
        host.replaceChildren(pill);
    }
    protected async saveVoice(): Promise<void> {
        if (!this.engine) return;
        const saved = this.preferences.get<Record<string, string>>('akari.narration.voice', {});
        await this.preferences.set('akari.narration.voice', { ...saved, [this.engine.id]: this.voiceSelect.value }, PreferenceScope.User);
    }
    protected updateEstimate(): void {
        if (!this.engine) return;
        const quote = this.batchRows.length > 1
            ? batchNarrationEstimate(this.engine, this.batchRows.map(state => state.reading))
            : narrationEstimate(this.engine, this.readingText());
        const voice = this.voices.find(item => item.id === this.voiceSelect.value);
        this.estimate.textContent = t('annotationscommon.readAloudDialog.text.linesCharactersTotal', { engine: this.voiceMode ? t('annotationscommon.readAloudDialog.label.myVoiceWithIcon') : this.engine.label, rows: this.batchRows.length > 1 ? this.batchRows.length : 1, characters: quote.chars, estimate: quote.label, credit: this.engine.id === 'voicevox' && voice?.group ? t('annotationscommon.readAloudDialog.estimate.creditVoicevox', { group: voice.group }) : '' });
    }

    protected async preview(): Promise<void> {
        if (this.batchRows.length > 1) { await this.generateBatch(); return; }
        if (!this.engine || this.running || !this.script().trim() || this.customVoiceMissing()) return;
        const engine = this.engine;
        const reading = this.readingText();
        const plan = readAloudPreviewPlan(engine, reading);
        let approved = false;
        if (plan.needsApproval) {
            approved = await new ConfirmDialog(plan.confirm!).open();
            if (!approved) return;
        }
        let generated = false;
        this.running = true; this.previewButton.disabled = true; this.previewButton.textContent = t('annotationscommon.readAloudDialog.text.generating'); this.notice.textContent = engine.id === 'irodori' ? t('annotationscommon.readAloudDialog.label.takesTimeTry') : '';
        try {
            await this.prepareGenerationEngine(engine);
            const result = await this.service.generateNarration({ projectRootUri: this.target.projectRootUri,
                engine: engine.id, voice: this.voiceSelect.value, profile: this.voiceMode ? this.selectedProfile?.id : undefined, speed: engine.supports?.speed ? Number(this.speed.value) : undefined,
                style: readAloudStyleEnabled(engine, this.voiceSelect.value, this.voiceMode) ? this.styleInput.value : undefined,
                irodoriUrl: engine.id === 'irodori' ? this.irodoriUrl() : undefined, script: this.script(), reading,
                captionId: this.target.captionId ?? null, t: this.target.start, approved });
            if (result.status !== 'ok' || !result.path || result.duration_s === undefined) throw new Error(t('annotationscommon.readAloudDialog.error.generateAudio'));
            this.result = result;
            generated = true;
            this.verifyButton.style.display = '';
            this.verifyButton.disabled = !this.verificationAvailable;
            const file = await this.files.readFile(new URI(this.target.projectRootUri).resolve(result.path));
            if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
            this.audioUrl = URL.createObjectURL(new Blob([file.value.buffer as ArrayBuffer], { type: result.path.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }));
            const audio = element('audio'); audio.controls = true; audio.src = this.audioUrl;
            const duration = result.duration_s;
            const frame = this.target.frameSeconds;
            const comparison = compareNarrationDuration(frame, duration, this.target.timeDomain, !!engine.supports?.speed);
            if (comparison.overflow === 0) this.overflowChoice = 'keep';
            this.resultNode.replaceChildren(audio, element('div', t('annotationscommon.readAloudDialog.label.subtitlesVotedAudioS', { frameDuration: frame === undefined ? '—' : frame.toFixed(1) + ' s', audioDuration: duration.toFixed(1) })));
            if (comparison.overflow > 0) {
                this.resultNode.append(element('div', t('annotationscommon.readAloudDialog.label.overflowS', { seconds: comparison.overflow.toFixed(1) })));
                const options = element('div');
                const add = (choice: 'extend' | 'retry' | 'keep', label: string, disabled: boolean, title?: string): void => {
                    const line = element('label'); const radio = element('input'); radio.type = 'radio'; radio.name = 'read-aloud-overflow';
                    radio.value = choice; radio.disabled = disabled; radio.checked = choice === (comparison.extendEnabled ? 'extend' : 'keep');
                    if (title) line.title = title;
                    radio.addEventListener('change', () => { this.overflowChoice = choice; });
                    line.append(radio, element('span', label)); options.append(line);
                };
                this.overflowChoice = comparison.extendEnabled ? 'extend' : 'keep';
                add('extend', t('annotationscommon.readAloudDialog.label.stretchSubtitleFrameSDefault', { duration: duration.toFixed(1) }), !comparison.extendEnabled,
                    this.target.timeDomain === 'source' ? t('annotationscommon.readAloudDialog.label.spokenWordLinesCannotBeExtended') : undefined);
                if (engine.supports?.speed) add('retry', t('annotationscommon.readAloudDialog.label.regenerate', { amount: comparison.recommendedSpeed.toFixed(2) }), !comparison.retryEnabled);
                add('keep', t('annotationscommon.readAloudDialog.label.remainsQc'), false);
                this.resultNode.append(options);
            }
        } catch (error) { this.notice.textContent = String(error); }
        finally { await this.refreshEngines(); this.running = false;
            this.placeButton.disabled = !this.result;
            this.updatePreviewAvailability(); this.previewButton.textContent = plan.buttonLabel;
            if (generated && readAloudAutoVerify(engine.id, this.verificationAvailable)) await this.verifySingle(); }
    }

    protected async verifySingle(): Promise<void> {
        if (!this.result?.path || !this.verificationAvailable || this.running) return;
        this.verifyButton.disabled = true; this.verifyNode.textContent = t('annotationscommon.readAloudDialog.text.transcribing');
        try {
            const result = await this.service.verifyNarration({ projectRootUri: this.target.projectRootUri,
                audio: this.result.path, text: this.script(), reading: this.readingText() });
            this.verifyNode.replaceChildren(element('div', t('annotationscommon.readAloudDialog.label.match', { percent: Math.round(result.score * 100), verdict: result.verdict })));
            for (const diff of result.diffs) this.verifyNode.append(element('div', t('annotationscommon.readAloudDialog.label.expectedVsHeard', { expected: diff.expected || t('annotationscommon.readAloudDialog.hint.none'), heard: diff.heard || t('annotationscommon.readAloudDialog.hint.none') })));
            if (result.diffs.length) {
                const revise = element('button', t('annotationscommon.readAloudDialog.action.makeReadingsAgain'));
                revise.addEventListener('click', () => this.reading.focus()); this.verifyNode.append(revise);
            }
        } catch (error) { this.verifyNode.textContent = String(error); }
        finally { this.verifyButton.disabled = !this.verificationAvailable; }
    }

    protected async place(): Promise<void> {
        if (this.batchRows.length > 1) {
            if (this.running) return;
            const retryRows = this.batchRows.filter(state => state.status === 'done' && state.choice === 'retry');
            if (retryRows.length && this.engine) {
                const engine = this.engine;
                let approved = false;
                if (engine.place === 'cloud') {
                    const quote = batchNarrationEstimate(engine, retryRows.map(state => state.reading));
                    approved = await new ConfirmDialog({ title: t('annotationscommon.readAloudDialog.title.costApproval'),
                        msg: quote.usd === null ? t('annotationscommon.readAloudDialog.error.estimateUnavailableSendingWillIncurUsageCharges', { provider: readAloudProvider(engine) }) :
                            t('annotationscommon.readAloudDialog.action.createLinesTotalDoAcceptCosts', { count: retryRows.length, n: retryRows.length, amount: quote.usd.toFixed(3) }),
                        ok: t('annotationscommon.readAloudDialog.label.costApproval'), cancel: t('annotationscommon.readAloudDialog.action.cancel') }).open();
                    if (!approved) return;
                }
                this.running = true; this.placeButton.disabled = true;
                for (const state of retryRows) {
                    try {
                        const speed = compareNarrationDuration(state.row.end - state.row.start,
                            state.result?.duration_s ?? 0, state.row.timeDomain, true).recommendedSpeed;
                        const result = await this.service.generateNarration({ projectRootUri: this.target.projectRootUri,
                            engine: engine.id, voice: this.voiceSelect.value, speed,
                            style: readAloudStyleEnabled(engine, this.voiceSelect.value, this.voiceMode) ? this.styleInput.value : undefined,
                            irodoriUrl: engine.id === 'irodori' ? this.irodoriUrl() : undefined, script: state.row.text,
                            reading: state.reading, captionId: state.row.id, t: state.row.outputStart!, approved });
                        if (result.status !== 'ok' || !result.path || result.duration_s === undefined) throw new Error(t('annotationscommon.readAloudDialog.error.regenerate'));
                        state.result = result; state.remainder = Math.max(0, result.duration_s - (state.row.end - state.row.start));
                        state.choice = 'keep'; state.retried = true;
                    } catch (error) { state.status = 'failed'; state.error = String(error); }
                    this.renderBatchRows();
                }
                this.running = false;
            }
            const ready = this.batchRows.filter(state => state.status === 'done' && state.result?.path);
            if (!ready.length) return;
            const placements = ready.map(state => ({ result: state.result!, script: state.row.text, reading: state.reading,
                t: state.row.outputStart!, captionId: state.row.id,
                ...(state.choice === 'extend' && state.extendEnd !== undefined && state.extendEnd > state.row.end
                    ? { extendEnd: state.extendEnd } : {}),
                ...(state.remainder > 0 ? { overflow: state.remainder } : {}) }));
            this.placeButton.disabled = true;
            try { await this.onPlace(placements); this.placements = placements; this.showDone(placements); }
            catch (error) { this.notice.textContent = String(error); this.placeButton.disabled = false; }
            return;
        }
        if (!this.result || this.running) return;
        if (this.overflowChoice === 'retry') {
            const frame = this.target.frameSeconds ?? 0;
            const recommended = compareNarrationDuration(frame, this.result.duration_s ?? 0, this.target.timeDomain, true).recommendedSpeed;
            this.speed.value = String(recommended); this.invalidate(); await this.preview(); return;
        }
        this.placeButton.disabled = true;
        const placement: ReadAloudPlacement = { result: this.result, script: this.script(), reading: this.readingText(),
            t: this.target.start, captionId: this.target.captionId,
            ...(this.overflowChoice === 'extend' && this.target.end !== undefined && this.target.timeDomain === 'output'
                && (this.result.duration_s ?? 0) > (this.target.frameSeconds ?? Infinity)
                ? { extendEnd: this.target.start + (this.result.duration_s ?? 0) } : {}) };
        try { await this.onPlace([placement]); this.placement = placement; this.placements = [placement]; this.showDone([placement]); }
        catch (error) { this.notice.textContent = String(error); this.placeButton.disabled = false; }
    }

    protected renderBatchRows(): void {
        this.batchList.replaceChildren(...this.batchRows.map((state, index) => {
            const line = element('div'); line.dataset.readAloudRow = state.row.id;
            Object.assign(line.style, { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px', borderBottom: '1px solid #555' });
            line.append(element('span', `${state.row.outputStart?.toFixed(1) ?? '—'} s`), element('span', state.row.text));
            const input = element('input'); input.value = state.reading; input.setAttribute('aria-label', t('annotationscommon.readAloudDialog.action.readValue', { index: index + 1 }));
            input.style.flex = '1'; input.disabled = this.running; input.addEventListener('input', () => {
                state.reading = input.value;
                if (state.status !== 'failed') state.status = state.verifiedReading === state.reading ? 'done' : 'wait';
                this.placeButton.disabled = state.status !== 'done'; this.updateEstimate();
                statusLabel.textContent = state.status === 'done' ? doneLabel : state.status === 'failed' ? t('annotationscommon.readAloudDialog.error.failed', { error: state.error ?? '' }) : t('annotationscommon.readAloudDialog.action.read');
                if (verificationBadge) verificationBadge.style.display = state.status === 'done' ? '' : 'none';
                if (playButton) playButton.style.display = state.status === 'done' ? '' : 'none';
            }); line.append(input);
            const doneLabel = t('annotationscommon.readAloudDialog.label.sFrame', { audioDuration: (state.result?.duration_s ?? 0).toFixed(1), frameDuration: (state.row.end - state.row.start).toFixed(1) })
                    + `${state.choice === 'extend' ? t('annotationscommon.readAloudDialog.label.extendFrameSuffix') : ''}`
                    + `${state.remainder ? t('annotationscommon.readAloudDialog.label.slenderS', { seconds: state.remainder.toFixed(1) }) : ''}`;
            const statusLabel = element('span', state.status === 'done' ? doneLabel
                : state.status === 'running' ? t('annotationscommon.readAloudDialog.label.rate') : state.status === 'failed' ? t('annotationscommon.readAloudDialog.error.failed', { error: state.error ?? '' })
                    : state.verifiedReading !== undefined ? t('annotationscommon.readAloudDialog.action.read') : t('annotationscommon.readAloudDialog.label.waiting'));
            line.append(statusLabel);
            let verificationBadge: HTMLSpanElement | undefined;
            let playButton: HTMLButtonElement | undefined;
            if (state.status === 'done' && state.verification) {
                const badge = element('span', t('annotationscommon.readAloudDialog.label.match', { percent: Math.round(state.verification.score * 100), verdict: state.verification.verdict }));
                badge.dataset.verifyVerdict = state.verification.verdict;
                badge.style.color = state.verification.verdict === 'ng' ? '#ff7777' : state.verification.verdict === 'check' ? '#e9bc55' : '#aaa';
                verificationBadge = badge;
                line.append(badge);
            } else if (state.verificationError) line.append(element('span', t('annotationscommon.readAloudDialog.error.failureHear', { reason: state.verificationError })));
            if (state.status === 'done' && state.result?.path) {
                const play = element('button', '▶'); play.type = 'button'; play.setAttribute('aria-label', t('annotationscommon.readAloudDialog.action.preview', { index: index + 1 }));
                play.addEventListener('click', () => void this.playBatchRow(state)); line.append(play);
                playButton = play;
            }
            const retryAction = () => batchRetryAction({ status: state.status, verdict: state.verification?.verdict,
                reading: state.reading, verifiedReading: state.verifiedReading });
            if (retryAction() !== 'none') {
                const retry = element('button', t('annotationscommon.readAloudDialog.action.tryAgain')); retry.type = 'button'; retry.disabled = this.running;
                retry.addEventListener('click', () => {
                    const action = retryAction();
                    if (action === 'focus-reading') input.focus();
                    else if (action === 'regenerate') void this.generateBatch([state]);
                }); line.append(retry);
            }
            if (state.status === 'done' && (state.result?.duration_s ?? 0) > state.row.end - state.row.start) {
                const choice = element('select'); choice.setAttribute('aria-label', t('annotationscommon.readAloudDialog.label.overlap', { index: index + 1 }));
                for (const [value, label] of [['extend', t('annotationscommon.readAloudDialog.label.extendFrame')], ['retry', t('annotationscommon.readAloudDialog.action.makeSpeed')], ['keep', t('annotationscommon.readAloudDialog.action.placeAs')]] as const) {
                    if (value === 'extend' && state.row.timeDomain !== 'output') continue;
                    if (value === 'retry' && !this.engine?.supports?.speed) continue;
                    const option = element('option', label); option.value = value; choice.append(option);
                }
                choice.value = state.choice; choice.addEventListener('change', () => {
                    state.choice = choice.value as OverflowChoice;
                    const overflow = Math.max(0, (state.result?.duration_s ?? 0) - (state.row.end - state.row.start));
                    if (state.choice === 'extend') {
                        const action = defaultOverflowAction({ frameSeconds: state.row.end - state.row.start,
                            durationSeconds: state.result?.duration_s ?? 0, timeDomain: state.row.timeDomain,
                            enginePlace: this.engine?.place ?? 'local', speedSupported: !!this.engine?.supports?.speed,
                            start: state.row.outputStart!, nextStart: state.row.nextStart });
                        state.extendEnd = action.extendEnd; state.remainder = action.remainder;
                    } else { state.extendEnd = undefined; state.remainder = overflow; }
                    this.renderBatchRows();
                });
                line.append(choice);
            }
            return line;
        }));
        const done = this.batchRows.filter(state => state.status === 'done').length;
        this.progress.textContent = `${done} / ${this.batchRows.length}`;
        this.progress.setAttribute('data-progress', `${done}/${this.batchRows.length}`);
        this.placeButton.textContent = t('annotationscommon.readAloudDialog.text.put', { count: done, n: done });
        this.placeButton.disabled = done === 0 || this.running;
    }

    protected async playBatchRow(state: BatchRowState): Promise<void> {
        if (!state.result?.path) return;
        const file = await this.files.readFile(new URI(this.target.projectRootUri).resolve(state.result.path));
        const url = URL.createObjectURL(new Blob([file.value.buffer as ArrayBuffer], { type: state.result.path.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg' }));
        const audio = new Audio(url); audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
    }

    protected async generateBatch(only?: BatchRowState[]): Promise<void> {
        if (!this.engine || this.running || this.customVoiceMissing()) return;
        const engine = this.engine;
        const pending = only ?? this.batchRows.filter(state => state.status !== 'done');
        if (!pending.length) return;
        let approved = false;
        if (engine.place === 'cloud') {
            const quote = batchNarrationEstimate(engine, pending.map(state => state.reading));
            approved = await new ConfirmDialog({ title: t('annotationscommon.readAloudDialog.title.costApproval'),
                msg: quote.usd === null ? t('annotationscommon.readAloudDialog.error.estimateUnavailableSendingWillIncurUsageCharges', { provider: readAloudProvider(engine) }) :
                    t('annotationscommon.readAloudDialog.message.asReturnsLineWillAcceptCost', { amount: quote.usd.toFixed(3), asOf: engine.price?.as_of ?? t('annotationscommon.readAloudDialog.label.notConfirmed'), rows: pending.length, n: pending.length }),
                ok: t('annotationscommon.readAloudDialog.label.costApproval'), cancel: t('annotationscommon.readAloudDialog.action.cancel') }).open();
            if (!approved) return;
        }
        this.running = true; this.cancelled = false; this.cancelButton.style.display = '';
        this.notice.textContent = engine.id === 'irodori' ? t('annotationscommon.readAloudDialog.label.takesTimeTry') : '';
        this.previewButton.disabled = true;
        try { await this.prepareGenerationEngine(engine); }
        catch (error) {
            this.notice.textContent = String(error); this.running = false; this.cancelButton.style.display = 'none';
            this.updatePreviewAvailability(); return;
        }
        for (const state of pending) {
            if (this.cancelled) break;
            state.result = undefined; state.verification = undefined; state.verifiedReading = undefined;
            state.status = 'running'; this.renderBatchRows();
            try {
                const generate = (speed?: number) => this.service.generateNarration({ projectRootUri: this.target.projectRootUri,
                    engine: engine.id, voice: this.voiceSelect.value, profile: this.voiceMode ? this.selectedProfile?.id : undefined, speed: speed ?? (engine.supports?.speed ? Number(this.speed.value) : undefined),
                    style: readAloudStyleEnabled(engine, this.voiceSelect.value, this.voiceMode) ? this.styleInput.value : undefined,
                    irodoriUrl: engine.id === 'irodori' ? this.irodoriUrl() : undefined,
                    script: state.row.text, reading: state.reading, captionId: state.row.id, t: state.row.outputStart!, approved });
                let result = await generate();
                if (result.status !== 'ok' || !result.path || result.duration_s === undefined) throw new Error(t('annotationscommon.readAloudDialog.error.generateAudio'));
                let action = defaultOverflowAction({ frameSeconds: state.row.end - state.row.start,
                    durationSeconds: result.duration_s, timeDomain: state.row.timeDomain, enginePlace: engine.place,
                    speedSupported: !!engine.supports?.speed, start: state.row.outputStart!, nextStart: state.row.nextStart });
                if (action.choice === 'retry') {
                    state.retried = true;
                    try {
                        const retry = await generate(action.recommendedSpeed);
                        if (retry.status !== 'ok' || !retry.path || retry.duration_s === undefined) throw new Error(t('annotationscommon.readAloudDialog.error.regenerate'));
                        result = retry;
                    } catch (error) { state.error = t('annotationscommon.readAloudDialog.error.reCreatedFailureRecommendedSpeed', { error: String(error) }); }
                    action = { ...action, choice: 'keep', remainder: Math.max(0, result.duration_s - (state.row.end - state.row.start)) };
                }
                state.result = result; state.verifiedReading = state.reading; state.verificationError = undefined;
                state.choice = action.choice; state.remainder = action.remainder;
                state.extendEnd = action.extendEnd; state.status = 'done';
                this.renderBatchRows();
                if (this.verifyBatch.checked && this.verificationAvailable) {
                    try { state.verification = await this.service.verifyNarration({ projectRootUri: this.target.projectRootUri,
                        audio: result.path, text: state.row.text, reading: state.reading }); }
                    catch (error) { state.verificationError = String(error); }
                }
            } catch (error) { state.error = String(error); state.status = 'failed'; }
            this.renderBatchRows();
        }
        await this.refreshEngines();
        this.running = false; this.cancelButton.style.display = 'none'; this.updatePreviewAvailability();
        this.renderBatchRows();
    }

    protected showDone(placements: ReadAloudPlacement[]): void {
        const extended = placements.filter(item => item.extendEnd !== undefined).length;
        const overflow = placements.filter(item => (item.overflow ?? 0) > 0).length;
        const credits = [...new Set(placements.map(item => readAloudProvenanceLabel(item.result.provenance, this.profiles)))];
        this.body.replaceChildren(element('h2', t('annotationscommon.readAloudDialog.label.placed')), element('div', t('annotationscommon.readAloudDialog.hint.placedRowsExtendedStillOverflowing', { placed: placements.length, extended: extended, n: extended, overflow: overflow })),
            element('div', `provenance: ${credits.join(' / ')}`));
        this.foot.replaceChildren();
        const close = element('button', t('annotationscommon.readAloudDialog.action.close')); close.addEventListener('click', () => void this.accept()); this.foot.append(close);
    }
}
