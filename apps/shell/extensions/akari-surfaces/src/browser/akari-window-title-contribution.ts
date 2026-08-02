import { inject, injectable } from '@theia/core/shared/inversify';
import { WindowTitleContribution } from '@theia/core/lib/browser/window/window-title-service';
import { AkariCurrentLocationHolder } from './akari-current-location-holder';

/**
 * F6（task 2026-08-03-shell-quickwins-feedback）ウィンドウタイトルへの現在地反映
 * （ベストエフォート・task.md「タイトルが Theia 側の既定で難しければホーム内表示
 * のみで可」）。
 *
 * Theia core の `WindowTitleService` は `${rootName}` 等のテンプレート変数を
 * 素通りで組み立てた後、`WindowTitleContribution.enhanceTitle()` を最後に通す
 * （拡張側がテンプレートの上書きなしに追記できる正規の拡張点）。本実装は
 * 作業場ルート `channels/<channel>/videos/<project>` の内側を開いているときだけ
 * 「(<作業場名>)」を末尾に足す — 作業場外（お試し）のプロジェクトやプロジェクト
 * 未選択のときはタイトルを変更しない（Theia 既定のまま）。
 */
@injectable()
export class AkariWindowTitleContribution implements WindowTitleContribution {

    @inject(AkariCurrentLocationHolder)
    protected readonly location: AkariCurrentLocationHolder;

    enhanceTitle(title: string, _parts: Map<string, string | undefined>): string {
        const current = this.location.current;
        if (!current || current.kind !== 'inside' || !current.workspaceName) {
            return title;
        }
        return `${title} (${current.workspaceName})`;
    }
}
