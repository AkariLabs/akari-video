import * as React from '@theia/core/shared/react';
import { Message } from '@theia/core/shared/@lumino/messaging';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { OpenerService, open } from '@theia/core/lib/browser';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { AKARI_COMMANDS, RAIL_CHANNEL_WIDGET_ID } from 'akari-shell-strip/lib/common/rail-ids';
import { AkariScopeService } from 'akari-shell-strip/lib/browser/akari-scope-service';
import { ProjectProgressService, stageSummary } from '../home/project-progress';
import { AkariChannelContextService, ChannelProject } from './akari-channel-context-service';

export const CHANNEL_WIDGET_ID = RAIL_CHANNEL_WIDGET_ID;
export const CHANNEL_WIDGET_LABEL = 'チャンネル';
const STYLE_ID = 'akari-channel-style';
const RAIL_TAB = `#theia-left-content-panel .lm-TabBar.theia-app-left .lm-TabBar-tab[data-akari-rail-id="${RAIL_CHANNEL_WIDGET_ID}"]`;
const CSS = `
${RAIL_TAB} .lm-TabBar-tabIcon { display:none !important; }
${RAIL_TAB}[data-akari-channel-initial]::after { content:attr(data-akari-channel-initial); position:absolute; top:5px; left:50%; transform:translateX(-50%); width:25px; height:25px; border-radius:7px; display:grid; place-items:center; background:var(--akari-elevated,#454750); color:var(--theia-foreground,#fff); font-size:15px; font-weight:700; }
${RAIL_TAB} .lm-TabBar-tabLabel { margin-top:25px; }
.akari-channel-panel { position:relative; box-sizing:border-box; height:100%; overflow-x:hidden; overflow-y:auto; padding:16px 14px; color:var(--theia-foreground); }
.akari-channel-heading { position:relative; display:block; width:100%; margin-bottom:14px; }
.akari-channel-heading-button { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; border:0; background:transparent; color:inherit; font-weight:700; font-size:16px; text-align:left; cursor:pointer; }
.akari-channel-popover { position:absolute; top:100%; left:0; right:0; z-index:10; box-sizing:border-box; min-width:0; width:auto; padding:7px; border:1px solid var(--theia-widget-border); border-radius:9px; background:var(--theia-editorWidget-background,var(--theia-editor-background)); box-shadow:0 15px 40px rgba(0,0,0,.3); }
.akari-channel-popover hr { border:0; border-top:1px solid var(--theia-widget-border); margin:6px 0; }
.akari-channel-popover .akari-channel-check { width:14px; text-align:right; }
.akari-channel-popover .akari-channel-row > span:first-child { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.akari-channel-section { margin:18px 0 8px; font-size:11px; opacity:.65; font-weight:700; }
.akari-channel-row { display:flex; width:100%; align-items:center; gap:8px; box-sizing:border-box; border:0; border-radius:7px; padding:8px; background:transparent; color:inherit; text-align:left; cursor:pointer; }
.akari-channel-row:hover { background:var(--theia-list-hoverBackground,rgba(127,127,127,.12)); }
.akari-channel-row[aria-current="page"] { background:var(--theia-list-activeSelectionBackground,rgba(127,127,127,.16)); }
.akari-channel-row small { margin-left:auto; opacity:.6; white-space:nowrap; }
.akari-channel-row.akari-channel-muted { opacity:.56; }
`;

@injectable()
export class AkariChannelWidget extends ReactWidget {
    static readonly ID = CHANNEL_WIDGET_ID;
    @inject(AkariChannelContextService) protected readonly context!: AkariChannelContextService;
    @inject(AkariScopeService) protected readonly scope!: AkariScopeService;
    @inject(CommandService) protected readonly commands!: CommandService;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(OpenerService) protected readonly openerService!: OpenerService;
    @inject(FileService) protected readonly files!: FileService;
    @inject(ProjectProgressService) protected readonly progress!: ProjectProgressService;
    protected projectStages = new Map<string, string>();
    protected popoverOpen = false;

    protected readonly onOutsidePointerDown = (event: PointerEvent): void => {
        const target = event.target;
        if (!(target instanceof Node)) return;
        const heading = this.node.querySelector('.akari-channel-heading-button');
        const popover = this.node.querySelector('.akari-channel-popover');
        if (heading?.contains(target) || popover?.contains(target)) return;
        this.closePopover();
    };

    protected readonly onPopoverKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        this.closePopover();
    };

    @postConstruct()
    protected init(): void {
        this.id = AkariChannelWidget.ID;
        this.title.label = CHANNEL_WIDGET_LABEL;
        this.updateCaption();
        this.title.closable = false;
        this.addClass('akari-channel-widget');
        this.toDispose.push(this.context.onDidChange(() => { this.updateCaption(); this.update(); this.updateRailTab(); void this.refreshStages(); }));
        this.update();
        this.updateRailTab();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.installStyle();
        this.updateRailTab();
        setTimeout(() => this.updateRailTab(), 100);
        setTimeout(() => this.updateRailTab(), 500);
        void this.context.refresh();
    }

    protected installStyle(): void {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = CSS;
        document.head.appendChild(style);
    }

    protected updateCaption(): void {
        this.title.caption = `${this.context.viewingChannel || 'チャンネル'} · チャンネルについて・プロジェクト一覧`;
    }

    protected togglePopover(): void {
        if (this.popoverOpen) { this.closePopover(); return; }
        this.popoverOpen = true;
        document.addEventListener('pointerdown', this.onOutsidePointerDown, true);
        document.addEventListener('keydown', this.onPopoverKeyDown, true);
        this.update();
    }

    protected closePopover(): void {
        document.removeEventListener('pointerdown', this.onOutsidePointerDown, true);
        document.removeEventListener('keydown', this.onPopoverKeyDown, true);
        if (this.popoverOpen) {
            this.popoverOpen = false;
            this.update();
        }
    }

    override dispose(): void {
        this.closePopover();
        super.dispose();
    }

    protected updateRailTab(): void {
        if (typeof document === 'undefined') return;
        const tab = document.querySelector<HTMLElement>(RAIL_TAB);
        if (!tab) return;
        tab.setAttribute('data-akari-channel-initial', (this.context.viewingChannel || 'チ').charAt(0));
    }

    protected async refreshStages(): Promise<void> {
        const projects = this.context.viewingChannel ? this.context.projectsOf(this.context.viewingChannel) : [];
        const stages = await Promise.all(projects.map(async project => {
            try { return [project.uri.toString(), stageSummary(await this.progress.readPresence(project.uri))] as const; }
            catch { return [project.uri.toString(), ''] as const; }
        }));
        this.projectStages = new Map(stages);
        this.update();
    }

    protected async openDesign(): Promise<void> {
        const root = this.context.rootUri;
        const channel = this.context.viewingChannel;
        if (!root || !channel) return;
        const uri = root.resolve('channels').resolve(channel).resolve('design.md');
        if (await this.files.exists(uri)) await open(this.openerService, uri);
        else this.messages.info('まだありません。パートナーに /channel-design で頼めます');
    }

    protected async openProjectList(): Promise<void> {
        await this.commands.executeCommand(AKARI_COMMANDS.openProjectList);
    }

    protected async chooseChannel(name: string): Promise<void> {
        this.closePopover();
        if (name === '__new__') {
            await this.commands.executeCommand('akari.home.open');
            this.messages.info('ホームの「チャンネル」から新しいチャンネルを作れます');
            return;
        }
        this.context.setViewingChannel(name);
        this.updateCaption();
        if (this.scope.scope === 'project') await this.openProjectList();
    }

    protected async openProject(project: ChannelProject, target: HTMLElement): Promise<void> {
        const rect = target.getBoundingClientRect();
        await this.commands.executeCommand(AKARI_COMMANDS.openProject, {
            uri: project.uri.toString(), originRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        });
    }

    protected override render(): React.ReactNode {
        const channel = this.context.viewingChannel;
        const projects = channel ? this.context.projectsOf(channel) : [];
        return <div className='akari-channel-panel'>
            <div className='akari-channel-heading'>
                <button type='button' className='akari-channel-heading-button' aria-haspopup='menu' aria-expanded={this.popoverOpen}
                    onClick={() => this.togglePopover()}>{channel || 'チャンネル'} ▾</button>
                {this.popoverOpen && <div className='akari-channel-popover' role='menu' aria-label='チャンネルを切り替える'>
                    {this.context.channels.map(name => <button key={name} type='button' className='akari-channel-row'
                        role='menuitemradio' aria-checked={channel === name} onClick={() => void this.chooseChannel(name)}>
                        <span>{name}</span><small>プロジェクト {this.context.projectsOf(name).length}</small>
                        <span className='akari-channel-check' aria-hidden='true'>{channel === name ? '✓' : ''}</span>
                    </button>)}
                    <hr />
                    <button type='button' className='akari-channel-row' role='menuitem'
                        onClick={() => void this.chooseChannel('__new__')}>新しいチャンネル…</button>
                </div>}
            </div>
            <button type='button' className='akari-channel-row' aria-current={this.scope.scope === 'channel' ? 'page' : undefined}
                onClick={() => void this.openProjectList()}>プロジェクト一覧</button>
            <div className='akari-channel-section'>チャンネルについて</div>
            <button type='button' className='akari-channel-row' onClick={() => void this.openDesign()}>チャンネル設計</button>
            {['デザイン', '人とモノ', '辞書とメモ', 'スキル'].map(label =>
                <div className='akari-channel-row akari-channel-muted' key={label}><span>{label}</span><small>準備中</small></div>)}
            <div className='akari-channel-section'>プロジェクト</div>
            {projects.map(project => <button key={project.uri.toString()} type='button' className='akari-channel-row'
                aria-current={this.context.currentProjectUri?.toString() === project.uri.toString() ? 'page' : undefined}
                onClick={event => void this.openProject(project, event.currentTarget)}>
                <span>{project.title || project.name}</span>
                <small>{this.context.currentProjectUri?.toString() === project.uri.toString() ? '開いています' : this.projectStages.get(project.uri.toString()) ?? ''}</small>
            </button>)}
        </div>;
    }
}
