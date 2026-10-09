import type { FileService } from '@theia/filesystem/lib/browser/file-service';
import type URI from '@theia/core/lib/common/uri';

/** intake の表示名を優先し、未設定ならフォルダ名を使う。 */
export async function readProjectTitle(files: Pick<FileService, 'readFile'>, root: URI): Promise<string> {
    try {
        const parsed: unknown = JSON.parse((await files.readFile(root.resolve('.akari/intake.json'))).value.toString());
        const title = (parsed as { title?: unknown } | null)?.title;
        if (typeof title === 'string' && title.trim().length > 0) return title;
    } catch { /* intake がない、または読めないプロジェクト。 */ }
    return root.path.base;
}
