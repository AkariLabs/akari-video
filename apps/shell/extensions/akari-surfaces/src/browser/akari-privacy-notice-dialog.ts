import { AbstractDialog } from '@theia/core/lib/browser/dialogs';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import URI from '@theia/core/lib/common/uri';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { AkariSettingsMaintenanceService } from '../common/settings-maintenance-protocol';
import { saveAutomaticCheck, showPrivacyNoticeOnce } from '../common/automatic-network-check';
import { switchControl } from './settings/settings-ui';

const MARKER = 'privacy-notice-v1.json';

/** Shown once before the existing guide, without altering any of its steps. */
export class AkariPrivacyNoticeDialog extends AbstractDialog<void> {
    get value(): void { return undefined; }
    protected readonly saveError = document.createElement('div');
    protected autoCheckSwitch!: HTMLButtonElement;
    protected autoCheck = true;
    protected switchTouched = false;
    protected saving = false;

    constructor(
        protected readonly files: FileService,
        protected readonly environment: EnvVariablesServer,
        protected readonly maintenance: AkariSettingsMaintenanceService,
        protected readonly preferences: PreferenceService,
        protected readonly windows: WindowService
    ) {
        super({ title: '通信について' });
        this.node.setAttribute('data-akari-privacy-notice', 'true');
        // settings-ui のスイッチ CSS はこの属性にスコープされている。
        this.node.setAttribute('data-akari-settings-dialog', 'true');
        const container = document.createElement('div');
        container.style.cssText = 'max-width:480px;display:grid;gap:12px;line-height:1.6;padding:8px 0';
        for (const message of [
            'AKARI Video は利用状況を送りません。',
            '新しい版と素材の一覧を自動で確認します。何も送らず、取得するだけです。',
            'AI 機能は使ったときだけ、あなたの API キーで各社に送ります。'
        ]) {
            const paragraph = document.createElement('p');
            paragraph.textContent = message;
            paragraph.style.margin = '0';
            container.append(paragraph);
        }
        const link = document.createElement('a');
        link.href = 'https://akari.video/privacy';
        link.textContent = 'プライバシーポリシー: https://akari.video/privacy';
        link.onclick = event => {
            event.preventDefault();
            this.windows.openNewWindow(link.href, { external: true });
        };
        container.append(link);
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px';
        this.autoCheckSwitch = switchControl({
            label: '更新と素材を自動で確認する', checked: true,
            onChange: checked => { this.switchTouched = true; this.autoCheck = checked; }
        });
        this.autoCheckSwitch.setAttribute('data-akari-auto-check', 'true');
        const text = document.createElement('span');
        text.textContent = '更新と素材を自動で確認する';
        row.append(this.autoCheckSwitch, text);
        container.append(row);
        this.saveError.setAttribute('role', 'alert');
        container.append(this.saveError);
        this.contentNode.append(container);
        this.appendAcceptButton('続ける');
        void this.maintenance.getUpdateSettings().then(settings => this.applyInitialAutoCheck(settings.autoCheck), () => undefined);
    }

    protected applyInitialAutoCheck(value: boolean): void {
        if (this.switchTouched) return;
        this.autoCheck = value;
        this.autoCheckSwitch.setAttribute('aria-checked', String(value));
    }

    protected override async accept(): Promise<void> {
        if (this.saving) return;
        this.saving = true;
        if (this.acceptButton) this.acceptButton.disabled = true;
        try {
            await saveAutomaticCheck(this.autoCheck, {
                writeSettings: value => this.maintenance.setUpdateSettings({ autoCheck: value }),
                writePreference: value => this.preferences.set('akari.update.autoCheck', value, PreferenceScope.User)
            });
            await this.recordSeen();
            await super.accept();
        } catch {
            this.saveError.textContent = '設定を保存できませんでした。もう一度お試しください。';
        } finally {
            this.saving = false;
            if (this.acceptButton) this.acceptButton.disabled = false;
        }
    }

    async openNotice(): Promise<void> {
        await showPrivacyNoticeOnce({
            markerExists: async () => this.files.exists(await this.markerUri()).catch(() => false),
            show: async () => { await this.open(); },
            // Esc and the title-bar close button count as dismissal too.
            markSeen: () => this.recordSeen()
        });
    }

    protected async markerUri(): Promise<URI> {
        const override = await this.environment.getValue('AKARI_HOME');
        if (override?.value) return URI.fromFilePath(override.value).resolve(MARKER);
        return new URI(await this.environment.getHomeDirUri()).resolve('.akari').resolve(MARKER);
    }

    protected async recordSeen(): Promise<void> {
        const uri = await this.markerUri();
        await this.files.createFolder(uri.parent).catch(() => undefined);
        await this.files.writeFile(uri, BinaryBuffer.fromString(`${JSON.stringify({ schema: 1, shownAt: new Date().toISOString() })}\n`));
    }
}
