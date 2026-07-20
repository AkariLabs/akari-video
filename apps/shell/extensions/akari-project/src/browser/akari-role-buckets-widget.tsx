import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { OpenerService, open } from '@theia/core/lib/browser';
import { LabelProvider } from '@theia/core/lib/browser/label-provider';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { AkariRoleDeclaration, AkariWorkflowService } from './akari-workflow-service';
import { shouldShowProjectPath } from '../common/project-tree-policy';

interface BucketEntry {
    uri: URI;
    name: string;
    isDirectory: boolean;
    icon: string;
}

/**
 * 非開発者モード向けの「素材」差し替えビュー。
 *
 * 標準 Explorer ツリーの代わりに、workflow.json の roles（素材 / 企画 / 書き出し）を
 * 大ボタンとして見せ、選んだロール配下のフラット一覧だけを表示する。階層は
 * ロール直下のサブフォルダを 1 段だけ展開できる以外は見せない。
 *
 * activity bar 上での explorer-view-container との切り替え（表示するのはどちらか
 * 一方のみ）は akari-shell-strip の AkariActivityBarCuration が担当する
 * （developer mode の持ち主が akari-project、activity bar の持ち主が
 * akari-shell-strip という既存の役割分担に合わせた配置）。
 */
@injectable()
export class AkariRoleBucketsWidget extends ReactWidget {
    static readonly ID = 'akari-role-buckets-widget';

    @inject(AkariWorkflowService)
    protected readonly workflow!: AkariWorkflowService;
    @inject(FileService)
    protected readonly files!: FileService;
    @inject(OpenerService)
    protected readonly openers!: OpenerService;
    @inject(LabelProvider)
    protected readonly labels!: LabelProvider;

    protected activeRole?: AkariRoleDeclaration;
    protected entries: BucketEntry[] = [];
    protected expandedChildren = new Map<string, BucketEntry[]>();
    protected loading = false;
    protected notice?: string;

    @postConstruct()
    protected init(): void {
        this.id = AkariRoleBucketsWidget.ID;
        this.title.label = '素材';
        this.title.caption = 'ロール別ファイル表示';
        this.title.iconClass = 'codicon codicon-files';
        this.title.closable = false;
        this.toDispose.push(this.workflow.onDidChange(() => this.refresh()));
        this.update();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.refresh();
    }

    protected refresh(): void {
        if (this.activeRole) {
            void this.loadRole(this.activeRole);
        } else {
            this.update();
        }
    }

    protected async openRole(role: AkariRoleDeclaration): Promise<void> {
        this.activeRole = role;
        this.expandedChildren.clear();
        await this.loadRole(role);
    }

    protected backToRoles(): void {
        this.activeRole = undefined;
        this.entries = [];
        this.expandedChildren.clear();
        this.update();
    }

    protected async loadRole(role: AkariRoleDeclaration): Promise<void> {
        const root = this.workflow.workspaceRoot;
        if (!root) {
            this.entries = [];
            this.notice = 'プロジェクトを開いてください。';
            this.update();
            return;
        }
        this.loading = true;
        this.notice = undefined;
        this.update();
        this.entries = await this.listDirectory(root.resolve(role.path));
        this.loading = false;
        this.update();
    }

    protected async listDirectory(uri: URI): Promise<BucketEntry[]> {
        let stat: FileStat;
        try {
            stat = await this.files.resolve(uri);
        } catch {
            return [];
        }
        const result: BucketEntry[] = [];
        for (const child of stat.children ?? []) {
            const relative = this.workflow.relativePath(child.resource);
            if (!shouldShowProjectPath(relative, this.workflow.current.tree, false)) {
                continue;
            }
            result.push({
                uri: child.resource,
                name: child.resource.path.base,
                isDirectory: child.isDirectory,
                icon: child.isDirectory ? this.labels.folderIcon : this.labels.getIcon(child.resource)
            });
        }
        result.sort((left, right) => {
            if (left.isDirectory !== right.isDirectory) {
                return left.isDirectory ? -1 : 1;
            }
            return left.name.localeCompare(right.name, 'ja');
        });
        return result;
    }

    protected async toggleSubfolder(entry: BucketEntry): Promise<void> {
        const key = entry.uri.toString();
        if (this.expandedChildren.has(key)) {
            this.expandedChildren.delete(key);
            this.update();
            return;
        }
        this.expandedChildren.set(key, await this.listDirectory(entry.uri));
        this.update();
    }

    protected async openFile(uri: URI): Promise<void> {
        await open(this.openers, uri);
    }

    protected override render(): React.ReactNode {
        return this.activeRole ? this.renderFiles(this.activeRole) : this.renderRoles();
    }

    protected renderRoles(): React.ReactNode {
        const roles = this.workflow.current.roles;
        return (
            <div style={{ padding: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {roles.map(role => (
                        <button
                            key={role.path}
                            className='theia-button secondary'
                            style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 12px', fontSize: '1em', justifyContent: 'flex-start' }}
                            onClick={() => void this.openRole(role)}
                        >
                            <span className={this.roleIcon(role.kind)} aria-hidden='true' style={{ fontSize: '1.3em' }} />
                            <span>{role.label}</span>
                        </button>
                    ))}
                </div>
                {roles.length === 0 && <p style={{ opacity: 0.7 }}>workflow.json にロールが定義されていません。</p>}
            </div>
        );
    }

    protected roleIcon(kind: string): string {
        switch (kind) {
            case 'assets': return 'codicon codicon-device-camera-video';
            case 'planning': return 'codicon codicon-notebook';
            case 'exports': return 'codicon codicon-package';
            default: return 'codicon codicon-folder';
        }
    }

    protected renderFiles(role: AkariRoleDeclaration): React.ReactNode {
        return (
            <div style={{ padding: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                    <button className='theia-button secondary' onClick={() => this.backToRoles()} title='ロール一覧へ戻る' aria-label='ロール一覧へ戻る'>
                        <span className='codicon codicon-arrow-left' aria-hidden='true' />
                    </button>
                    <strong>{role.label}</strong>
                </div>
                {this.loading && <p style={{ opacity: 0.7 }}>読み込み中…</p>}
                {!this.loading && this.notice && <p style={{ opacity: 0.7 }}>{this.notice}</p>}
                {!this.loading && !this.notice && this.entries.length === 0 && (
                    <p style={{ opacity: 0.7 }}>ここにはまだファイルがありません。</p>
                )}
                {!this.loading && this.entries.length > 0 && (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                        {this.entries.map(entry => this.renderEntry(entry))}
                    </ul>
                )}
            </div>
        );
    }

    protected renderEntry(entry: BucketEntry): React.ReactNode {
        const key = entry.uri.toString();
        const isExpanded = this.expandedChildren.has(key);
        return (
            <React.Fragment key={key}>
                <li
                    style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '5px 6px', cursor: 'pointer', borderRadius: '4px'
                    }}
                    onClick={() => entry.isDirectory ? void this.toggleSubfolder(entry) : void this.openFile(entry.uri)}
                    title={entry.name}
                >
                    {entry.isDirectory
                        ? <span className={`codicon ${isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden='true' />
                        : <span style={{ width: '16px', display: 'inline-block' }} />}
                    <span className={entry.icon} aria-hidden='true' />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                </li>
                {entry.isDirectory && isExpanded && (this.expandedChildren.get(key) ?? []).map(child => (
                    <li
                        key={child.uri.toString()}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 6px 5px 28px',
                            cursor: child.isDirectory ? 'default' : 'pointer', opacity: child.isDirectory ? 0.6 : 1, borderRadius: '4px'
                        }}
                        onClick={() => !child.isDirectory && void this.openFile(child.uri)}
                        title={child.isDirectory ? `${child.name}（これ以上は展開できません）` : child.name}
                    >
                        <span className={child.icon} aria-hidden='true' />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{child.name}</span>
                    </li>
                ))}
            </React.Fragment>
        );
    }
}
