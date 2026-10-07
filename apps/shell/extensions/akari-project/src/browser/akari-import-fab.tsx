import * as React from '@theia/core/shared/react';
import { MessageService } from '@theia/core/lib/common';
import { FileDialogService } from '@theia/filesystem/lib/browser';
import type { DroppedAsset } from '../common/akari-project-protocol';
import { classifySelectedFiles, importFabItems, ImportFabItem } from '../common/import-fab-items';
import { AKARI_INK, AKARI_LINE, AKARI_RADIUS, AKARI_SURFACE } from '../common/akari-surface-tokens';

interface Props {
    dialogs: Pick<FileDialogService, 'showOpenDialog'>;
    messages: Pick<MessageService, 'info' | 'warn'>;
    projectOpen: boolean;
    importAssets(assets: DroppedAsset[]): Promise<void>;
}

const css = `
[data-akari-import-fab] { width:40px; height:40px; border:0; border-radius:50%; padding:0;
 display:grid; place-items:center; background:#f97316; color:#000; cursor:pointer;
 box-shadow:0 5px 16px rgba(0,0,0,.35); font-size:29px; font-weight:400; line-height:1; }
[data-akari-import-fab]:hover { filter:brightness(1.12); }
[data-akari-import-fab]:focus-visible, [data-akari-import-popup] button:focus-visible { outline:2px solid var(--akari-accent); outline-offset:2px; }
[data-akari-import-fab] .akari-import-fab-plus { display:block; transition:transform 160ms ease; }
[data-akari-import-fab][aria-expanded="true"] .akari-import-fab-plus { transform:rotate(45deg); }
[data-akari-import-popup] { position:absolute; right:0; bottom:60px; width:min(264px, 100%);
 max-height:calc(100% - 72px); overflow-y:auto; box-sizing:border-box; padding:8px;
 border:1px solid ${AKARI_LINE.edge}; border-radius:${AKARI_RADIUS.card}px;
 background:${AKARI_SURFACE.raised}; color:${AKARI_INK};
 box-shadow:0 10px 30px rgba(0,0,0,.3); pointer-events:auto; }
[data-akari-import-popup] h3 { margin:4px 8px 8px; font-size:13px; font-weight:700; }
[data-akari-import-popup] button { display:flex; align-items:center; gap:9px; width:100%; min-height:40px;
 box-sizing:border-box; margin:0; padding:6px 8px; border:0; border-radius:${AKARI_RADIUS.panel}px;
 background:transparent; color:${AKARI_INK}; text-align:left; font:inherit; font-size:12.5px; cursor:pointer; }
[data-akari-import-popup] button:hover { background:${AKARI_SURFACE.elevated}; }
[data-akari-import-popup] button[data-soon] { color:var(--akari-muted); }
[data-akari-import-popup] button .codicon { width:20px; text-align:center; font-size:16px; }
[data-akari-import-popup] button .akari-import-fab-label { flex:1; min-width:0; }
[data-akari-import-popup] .akari-import-fab-soon { padding:1px 5px; border-radius:${AKARI_RADIUS.chip}px;
 background:${AKARI_SURFACE.elevated}; color:var(--akari-muted); font-size:10px; }
[data-akari-import-popup] p { margin:8px 8px 3px; padding-top:9px; border-top:1px solid ${AKARI_LINE.hairline};
 color:var(--akari-muted); font-size:11px; line-height:1.4; }
@media (prefers-reduced-motion: reduce) {
 [data-akari-import-fab] .akari-import-fab-plus { transition:none; }
 [data-akari-import-fab][aria-expanded="true"] .akari-import-fab-plus { transform:none; }
}
`;

export function AkariImportFab(props: Props): React.ReactElement {
    // akari-surfaces の設定キーの文字列ミラー。
    let vibePreviewEnabled = false;
    try { vibePreviewEnabled = window.localStorage.getItem('akari.vibePreview.enabled') === '1'; } catch { /* off */ }
    const [open, setOpen] = React.useState(false);
    const container = React.useRef<HTMLDivElement>(null);
    const button = React.useRef<HTMLButtonElement>(null);

    React.useEffect(() => {
        if (!open) return;
        const outside = (event: PointerEvent): void => {
            if (event.target instanceof Node && !container.current?.contains(event.target)) setOpen(false);
        };
        const escape = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                button.current?.focus({ preventScroll: true });
            }
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', escape, true);
        return () => {
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('keydown', escape, true);
        };
    }, [open]);

    const choose = async (item: ImportFabItem): Promise<void> => {
        setOpen(false);
        if (item.info) {
            props.messages.info(item.info);
            return;
        }
        if (item.id === 'internet') {
            window.dispatchEvent(new CustomEvent('akari.browser.requestOpen'));
            return;
        }
        if (!props.projectOpen) {
            props.messages.warn('先にプロジェクトを開いてください。');
            return;
        }
        const selected = await props.dialogs.showOpenDialog({
            title: 'デバイスから取り込む', canSelectMany: true, canSelectFiles: true, canSelectFolders: false
        });
        const { accepted, rejectedCount } = classifySelectedFiles(selected);
        if (accepted.length) await props.importAssets(accepted);
        if (rejectedCount) props.messages.warn(
            `対応していないファイル形式のため ${rejectedCount} 件を取り込めませんでした（動画・音声・画像のみ取り込めます）。`
        );
    };

    return <div ref={container} style={{ position:'absolute', left:12, right:12, top:0, bottom:0, zIndex:10,
        display:'flex', justifyContent:'flex-end', alignItems:'flex-end', paddingBottom:12,
        boxSizing:'border-box', pointerEvents:'none' }}>
        <style>{css}</style>
        {open && <div data-akari-import-popup role='dialog' aria-label='いま取り込む'>
            <h3>いま取り込む</h3>
            {importFabItems(vibePreviewEnabled).map(item => <button key={item.id} type='button' data-soon={item.soon ? 'true' : undefined}
                onClick={() => void choose(item)}>
                <span className={`codicon ${item.icon}`} aria-hidden='true' />
                <span className='akari-import-fab-label'>{item.label}</span>
                {item.soon && <span className='akari-import-fab-soon'>{item.soon}</span>}
            </button>)}
            <p>ファイルをこのパネルに落としても取り込めます。</p>
        </div>}
        <button ref={button} type='button' data-akari-import-fab aria-label='いま取り込む'
            aria-haspopup='dialog' aria-expanded={open} onClick={() => setOpen(value => !value)}
            style={{ pointerEvents:'auto' }}><span className='akari-import-fab-plus'>+</span></button>
    </div>;
}
