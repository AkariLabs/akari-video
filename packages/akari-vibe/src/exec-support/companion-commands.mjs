export const ALLOWED_COMMAND_IDS = Object.freeze([
    'akari.preview.ensureVisible', 'akari.preview.seekOutput', 'akari.preview.togglePlayback',
    'akari.preview.play', 'akari.preview.pause', 'akari.preview.setFullscreen', 'akari.preview.setViewZoom',
    'akari.preview.setPlaybackRate', 'akari.preview.setLoopRange', 'akari.preview.enterCropMode',
    'akari.preview.openPerspectivePanel', 'akari.preview.pulseItem', 'akari.preview.showZoneHint',
    'akari.timeline.focusItem', 'akari.timeline.seek', 'akari.timeline.setView', 'akari.timeline.setTool',
    'akari.timeline.setSnap', 'akari.timeline.reveal', 'akari.inspector.open', 'akari.daihon.open', 'akari.cuts.open',
    'akari.transcribe.openDialog', 'akari.catalog.open', 'akari.catalog.importAsset', 'akari.catalog.listCategories', 'akari.menu.focus',
    'akari.menu.listSkills', 'akari.menu.listOpenTargets', 'akari.review.open',
    'akari.review.board.open', 'akari.partner.open', 'akari.settings.open',
]);

const rows = [
    ['command_akari_canvas_open', 'command:akari.canvas.open', 'キャンバスを開く'],
    ['command_akari_catalog_open', 'command:akari.catalog.open', 'カタログを開く', 'akari.catalog.open', { tab: 'project' }],
    ['command_akari_cuts_open', 'command:akari.cuts.open', 'カット候補を開く', 'akari.cuts.open', {}],
    ['command_akari_home_openFirstRunSetup', 'command:akari.home.openFirstRunSetup', '初回セットアップを開く'],
    ['command_akari_home_openIntakeForm', 'command:akari.home.openIntakeForm', '進め方フォームを開く'],
    ['command_akari_home_openProjectLauncher', 'command:akari.home.openProjectLauncher', 'プロジェクト・ランチャーを開く'],
    ['command_akari_partner_open', 'command:akari.partner.open', 'パートナーを開く', 'akari.partner.open'],
    ['command_akari_preview_openAudioMeter', 'command:akari.preview.openAudioMeter', '音声メーターを開く'],
    ['command_akari_project_showChanges', 'command:akari.project.showChanges', '変更を見る'],
    ['command_akari_review_board_open', 'command:akari.review.board.open', 'レビューボードを開く', 'akari.review.board.open'],
    ['command_akari_sessionViewer_open', 'command:akari.sessionViewer.open', 'AKARI: 録音セッションを見返す'],
    ['command_akari_settings_open', 'command:akari.settings.open', 'AKARI Video の設定'],
    ['command_akari_transcribe_openDialog', 'command:akari.transcribe.openDialog', '文字起こしのポップアップを開く'],
    ['command_akari_transcript_open', 'command:akari.transcript.open', '文字起こしを開く'],
    ['command_akari_world_openBesidePreview', 'command:akari.world.openBesidePreview', 'プレビューと並べる'],
    ['command_akari_world_openMap', 'command:akari.world.openMap', '地図を開く'],
    ['display_fullscreen_toggle', 'display:fullscreen-toggle', '全画面', 'akari.preview.setFullscreen', {}],
    ['panel_assets', 'panel:assets', '素材パネル', 'akari.catalog.open', { tab: 'library' }],
    ['panel_daihon', 'panel:daihon', '台本', 'akari.daihon.open', {}],
    ['panel_inspector', 'panel:inspector', 'インスペクター', 'akari.inspector.open', {}],
    ['panel_review', 'panel:review', '注釈パネル', 'akari.review.open'],
    ['panel_session_viewer', 'panel:session-viewer', 'panel:session-viewer'],
    ['panel_timeline', 'panel:timeline', 'タイムライン', 'akari.timeline.reveal'],
    ['tab_assets_builtin', 'tab:assets-builtin', 'tab:assets-builtin'],
    ['view_catalog', 'view:catalog', 'ライブラリ', 'akari.catalog.open', { tab: 'library' }],
    ['view_materials', 'view:materials', 'プロジェクト', 'akari.catalog.open', { tab: 'project' }],
];

export const companionCommandTable = Object.freeze(rows.map(([key, id, label, commandId, args]) => Object.freeze({
    key, id, label, available: Boolean(commandId), commandId, args,
    reason: commandId ? null : '許可一覧に対応する受け口がない',
})));

export const companionCommandByKey = new Map(companionCommandTable.map(row => [row.key, row]));
export const keyOf = id => id.replace(/[^a-zA-Z0-9_]/g, '_');
export const labelStem = label => label.replace(/(?:を開く|パネル)$/g, '');
export const shellCatalog = Object.freeze({ entries: companionCommandTable, diagnostics: [] });

export function externalCandidates(text = '') {
    const candidates = [];
    for (const m of text.matchAll(/https?:\/\/[^\s「」『』<>]+/g)) {
        const raw = m[0].replace(/[。、,]+$/, '');
        try { const url = new URL(raw); if (url.hostname) candidates.push({ kind: 'url', value: url.href, available: true }); } catch {}
    }
    const app = text.match(/(?:^|[、\s])([^、。\n]+?)(?:を|のアプリを)\s*(?:開いて|起動して)/)?.[1]
        ?.replace(/^(?:えーと|えっと|なんか)\s*/, '').trim();
    if (!candidates.length && app) candidates.push({ kind: 'app', value: app, available: false });
    return candidates.slice(0, 12).map((candidate, index) => ({ ...candidate, key: `external_${index}` }));
}
