export interface ProjectTreePolicy {
    hidden: string[];
    sidecarSuffixes: string[];
}

export interface ProjectRole {
    path: string;
    label: string;
}

/**
 * どのプロジェクトでも常に隠す実体。workflow.json の `tree.hidden` はプロジェクト固有の
 * 追加分を書く場所であり、OS や VCS が勝手に置くゴミをプロジェクトごとに列挙させたくない
 * ため built-in で持つ（実機報告 2026-08-08: `assets/.DS_Store` が素材カードとして
 * 1 枚出ていた）。比較は大文字小文字を無視する — `Thumbs.db` / `desktop.ini` は
 * Windows 側の表記ゆれがあるため。
 */
const BUILT_IN_HIDDEN_ENTRIES = ['.gitkeep', '.ds_store', '.localized', 'thumbs.db', 'desktop.ini', '.git'];

/**
 * macOS が非 HFS ボリューム（SD カード・USB・ネットワーク共有）へ書く AppleDouble の
 * 片割れ。`._clip.mp4` のように素材と同じ拡張子を持つので名前の完全一致では拾えず、
 * 素材カードとして 1 枚出てしまう（開いても壊れたメタデータしか無い）。
 */
const BUILT_IN_HIDDEN_PREFIXES = ['._'];

export function shouldShowProjectPath(relativePath: string | undefined, policy: ProjectTreePolicy, developerMode: boolean): boolean {
    if (developerMode || !relativePath) {
        return true;
    }
    const segments = relativePath.split('/');
    if (segments.some(segment => BUILT_IN_HIDDEN_ENTRIES.includes(segment.toLowerCase()))) {
        return false;
    }
    if (segments.some(segment => BUILT_IN_HIDDEN_PREFIXES.some(prefix => segment.startsWith(prefix)))) {
        return false;
    }
    if (policy.hidden.some(entry => relativePath === entry || segments.includes(entry))) {
        return false;
    }
    return !policy.sidecarSuffixes.some(suffix => relativePath.endsWith(suffix));
}

export function localizedRoleLabel(relativePath: string | undefined, roles: ProjectRole[], developerMode: boolean): string | undefined {
    if (developerMode || !relativePath) {
        return undefined;
    }
    return roles.find(role => role.path === relativePath)?.label;
}
