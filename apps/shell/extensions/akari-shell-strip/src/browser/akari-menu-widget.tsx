import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { CommandService } from '@theia/core/lib/common';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileStat } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';

interface MenuAction {
    id: string;
    label: string;
    icon: string;
    run: () => void;
}

interface SkillEntry {
    name: string;
    description: string;
}

// AkariHomeWidget（akari-surfaces 拡張）の id 文字列。パッケージ間の import を
// 増やさないため定数として直接持つ（akari-project の 'files' 参照など、
// 既存コードにも同じ「文字列 id だけ知っている」パターンがある）。
const HOME_WIDGET_ID = 'akari-home-widget';

const SHOW_CHANGES_COMMAND = 'akari.project.showChanges';
const OPEN_ANNOTATIONS_COMMAND = 'akari.annotations.open';
const OPEN_TRANSCRIPT_COMMAND = 'akari.transcript.open';

/**
 * アクティビティバー5番目のアイコン「メニュー」。
 *
 * - 「ひらく」: よく使う画面をワンクリックで開く（CommandService 経由。
 *   俯瞰だけは専用コマンドが無いため WidgetManager + ApplicationShell で
 *   直接 shell へ再アタッチする）。
 * - 「やらせる（スキル）」: 開いているプロジェクトの `.claude/skills/<name>/SKILL.md`
 *   の frontmatter（name / description）を列挙する v0 実装。ワンクリック実行は
 *   スコープ外 — パートナーペインでの依頼を促す文言のみ添える。
 */
@injectable()
export class AkariMenuWidget extends ReactWidget {
    static readonly ID = 'akari-menu-widget';

    @inject(CommandService)
    protected readonly commands!: CommandService;
    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;
    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;
    @inject(FileService)
    protected readonly files!: FileService;
    @inject(WorkspaceService)
    protected readonly workspace!: WorkspaceService;

    protected skills: SkillEntry[] = [];
    protected skillsNotice = '';

    @postConstruct()
    protected init(): void {
        this.id = AkariMenuWidget.ID;
        this.title.label = 'メニュー';
        this.title.caption = 'メニュー';
        this.title.iconClass = 'codicon codicon-menu';
        this.title.closable = false;
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.loadSkills()));
        void this.loadSkills();
        this.update();
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        void this.loadSkills();
    }

    protected get actions(): MenuAction[] {
        return [
            { id: OPEN_ANNOTATIONS_COMMAND, label: 'タイムライン', icon: 'codicon codicon-comment', run: () => this.runCommand(OPEN_ANNOTATIONS_COMMAND) },
            { id: OPEN_TRANSCRIPT_COMMAND, label: '文字起こし', icon: 'codicon codicon-comment-discussion', run: () => this.runCommand(OPEN_TRANSCRIPT_COMMAND) },
            { id: 'akari.menu.openOverview', label: '俯瞰', icon: 'codicon codicon-dashboard', run: () => void this.openOverview() },
            { id: SHOW_CHANGES_COMMAND, label: '変更を見る', icon: 'codicon codicon-diff', run: () => this.runCommand(SHOW_CHANGES_COMMAND) }
        ];
    }

    protected runCommand(commandId: string): void {
        this.commands.executeCommand(commandId).catch(error => {
            console.warn(`[akari-shell-strip] menu action failed (${commandId}):`, error);
        });
    }

    /**
     * 俯瞰（AkariHomeWidget）を開く既存コマンドは無いため、shell への
     * 再アタッチで代替する。同 widget は closable=false のため通常は
     * 既にアタッチ済みだが、念のため未アタッチ時は左パネル同様の要領で
     * main エリアへ addWidget してから activate する。
     */
    protected async openOverview(): Promise<void> {
        try {
            const widget = await this.widgetManager.getOrCreateWidget(HOME_WIDGET_ID);
            if (!widget.isAttached) {
                this.shell.addWidget(widget, { area: 'main', rank: 10 });
            }
            await this.shell.activateWidget(widget.id);
        } catch (error) {
            console.warn('[akari-shell-strip] failed to reveal overview widget:', error);
        }
    }

    protected async loadSkills(): Promise<void> {
        const roots = await this.workspace.roots;
        const root = roots[0]?.resource;
        if (!root) {
            this.skills = [];
            this.skillsNotice = 'プロジェクトを開くと、使えるスキルがここに並びます。';
            this.update();
            return;
        }
        let stat: FileStat;
        try {
            stat = await this.files.resolve(root.resolve('.claude/skills'));
        } catch {
            this.skills = [];
            this.skillsNotice = 'このプロジェクトにはスキルがまだありません。';
            this.update();
            return;
        }
        const directories = (stat.children ?? []).filter(child => child.isDirectory);
        const parsed: SkillEntry[] = [];
        for (const directory of directories) {
            try {
                const content = await this.files.readFile(directory.resource.resolve('SKILL.md'));
                const entry = this.parseFrontmatter(content.value.toString());
                if (entry) {
                    parsed.push(entry);
                }
            } catch {
                // SKILL.md が無い/読めないディレクトリは静かにスキップする。
            }
        }
        parsed.sort((left, right) => left.name.localeCompare(right.name));
        this.skills = parsed;
        this.skillsNotice = parsed.length === 0 ? 'このプロジェクトにはスキルがまだありません。' : '';
        this.update();
    }

    /**
     * SKILL.md 先頭の `---`〜`---` frontmatter から name / description のみを
     * 拾う簡易パーサー。この用途の frontmatter は単一行の `key: value` のみで
     * 構成される（ブロックスカラー等は使わない）ため、外部 YAML 依存を増やさず
     * 自前で十分まかなえる。
     */
    protected parseFrontmatter(content: string): SkillEntry | undefined {
        const lines = content.split(/\r?\n/);
        if (lines[0]?.trim() !== '---') {
            return undefined;
        }
        let name: string | undefined;
        let description: string | undefined;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '---') {
                break;
            }
            const match = /^([a-zA-Z_-]+):\s?(.*)$/.exec(line);
            if (!match) {
                continue;
            }
            if (match[1] === 'name') {
                name = match[2].trim();
            } else if (match[1] === 'description') {
                description = match[2].trim();
            }
        }
        return name ? { name, description: description ?? '' } : undefined;
    }

    protected override render(): React.ReactNode {
        return (
            <div style={{ padding: '14px', overflow: 'auto', height: '100%', boxSizing: 'border-box' }}>
                <section style={{ marginBottom: '22px' }}>
                    <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>ひらく</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {this.actions.map(action => (
                            <button
                                key={action.id}
                                className='theia-button secondary'
                                style={{ display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'flex-start', padding: '8px 10px' }}
                                onClick={action.run}
                            >
                                <span className={action.icon} aria-hidden='true' />
                                <span>{action.label}</span>
                            </button>
                        ))}
                    </div>
                </section>
                <section>
                    <h3 style={{ margin: '0 0 8px', fontSize: '0.85em', opacity: 0.6, letterSpacing: '0.05em' }}>やらせる（スキル）</h3>
                    {this.skillsNotice && <p style={{ opacity: 0.7, margin: '0 0 8px' }}>{this.skillsNotice}</p>}
                    {this.skills.length > 0 && (
                        <>
                            <p style={{ opacity: 0.6, fontSize: '0.85em', margin: '0 0 10px' }}>
                                パートナーペインでスキル名を伝えると実行を依頼できます。
                            </p>
                            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {this.skills.map(skill => (
                                    <li key={skill.name} style={{
                                        border: '1px solid var(--theia-widget-border)', borderRadius: '6px', padding: '8px 10px'
                                    }}>
                                        <div style={{ fontWeight: 600 }}>{skill.name}</div>
                                        <div style={{ opacity: 0.75, fontSize: '0.85em', marginTop: '4px' }}>{skill.description}</div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </section>
            </div>
        );
    }
}
