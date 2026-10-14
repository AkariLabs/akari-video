import { pluralCountForDisplay } from '../../common/plural-display-count';
import { t } from '@akari-video/i18n';
import { AkariAnnotationsService, type NarrationCandidate, type NarrationEngine, type NarrationVoice,
    type VoiceProfileSummary } from '../../common/akari-annotations-protocol';
import { channelPeopleLocation, eligibleNarrationPeople, narrationPersonRoute, parseChannelPeople, selectNarrationPerson,
    type ChannelPerson } from '../../common/channel-people-reader';
import { irodoriCustomVoiceMissing, narrationEstimate, readAloudPreviewPlan, selectReadAloudEngine, selectReadAloudVoice } from '../../common/read-aloud-model';
import { stillMakerBadge } from './maker-badge';
import { aiNarrationNeedsChoice, placeAiNarration, planAiNarrationPlacement,
    type NarrationEdit, type NarrationTrack } from '../../common/ai-narration-placement';

export interface AiNarrationState {
    script: string; reading: string; style?: string; engineId: string; voiceId: string;
    voices: NarrationVoice[]; running: boolean; cancelled?: boolean; startedAt?: number; error?: string; placement?: string;
    placementChoice?: 'lower' | 'shift';
    selectedEngineIds?: string[]; voicesByEngine?: Record<string, NarrationVoice[]>; voiceByEngine?: Record<string, string>;
    preferredEngineId?: string; favorites?: string[]; candidates?: NarrationCandidate[]; completed?: number;
    playingPath?: string; lastRoutes?: string[];
    runningRoutes?: string[];
    personId?: string; personProfileId?: string; people?: ChannelPerson[];
    personProfiles?: VoiceProfileSummary[]; personLoading?: boolean;
}
export interface AiNarrationActions {
    change(): void; chooseEngine(engineId: string): void; chooseVoice?(engineId: string, voiceId: string): void;
    generate(): void; cancel(): void; play?(candidate: NarrationCandidate): void; adopt?(candidate: NarrationCandidate): void;
    retry?(candidate: NarrationCandidate): void;
}

export function selectedNarrationEngines(engines: readonly NarrationEngine[], preferred?: string): string[] {
    return [selectReadAloudEngine(engines, preferred)?.id].filter((id): id is string => !!id);
}

export function orderedNarrationEngines(engines: readonly NarrationEngine[], favorites: readonly string[] = []): NarrationEngine[] {
    return [...engines].sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
}

export function narrationBatchConfirm(engines: readonly NarrationEngine[], reading: string):
    { title: string; msg: string; ok: string; cancel: string } | undefined {
    const paid = engines.filter(engine => engine.place === 'cloud');
    if (!paid.length) return undefined;
    const estimates = paid.map(engine => ({ engine, quote: narrationEstimate(engine, reading) }));
    const total = estimates.some(row => row.quote.usd === null) ? t('inspector.aiNarrationPanel.status.estimateUnavailable') :
        `$${estimates.reduce((sum, row) => sum + (row.quote.usd ?? 0), 0).toFixed(3)}`;
    return { title: t('inspector.aiNarrationPanel.title.costApproval'), msg: t('inspector.aiNarrationPanel.message.totalCanUseCharactersReadWillAccept', { breakdown: estimates.map(row => `${row.engine.label}: ${row.quote.usd === null ? t('inspector.aiNarrationPanel.status.estimateUnavailable') : `$${row.quote.usd.toFixed(3)}`}`).join(' / '), amount: total, characters: reading.length, n: reading.length }), ok: t('inspector.aiNarrationPanel.label.costApproval'), cancel: t('inspector.aiNarrationPanel.action.cancel') };
}

export function narrationRowEstimate(engine: NarrationEngine, reading: string): string {
    if (engine.place !== 'cloud') return t('inspector.aiNarrationPanel.estimate.free');
    const quote = narrationEstimate(engine, reading);
    return quote.usd === null ? t('inspector.aiNarrationPanel.status.estimateUnavailable') : t('inspector.aiNarrationPanel.estimate.amount', { amount: quote.usd.toFixed(3) });
}

export function narrationCandidateLabel(candidate: NarrationCandidate, engines: readonly NarrationEngine[],
    voicesByEngine: Record<string, NarrationVoice[]> = {}): string {
    const engineName = engines.find(engine => engine.id === candidate.route)?.label ?? candidate.route;
    const knownVoice = voicesByEngine[candidate.route]?.find(voice => voice.id === candidate.voice)?.label;
    if (!candidate.ok) return [engineName, knownVoice].filter(Boolean).join(' · ');
    const parts = [engineName, knownVoice ?? candidate.voice].filter(Boolean);
    if (typeof candidate.durationSeconds === 'number' && Number.isFinite(candidate.durationSeconds)) {
        parts.push(t('inspector.aiNarrationPanel.label.scaleSeconds', { seconds: candidate.durationSeconds.toFixed(1), n: pluralCountForDisplay(candidate.durationSeconds.toFixed(1)) }));
    }
    if (typeof candidate.elapsedSeconds === 'number' && Number.isFinite(candidate.elapsedSeconds)) {
        parts.push(t('inspector.aiNarrationPanel.label.createSeconds', { seconds: Math.round(candidate.elapsedSeconds), n: Math.round(candidate.elapsedSeconds) }));
    }
    if (typeof candidate.costUsd === 'number' && Number.isFinite(candidate.costUsd)) {
        parts.push(`$${candidate.costUsd.toFixed(3)}`);
    }
    return parts.join(' · ');
}

function narrationMakerId(engineId: string): string {
    return engineId === 'voicevox' ? 'voicevox' : engineId === 'irodori' ? 'irodori'
        : engineId === 'fal-qwen3' ? 'qwen' : 'google';
}

export function aiNarrationChoiceVisible(state: Pick<AiNarrationState, 'script' | 'reading'>,
    placement?: { tracks: readonly NarrationTrack[]; itemId: string; fps: number }): boolean {
    if (!placement || !state.script.trim()) return false;
    const reading = state.reading.trim() || state.script;
    const estimatedSeconds = Math.max(0.1, Array.from(reading.trim()).length / 5);
    return aiNarrationNeedsChoice(placement.tracks, placement.itemId, estimatedSeconds, placement.fps);
}

export function appendAiNarrationPanel(parent: HTMLElement, state: AiNarrationState,
    engines: readonly NarrationEngine[], actions: AiNarrationActions,
    placement?: { tracks: readonly NarrationTrack[]; itemId: string; fps: number }): void {
    const make = <K extends keyof HTMLElementTagNameMap>(tag: K, name: string, content?: string): HTMLElementTagNameMap[K] => {
        const node = document.createElement(tag); node.className = `akari-inspector-ai-narration-${name}`;
        if (content !== undefined) node.textContent = content;
        return node;
    };
    const panel = make('section', 'panel');
    const scriptLabel = make('label', 'label', t('inspector.aiNarrationPanel.label.script'));
    const script = make('textarea', 'textarea'); script.setAttribute('aria-label', t('inspector.aiNarrationPanel.label.script')); script.value = state.script;
    script.addEventListener('input', () => { state.script = script.value; actions.change(); updateEstimate(); updateChoice(); });
    scriptLabel.append(script);
    const readingLabel = make('label', 'label', t('inspector.aiNarrationPanel.action.readOptional'));
    const reading = make('textarea', 'textarea'); reading.setAttribute('aria-label', t('inspector.aiNarrationPanel.label.reading')); reading.value = state.reading;
    reading.addEventListener('input', () => { state.reading = reading.value; actions.change(); updateEstimate(); updateChoice(); });
    readingLabel.append(reading);
    panel.append(scriptLabel, readingLabel, make('h4', 'heading', t('inspector.aiNarrationPanel.label.engine')));
    const cards = make('div', 'engines');
    const rowEstimates: Array<{ engine: NarrationEngine; node: HTMLElement }> = [];
    const shown = orderedNarrationEngines(engines.filter(row => ['voicevox', 'gemini-tts', 'irodori'].includes(row.id)
        || row.id === 'fal-qwen3' && row.availability.state === 'available'), state.favorites);
    for (const place of ['free', 'paid'] as const) {
        const group = shown.filter(row => (row.place === 'cloud' ? 'paid' : 'free') === place);
        if (!group.length) continue;
        cards.append(make('h5', 'group', place === 'free' ? t('inspector.aiNarrationPanel.label.noExtraCharge') : t('inspector.aiNarrationPanel.label.onlyAmountUsed')));
        for (const engine of group) {
        const card = make('div', 'engine');
        card.setAttribute('data-akari-narration-engine', engine.id);
        const radio = make('input', 'engine-checkbox'); radio.type = 'checkbox';
        radio.value = engine.id; radio.checked = (state.selectedEngineIds ?? [state.engineId]).includes(engine.id);
        radio.disabled = state.running || engine.availability.state !== 'available' && !(engine.id === 'voicevox' && engine.availability.state === 'needs');
        radio.addEventListener('change', () => {
            state.personId = undefined; state.personProfileId = undefined;
            actions.chooseEngine(engine.id);
        });
        const text = make('span', 'engine-text');
        text.append(stillMakerBadge(narrationMakerId(engine.id)),
            make('strong', 'engine-name', `${state.favorites?.includes(engine.id) ? '★ ' : ''}${engine.id === 'fal-qwen3' ? t('inspector.aiNarrationPanel.label.myVoice') : engine.label}`),
            make('span', 'engine-cost', engine.place === 'local' ? t('inspector.aiNarrationPanel.label.free')
                : engine.place === 'network' ? t('inspector.aiNarrationPanel.label.anotherPc', { url: engine.availability.detail?.url ?? t('inspector.aiNarrationPanel.action.checkConnectionDestination') })
                    : t('inspector.aiNarrationPanel.label.pricePerThousandCharacters', { price: engine.price?.usd_per_1000_chars ?? 0, provisionalNote: engine.price?.verified === false ? t('inspector.aiNarrationPanel.hint.tentative') : '' })),
            make('span', 'engine-availability', engine.availability.label));
        const rowEstimate = make('span', 'engine-estimate', narrationRowEstimate(engine, state.reading.trim() || state.script));
        rowEstimates.push({ engine, node: rowEstimate });
        text.append(rowEstimate);
        card.append(radio, text);
        const voiceLabel = make('label', 'label', t('inspector.aiNarrationPanel.label.voiceVoice'));
        const voice = make('select', 'voice'); voice.setAttribute('aria-label', t('inspector.aiNarrationPanel.label.voiceWithValue', { engineName: engine.label }));
        for (const option of state.voicesByEngine?.[engine.id] ?? (engine.id === state.engineId ? state.voices : [])) {
            const row = document.createElement('option'); row.value = option.id; row.textContent = option.label; voice.append(row);
        }
        voice.value = state.voiceByEngine?.[engine.id] ?? (engine.id === state.engineId ? state.voiceId : '');
        voice.disabled = state.running || !radio.checked;
        voice.addEventListener('change', () => {
            state.personId = undefined; state.personProfileId = undefined;
            actions.chooseVoice?.(engine.id, voice.value);
        });
        voiceLabel.append(voice); card.append(voiceLabel); cards.append(card);
        }
    }
    panel.append(cards);
    const showPeople = (): void => {
        const people = state.people ?? [];
        if (!people.length || panel.querySelector('[data-akari-narration-person]')) return;
        const personLabel = make('label', 'label', t('inspector.aiNarrationPanel.label.person'));
        personLabel.dataset.akariNarrationPerson = 'true';
        const select = make('select', 'person'); select.setAttribute('aria-label', t('inspector.aiNarrationPanel.label.person'));
        const empty = document.createElement('option'); empty.value = ''; empty.textContent = t('inspector.aiNarrationPanel.text.selectPerson'); select.append(empty);
        for (const person of people) {
            const option = document.createElement('option'); option.value = person.id; option.textContent = person.name;
            option.disabled = !selectNarrationPerson(person, state.personProfiles ?? [], 'fal-qwen3',
                engines.filter(engine => engine.availability.state === 'available').map(engine => engine.id));
            select.append(option);
        }
        select.value = state.personId ?? '';
        select.addEventListener('change', () => {
            const person = people.find(item => item.id === select.value);
            const choice = person && selectNarrationPerson(person, state.personProfiles ?? [], 'fal-qwen3',
                engines.filter(engine => engine.availability.state === 'available').map(engine => engine.id));
            if (!choice) return;
            const engineId = choice.engineId;
            state.personId = person.id; state.personProfileId = choice.profile.id;
            state.selectedEngineIds = [engineId]; state.engineId = engineId; state.voiceId = choice.profile.id;
            state.voiceByEngine ??= {}; state.voiceByEngine[engineId] = choice.profile.id;
            state.voicesByEngine ??= {};
            if (!state.voicesByEngine[engineId]?.some(voice => voice.id === choice.profile.id)) {
                state.voicesByEngine[engineId] = [...state.voicesByEngine[engineId] ?? [],
                    { id: choice.profile.id, label: choice.profile.label }];
            }
            actions.chooseVoice?.(engineId, choice.profile.id);
            actions.change();
        });
        personLabel.append(select); panel.insertBefore(personLabel, cards);
    };
    showPeople();
    if (!state.personLoading && !state.personProfiles) {
        const container = (window as Window & { theia?: { container?: { get(key: unknown): unknown } } }).theia?.container;
        if (container) {
            state.personLoading = true;
            void Promise.all([
                import('@theia/core/lib/common/uri'),
                import('@theia/filesystem/lib/browser/file-service'),
                import('@theia/workspace/lib/browser/workspace-service')
            ]).then(async ([{ default: URI }, { FileService }, { WorkspaceService }]) => {
                const project = (container.get(WorkspaceService) as InstanceType<typeof WorkspaceService>)
                    .tryGetRoots()[0]?.resource;
                const location = project && channelPeopleLocation(project.toString());
                if (!location) { state.personProfiles = []; state.people = []; return; }
                const files = container.get(FileService) as InstanceType<typeof FileService>;
                const service = container.get(AkariAnnotationsService) as AkariAnnotationsService;
                const [file, result] = await Promise.all([
                    files.readFile(new URI(location.peopleUri)), service.voiceProfiles()
                ]);
                state.personProfiles = result.profiles;
                state.people = eligibleNarrationPeople(parseChannelPeople(file.value.toString()), result.profiles);
                if (panel.isConnected) showPeople();
            }).catch(() => { state.personProfiles = []; state.people = []; })
                .finally(() => { state.personLoading = false; });
        }
    }
    const selected = state.selectedEngineIds ?? [state.engineId];
    if (selected.includes('gemini-tts') || selected.includes('irodori') && state.voiceByEngine?.irodori === 'custom') {
        const required = selected.includes('irodori') && state.voiceByEngine?.irodori === 'custom';
        const styleLabel = make('label', 'label', required ? t('inspector.aiNarrationPanel.label.voiceInstructionRequired') : t('inspector.aiNarrationPanel.label.talkingInstructionOptional'));
        const style = make('textarea', 'textarea'); style.value = state.style ?? '';
        style.setAttribute('aria-label', required ? t('inspector.aiNarrationPanel.label.voiceInstructionRequired') : t('inspector.aiNarrationPanel.label.talkingInstructionOptional'));
        style.addEventListener('input', () => { state.style = style.value; actions.change(); });
        styleLabel.append(style); panel.append(styleLabel, make('p', 'note', t('inspector.aiNarrationPanel.message.instructionsSpeakerOnlyEffectiveCorrespondingEngine')));
    }
    let estimateNode: HTMLParagraphElement | undefined;
    const updateEstimate = (): void => {
        const currentReading = state.reading.trim() || state.script;
        for (const row of rowEstimates) row.node.textContent = narrationRowEstimate(row.engine, currentReading);
        if (!estimateNode) return;
        const estimates = engines.filter(row => selected.includes(row.id)).map(row => narrationEstimate(row, currentReading));
        const total = estimates.reduce((sum, row) => sum + (row.usd ?? 0), 0);
        estimateNode.textContent = estimates.some(row => row.usd === null)
            ? t('inspector.aiNarrationPanel.estimate.unavailableApprovalOnce') : t('inspector.aiNarrationPanel.estimate.totalApproval1Time', { amount: total.toFixed(3) });
    };
    if (selected.length) {
        estimateNode = make('p', 'estimate'); updateEstimate();
        panel.append(estimateNode);
    }
    const choice = make('fieldset', 'placement-choice');
    choice.append(make('legend', 'placement-heading', t('inspector.aiNarrationPanel.label.whenVoiceLongerThanFrame')));
    for (const [value, label] of [
        ['lower', t('inspector.aiNarrationPanel.action.applyAudioTrackBelowDefault')],
        ['shift', t('inspector.aiNarrationPanel.label.shiftFollowingClips')]
    ] as const) {
        const option = make('label', 'placement-option');
        const input = make('input', 'placement-radio'); input.type = 'radio';
        input.name = 'akari-inspector-ai-narration-placement-choice'; input.value = value;
        input.checked = (state.placementChoice ?? 'lower') === value;
        input.disabled = state.running;
        input.addEventListener('change', () => { state.placementChoice = value; actions.change(); });
        option.append(input, document.createTextNode(label)); choice.append(option);
    }
    const updateChoice = (): void => {
        choice.hidden = !aiNarrationChoiceVisible(state, placement);
        if (choice.hidden) {
            state.placementChoice = 'lower';
            const lower = choice.querySelector<HTMLInputElement>('input[value="lower"]');
            if (lower) lower.checked = true;
        }
    };
    updateChoice(); panel.append(choice);
    const button = make('button', 'button', state.running ? t('inspector.aiNarrationPanel.status.generating') : state.error ? t('inspector.aiNarrationPanel.label.againSameInput') : t('inspector.aiNarrationPanel.label.makeProposal', { count: selected.length, n: selected.length }));
    button.type = 'button'; button.disabled = state.running || !state.script.trim() || !selected.length
        || selected.some(id => !state.voiceByEngine?.[id])
        || irodoriCustomVoiceMissing(selected.includes('irodori') ? 'irodori' : undefined, state.voiceByEngine?.irodori ?? '', state.style ?? '');
    const generateWithPerson = async (): Promise<void> => {
        const engineId = state.selectedEngineIds?.[0];
        const profileId = state.personProfileId;
        if (!profileId || engineId === 'fal-qwen3' || state.voiceByEngine?.[engineId ?? ''] !== profileId) {
            actions.generate(); return;
        }
        const container = (window as Window & { theia?: { container?: { get(key: unknown): unknown } } }).theia?.container;
        if (!container || !placement || !engineId) {
            state.error = t('inspector.aiNarrationPanel.message.notReadyUseVoicePerson'); actions.change(); return;
        }
        const engine = engines.find(item => item.id === engineId);
        const item = placement.tracks.flatMap(track => track.items).find(row => row.id === placement.itemId);
        if (!engine || !item) { state.error = t('inspector.aiNarrationPanel.error.cannotCheckPositionReading'); actions.change(); return; }
        const readingText = state.reading.trim() || state.script;
        const confirmation = narrationBatchConfirm([engine], readingText);
        if (confirmation) {
            const { ConfirmDialog } = await import('@theia/core/lib/browser/dialogs');
            if (!(await new ConfirmDialog(confirmation).open())) return;
        }
        const [{ WorkspaceService }, { currentTimelineEditUri }] = await Promise.all([
            import('@theia/workspace/lib/browser/workspace-service'), import('../active-timeline')
        ]);
        const root = (container.get(WorkspaceService) as InstanceType<typeof WorkspaceService>)
            .tryGetRoots()[0]?.resource;
        if (!root) { state.error = t('inspector.aiNarrationPanel.action.openProject'); actions.change(); return; }
        const service = container.get(AkariAnnotationsService) as AkariAnnotationsService;
        state.error = undefined; state.cancelled = false; state.running = true;
        state.completed = 0; state.startedAt = Date.now(); state.runningRoutes = [engineId];
        actions.chooseVoice?.(engineId, profileId);
        try {
            const batch = await service.startNarrationBatch({ projectRootUri: root.toString(),
                ...{ editUri: currentTimelineEditUri(root).toString() }, itemId: placement.itemId,
                script: state.script, reading: readingText, t: item.at / placement.fps,
                approved: !!confirmation,
                routes: [{ ...narrationPersonRoute(profileId, engineId),
                    style: engineId === 'irodori' ? undefined : state.style }] });
            if (state.cancelled) return;
            state.candidates = batch.candidates; state.completed = batch.completed;
            const candidate = batch.candidates.find(row => row.ok && row.relativePath);
            if (candidate) actions.adopt?.(candidate);
        } catch (error) { if (!state.cancelled) state.error = String(error); }
        finally {
            state.running = false; state.runningRoutes = undefined;
            actions.chooseVoice?.(engineId, profileId);
        }
    };
    button.addEventListener('click', () => void generateWithPerson()); panel.append(button);
    if (state.running) {
        const activeRoutes = state.runningRoutes ?? selected;
        panel.append(make('p', 'progress', t('inspector.aiNarrationPanel.label.creatingOptions', { count: activeRoutes.length, n: activeRoutes.length, completed: state.completed ?? 0, total: activeRoutes.length })));
        for (const id of activeRoutes) {
            const candidate = state.candidates?.find(row => row.route === id);
            if (!candidate) panel.append(make('p', 'route-progress', t('inspector.aiNarrationPanel.label.seconds', { engine: engines.find(row => row.id === id)?.label ?? id, elapsedSeconds: Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000), n: Math.floor((Date.now() - (state.startedAt ?? Date.now())) / 1000) })));
        }
        const cancel = make('button', 'button', t('inspector.aiNarrationPanel.action.cancel')); cancel.type = 'button';
        cancel.addEventListener('click', () => actions.cancel()); panel.append(cancel);
    }
    if (state.candidates?.length) {
        panel.append(make('h4', 'heading', t('inspector.aiNarrationPanel.label.candidateCount', { count: state.candidates.filter(row => row.ok).length, n: state.candidates.filter(row => row.ok).length })));
        for (const candidate of state.candidates) {
            const row = make('div', 'candidate'); row.setAttribute('data-akari-narration-candidate', candidate.route);
            const controls = make('span', 'candidate-controls');
            controls.append(stillMakerBadge(narrationMakerId(candidate.route), true));
            if (candidate.ok && candidate.relativePath) {
                const play = make('button', 'play', state.playingPath === candidate.relativePath ? '■' : '▶');
                play.type = 'button'; play.addEventListener('click', () => actions.play?.(candidate));
                controls.append(play);
            }
            const label = make('span', 'candidate-label', narrationCandidateLabel(candidate, engines,
                state.voicesByEngine));
            row.append(controls, label);
            if (candidate.ok) {
                const adopt = make('button', 'adopt', t('inspector.aiNarrationPanel.action.usePlan')); adopt.type = 'button';
                adopt.addEventListener('click', () => actions.adopt?.(candidate)); row.append(adopt);
            } else {
                label.append(make('span', 'error', t('inspector.aiNarrationPanel.error.failed', { reason: candidate.reason ?? t('inspector.aiNarrationPanel.error.generationFailed') })));
                const retry = make('button', 'retry', t('inspector.aiNarrationPanel.label.againSameInput')); retry.type = 'button';
                retry.addEventListener('click', () => actions.retry?.(candidate)); row.append(retry);
            }
            panel.append(row);
        }
        panel.append(make('p', 'note', t('inspector.aiNarrationPanel.message.otherCandidatesRemainAssets')));
    }
    if (state.error) panel.append(make('p', 'error', state.error));
    if (state.placement) panel.append(make('p', 'placement', state.placement));
    parent.append(panel);
}

export async function generateAiNarration(options: {
    state: AiNarrationState; engine: NarrationEngine; projectRootUri: string; itemId: string; atSeconds: number;
    service: Pick<AkariAnnotationsService, 'generateNarration'>;
    irodoriUrl?: string;
    confirm: (message: NonNullable<ReturnType<typeof readAloudPreviewPlan>['confirm']>) => Promise<boolean>;
    commit: (label: string, mutate: (doc: NarrationEdit) => NarrationEdit) => Promise<unknown>;
    fps: number;
}): Promise<string | undefined> {
    const { state, engine } = options;
    const script = state.script; const reading = state.reading.trim() || script;
    const placementChoice = state.placementChoice ?? 'lower';
    if (!script.trim() || !state.voiceId || irodoriCustomVoiceMissing(engine.id, state.voiceId, state.style ?? '')) return undefined;
    const plan = readAloudPreviewPlan(engine, reading);
    if (plan.needsApproval && !(await options.confirm(plan.confirm!))) return undefined;
    if (state.cancelled) return undefined;
    const result = await options.service.generateNarration({ projectRootUri: options.projectRootUri,
        engine: engine.id, voice: state.voiceId, script, reading, captionId: null,
        t: options.atSeconds, approved: plan.needsApproval,
        profile: state.personProfileId && state.personProfileId === state.voiceId
            ? state.personProfileId : engine.id === 'fal-qwen3' ? state.voiceId : undefined,
        style: engine.id === 'gemini-tts' || engine.id === 'irodori' && state.voiceId === 'custom' ? state.style : undefined,
        irodoriUrl: engine.id === 'irodori' ? options.irodoriUrl : undefined });
    if (state.cancelled) return undefined;
    if (result.status !== 'ok' || !result.path || !result.duration_s) throw new Error(t('inspector.aiNarrationPanel.error.generateAudio'));
    let label = '';
    await options.commit(t('inspector.aiNarrationPanel.label.puttingNarration'), doc => {
        // Recalculate inside the history mutation so intervening timeline edits cannot be overwritten.
        const placement = planAiNarrationPlacement(doc.tracks, options.itemId, result.duration_s!, options.fps,
            placementChoice);
        label = placement.label;
        return placeAiNarration(doc, options.itemId, result.path!, result.duration_s!, options.fps,
            placementChoice);
    });
    return label;
}

export function initialAiNarrationState(engines: readonly NarrationEngine[], preferred?: string): AiNarrationState {
    const selected = selectedNarrationEngines(engines, preferred);
    return { script: '', reading: '', style: '', engineId: selected[0] ?? '', voiceId: '',
        voices: [], selectedEngineIds: selected, voicesByEngine: {}, voiceByEngine: {},
        running: false, placementChoice: 'lower' };
}
export function chooseAiNarrationVoice(state: AiNarrationState, voices: readonly NarrationVoice[], engineId = state.engineId): void {
    state.voicesByEngine ??= {}; state.voiceByEngine ??= {};
    state.voicesByEngine[engineId] = [...voices];
    state.voiceByEngine[engineId] = selectReadAloudVoice(voices, state.voiceByEngine[engineId])?.id ?? '';
    if (engineId === state.engineId) { state.voices = [...voices]; state.voiceId = state.voiceByEngine[engineId]; }
}
