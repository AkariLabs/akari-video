import { inject, injectable } from '@theia/core/shared/inversify';
import { Command, CommandContribution, CommandRegistry, Emitter, Event } from '@theia/core/lib/common';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { AkariProjectService } from '../common/akari-project-protocol';
import {
    parseRecentShapes, pushRecentShape, SHAPE_SHELF_RECENT_STORAGE_KEY, ShapeShelfPreset
} from '../common/shape-shelf';

/**
 * 図形 1 件を id で引く内部コマンド。タイムライン側（akari-annotations の `akari.timeline.addShapeAt`）が
 * 置く直前に形を引き直すために使う。拡張をまたぐ import はしないので id は文字列で複製する。
 * 戻り値 = `{ preset, base? }`（base = 角丸の見本が写す元の形）。
 */
export const SHAPE_SHELF_PRESET_COMMAND: Command = { id: 'akari.library.shapePreset' };
/** 置いた直後にタイムライン側が投げる window イベント。最近使用はこれで積む（押す・落とすの両方）。 */
export const SHAPE_PLACED_EVENT = 'akari.library.shapePlaced';

/** 棚のデータ（バックエンドから 1 回だけ読む）と、利用者ごとの「最近使用した項目」。 */
@injectable()
export class ShapeShelfService implements CommandContribution, FrontendApplicationContribution {

    @inject(AkariProjectService)
    protected readonly projectService: AkariProjectService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected loading: Promise<void> | undefined;
    protected presetList: ShapeShelfPreset[] = [];
    protected byId = new Map<string, ShapeShelfPreset>();
    protected recentIds: string[] = [];
    protected loaded = false;

    get presets(): readonly ShapeShelfPreset[] { return this.presetList; }
    get recent(): readonly string[] { return this.recentIds; }
    get isLoaded(): boolean { return this.loaded; }

    onStart(): void {
        this.recentIds = this.readRecent();
        window.addEventListener(SHAPE_PLACED_EVENT, event => {
            const preset = (event as CustomEvent<{ preset?: unknown }>).detail?.preset;
            if (typeof preset === 'string') this.markUsed(preset);
        });
        window.addEventListener('storage', event => {
            if (event.key !== SHAPE_SHELF_RECENT_STORAGE_KEY) return;
            this.recentIds = parseRecentShapes(event.newValue);
            this.onDidChangeEmitter.fire();
        });
        void this.ready();
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(SHAPE_SHELF_PRESET_COMMAND, {
            execute: async (id: unknown) => {
                if (typeof id !== 'string') return undefined;
                await this.ready();
                const preset = this.byId.get(id);
                if (!preset) return undefined;
                const base = preset.rounded_from ? this.byId.get(preset.rounded_from.base) : undefined;
                return { preset, ...(base ? { base } : {}) };
            }
        });
    }

    ready(): Promise<void> {
        this.loading ??= this.projectService.getShapeShelf()
            .catch(() => [] as ShapeShelfPreset[])
            .then(presets => {
                this.presetList = presets;
                this.byId = new Map(presets.map(preset => [preset.id, preset]));
                this.loaded = true;
                this.onDidChangeEmitter.fire();
            });
        return this.loading;
    }

    markUsed(id: string): void {
        this.recentIds = pushRecentShape(this.recentIds, id);
        try {
            window.localStorage.setItem(SHAPE_SHELF_RECENT_STORAGE_KEY, JSON.stringify(this.recentIds));
        } catch { /* 保存できなくても当該セッションの並びは保つ */ }
        this.onDidChangeEmitter.fire();
    }

    protected readRecent(): string[] {
        try {
            return parseRecentShapes(window.localStorage.getItem(SHAPE_SHELF_RECENT_STORAGE_KEY));
        } catch {
            return [];
        }
    }
}
