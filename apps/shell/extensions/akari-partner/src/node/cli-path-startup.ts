import { ILogger } from '@theia/core';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import * as path from 'path';
import { ensureCli, resolveCliShimDir } from './cli-provisioner';
import { resolveAkariHomeDir } from './partner-connection-writer';

export interface PrependCliShimPathOptions {
    shimDir: string;
    existingPath?: string;
    pathDelimiter: string;
}

/**
 * backend の PATH に CLI シム dir を一度だけ加える純関数。
 * 既存 PATH のどこかに同じ要素があれば、ユーザーが選んだ順序を保つため文字列を変更しない。
 */
export function prependCliShimDirToPath(options: PrependCliShimPathOptions): string {
    const existingPath = options.existingPath ?? '';
    if (existingPath.split(options.pathDelimiter).includes(options.shimDir)) {
        return existingPath;
    }
    return existingPath
        ? `${options.shimDir}${options.pathDelimiter}${existingPath}`
        : options.shimDir;
}

@injectable()
export class CliPathStartupContribution implements BackendApplicationContribution {

    constructor(
        @inject(ILogger) @named('akari-partner')
        protected readonly logger: ILogger
    ) { }

    initialize(): void {
        const shimDir = resolveCliShimDir(resolveAkariHomeDir());
        // 汎用ターミナルは backend の process.env を継承するため、シムがまだ無くても先に
        // PATH へ加える。シムの存在を要求する buildCliPathEnv() はパートナー PTY 専用の別規約。
        process.env.PATH = prependCliShimDirToPath({
            shimDir,
            existingPath: process.env.PATH,
            pathDelimiter: path.delimiter
        });

        // backend 起動を待たせない。配備失敗はログだけに留め、アプリ本体は起動を続ける。
        void ensureCli({
            preferBundled: true,
            resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
        }).then(result => {
            for (const line of result.log) {
                void this.logger.info(`[akari CLI] ${line}`);
            }
        }).catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            void this.logger.warn(`[akari CLI] 起動時の自動配備に失敗しました: ${message}`);
        });
    }
}
