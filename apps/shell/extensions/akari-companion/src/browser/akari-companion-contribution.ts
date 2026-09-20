import { ApplicationShell, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandRegistry, Disposable, MessageService } from '@theia/core/lib/common';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import {
    AkariAnnotationsService
} from 'akari-annotations/lib/common/akari-annotations-protocol';
import { AkariEditHistoryService } from 'akari-annotations/lib/browser/akari-edit-history-service';
import { ReviewModel } from 'akari-annotations/lib/browser/review-model';
import {
    AkariCompanionService,
    CompanionInstruction,
    CompanionManifestPanel,
    CompanionProjectLocation,
    CompanionResultMessage
} from '../common/akari-companion-protocol';
import { isAllowedCommandId, validateCommandArgs } from '../common/companion-allowlist';
import { isFlyToTargetKind } from '../common/companion-fly-to-targets';
import { AkariCompanionClientImpl } from './akari-companion-client';
import { AKARI_COMPANION_ENABLED } from './akari-companion-preferences';
import { applyCompanionAnnotation } from './companion-annotate';
import { applyCompanionEdit } from './companion-apply-edit';
import { resolveFlyTo } from './companion-fly-to';
import { CompanionPanelFrame } from './companion-panel-frame';
import { installCompanionPanelPulseStyle } from './companion-panel-pulse-style';
import { CompanionStateCollector } from './companion-state-collector';
import {
    COMPANION_TOGGLE_COMMAND_ID,
    COMPANION_TOGGLE_LABEL,
    CompanionToolbarContribution,
    toolbarAnchorRect
} from './companion-toolbar-contribution';

@injectable()
export class AkariCompanionContribution implements FrontendApplicationContribution {
    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;
    @inject(AkariCompanionService)
    protected readonly service!: AkariCompanionService;
    @inject(AkariCompanionClientImpl)
    protected readonly client!: AkariCompanionClientImpl;
    @inject(AkariAnnotationsService)
    protected readonly annotationsService!: AkariAnnotationsService;
    @inject(AkariEditHistoryService)
    protected readonly history!: AkariEditHistoryService;
    @inject(ReviewModel)
    protected readonly reviewModel!: ReviewModel;
    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;
    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;
    @inject(FileService)
    protected readonly files!: FileService;
    @inject(CommandRegistry)
    protected readonly commands!: CommandRegistry;
    @inject(MessageService)
    protected readonly messages!: MessageService;
    @inject(CompanionToolbarContribution)
    protected readonly toolbar!: CompanionToolbarContribution;

    protected projectSessionId: string | undefined;
    protected notifiedProjectKey = '';
    protected collector: CompanionStateCollector | undefined;
    protected panel: CompanionPanelFrame | undefined;
    protected connected = false;
    protected readonly disposables: Disposable[] = [];

    async onStart(): Promise<void> {
        installCompanionPanelPulseStyle(document);
        this.client.setHandler(instruction => this.dispatch(instruction));
        this.collector = new CompanionStateCollector({
            events: window,
            shell: this.shell,
            files: this.files,
            currentLocation: () => this.reviewModel.location,
            currentProjectSessionId: () => this.projectSessionId,
            onLocationChanged: listener => this.reviewModel.onChanged(listener),
            pushStateLight: state => this.service.pushStateLight(state),
            pushStateDocs: state => this.service.pushStateDocs(state)
        });
        this.collector.start();
        this.panel = new CompanionPanelFrame({ doc: document, win: window });
        this.panel.setAnchorProvider(() => toolbarAnchorRect(document));
        this.panel.setHiddenListener(() => this.toolbar.refresh(document));
        this.toolbar.setState({ connected: () => this.connected, open: () => this.isPanelOpen() });
        this.client.setPanelHandler((connected, manifest) => this.onConnectionState(connected, manifest));
        this.disposables.push(this.commands.registerCommand(
            { id: COMPANION_TOGGLE_COMMAND_ID, label: `${COMPANION_TOGGLE_LABEL}を表示/非表示` },
            { execute: () => { this.panel?.toggleHidden(); } }
        ));
        this.disposables.push(this.commands.registerCommand(
            { id: 'akari.companion.resetPanelPlacement', label: `${COMPANION_TOGGLE_LABEL}を既定の位置へ戻す` },
            { execute: () => { this.panel?.resetPlacement(); } }
        ));
        this.disposables.push(this.preferences.onPreferenceChanged(event => {
            if (event.preferenceName === AKARI_COMPANION_ENABLED) void this.applyEnabled();
        }));
        this.disposables.push(this.workspaceService.onWorkspaceChanged(() => {
            void this.regenerateProjectSession();
        }));
        this.disposables.push(this.reviewModel.onChanged(() => {
            void this.notifyCurrentProject();
        }));
        await this.regenerateProjectSession();
        await this.applyEnabled();
    }

    onStop(): void {
        this.toolbar.setState(undefined);
        this.collector?.stop();
        this.panel?.unmount();
        for (const disposable of this.disposables.splice(0)) disposable.dispose();
        this.client.setHandler(undefined);
        this.client.setPanelHandler(undefined);
        void this.service.setEnabled(false);
    }

    /**
     * つながった / 切れたときの入口。つながった直後は相手が本文を持っていないので、
     * ハッシュが変わっていなくても状態を送り直す（契約 §4 の「接続直後」）。
     */
    protected onConnectionState(connected: boolean, manifest?: CompanionManifestPanel): void {
        this.connected = connected && Boolean(manifest?.panelPath);
        this.applyPanelManifest(connected, manifest);
        this.toolbar.refresh(document);
        if (connected) void this.collector?.resendDocuments();
    }

    protected isPanelOpen(): boolean {
        return Boolean(this.panel?.isMounted()) && !this.panel?.isHidden();
    }

    protected applyPanelManifest(connected: boolean, manifest?: CompanionManifestPanel): void {
        if (!connected || !manifest?.panelPath) {
            this.panel?.unmount();
            return;
        }
        this.panel?.mount(manifest.panelPath, manifest.port, manifest.panel);
    }

    protected async applyEnabled(): Promise<void> {
        // Theia 1.73.1 の schema 型には利用者限定の文字列 scope が無いので、
        // 実効値ではなく利用者設定だけを直接読むことでワークスペース設定を無視する。
        const enabled = this.preferences.inspect<boolean>(AKARI_COMPANION_ENABLED)?.globalValue ?? false;
        await this.service.setEnabled(enabled);
    }

    protected async regenerateProjectSession(): Promise<void> {
        const roots = await this.workspaceService.roots;
        this.projectSessionId = roots.length > 0 ? window.crypto.randomUUID() : undefined;
        await this.notifyCurrentProject();
        this.collector?.projectChanged();
    }

    protected async notifyCurrentProject(): Promise<void> {
        const location = this.currentProjectLocation();
        const key = location
            ? `${location.projectSessionId}\n${location.rootFsPath}\n${location.editFsPath}\n${location.captionsFsPath}`
            : '';
        if (key !== this.notifiedProjectKey) {
            this.notifiedProjectKey = key;
            await this.service.notifyProjectChanged(location);
        }
        this.collector?.projectChanged();
    }

    protected currentProjectLocation(): CompanionProjectLocation | undefined {
        const location = this.reviewModel.location;
        if (!location || !this.projectSessionId) return undefined;
        return {
            projectSessionId: this.projectSessionId,
            rootFsPath: location.root.path.fsPath(),
            editFsPath: (location.editUri ?? location.root.resolve('project').resolve('edit.json')).path.fsPath(),
            captionsFsPath: location.captionsUri.path.fsPath()
        };
    }

    protected currentEditUri(): string | undefined {
        return this.reviewModel.location?.editUri?.toString();
    }

    protected async dispatch(instruction: CompanionInstruction): Promise<CompanionResultMessage> {
        try {
            if (instruction.kind === 'flyTo') {
                if (!instruction.flyTo
                    || !isFlyToTargetKind(instruction.flyTo.target?.kind)
                    || typeof instruction.flyTo.target.id !== 'string') {
                    return { id: instruction.id, ok: false, error: 'invalid-args' };
                }
                if (!this.panel?.isMounted()) {
                    return { id: instruction.id, ok: false, error: 'not-supported' };
                }
                const ok = await resolveFlyTo(this.panel, instruction.flyTo.target, {
                    doc: document, win: window, shell: this.shell
                });
                return { id: instruction.id, ok, error: ok ? undefined : 'not-found' };
            }
            if (instruction.kind === 'panel') {
                if (!instruction.panel) return { id: instruction.id, ok: false, error: 'invalid-args' };
                if (!this.panel?.isMounted()) {
                    return { id: instruction.id, ok: false, error: 'not-supported' };
                }
                this.panel.applyInstruction(instruction.panel);
                return { id: instruction.id, ok: true };
            }
            if (instruction.kind === 'getState') {
                return { id: instruction.id, ok: true, value: this.collector?.snapshot() };
            }
            if (instruction.kind === 'command') return this.dispatchCommand(instruction);
            if (instruction.kind === 'applyEdit') {
                if (!instruction.applyEdit) return { id: instruction.id, ok: false, error: 'invalid-args' };
                const result = await applyCompanionEdit(instruction.applyEdit, {
                    currentProjectSessionId: () => this.projectSessionId,
                    currentLocation: () => {
                        const location = this.reviewModel.location;
                        return location?.editUri
                            ? { editUri: location.editUri, captionsUri: location.captionsUri, root: location.root }
                            : undefined;
                    },
                    readFileBytes: uri => this.readFileBytes(uri),
                    sha256Hex: bytes => this.sha256Hex(bytes),
                    writeEditSnapshot: request => this.annotationsService.writeEditSnapshot(request),
                    pushHistory: entry => { this.history.push(entry); },
                    notify: message => { void this.messages.warn(message); }
                });
                return { id: instruction.id, ...result };
            }
            if (instruction.kind === 'annotate') {
                if (!instruction.annotate) return { id: instruction.id, ok: false, error: 'invalid-args' };
                const result = await applyCompanionAnnotation(instruction.annotate, {
                    currentProjectSessionId: () => this.projectSessionId,
                    currentLocation: () => {
                        const location = this.reviewModel.location;
                        return location ? { reviewUri: location.reviewUri, root: location.root } : undefined;
                    },
                    createAnnotation: request => this.annotationsService.createAnnotation(request)
                });
                return { id: instruction.id, ...result };
            }
            return { id: instruction.id, ok: false, error: 'not-supported' };
        } catch (error) {
            return {
                id: instruction.id, ok: false, error: 'rejected',
                value: { reasons: [String((error as Error)?.message ?? error)] }
            };
        }
    }

    protected async dispatchCommand(instruction: CompanionInstruction): Promise<CompanionResultMessage> {
        const command = instruction.command;
        if (!isAllowedCommandId(command?.commandId)) {
            return { id: instruction.id, ok: false, error: 'not-allowed' };
        }
        const validated = validateCommandArgs(command.commandId, command.args);
        if (!validated.ok) return { id: instruction.id, ok: false, error: 'invalid-args' };
        let args = validated.args ? { ...validated.args } : undefined;
        if (command.commandId.startsWith('akari.preview.')) {
            const editUri = this.currentEditUri();
            if (!editUri) return { id: instruction.id, ok: false, error: 'not-found' };
            args = { ...(args ?? {}), editUri };
        }
        const returned = args
            ? await this.commands.executeCommand(command.commandId, args)
            : await this.commands.executeCommand(command.commandId);
        const result: CompanionResultMessage = { id: instruction.id, ok: true };
        try {
            const encoded = JSON.stringify(returned);
            if (encoded !== undefined) result.value = JSON.parse(encoded);
        } catch {
            // JSON へ安全に写せない戻り値は省く。
        }
        return result;
    }

    protected async readFileBytes(uri: URI): Promise<Uint8Array> {
        try {
            if (!await this.files.exists(uri)) return new Uint8Array();
            const file = await this.files.readFile(uri);
            return new Uint8Array(file.value.buffer);
        } catch {
            return new Uint8Array();
        }
    }

    protected async sha256Hex(bytes: Uint8Array): Promise<string> {
        const hash = await window.crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
        return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    }
}
