import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow } from '@theia/core/electron-shared/electron';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { injectable } from '@theia/core/shared/inversify';

import { parseRenderArgv } from './akari-render-argv';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

@injectable()
export class AkariOsrExportContribution implements ElectronMainApplicationContribution {
  onStart(_application: ElectronMainApplication): void {
    const parsed = parseRenderArgv(process.argv);
    if (!parsed.requested) return;

    // Theia の startContributions() は初期ウィンドウ表示と backend 起動の後に走る。
    // v0 は --render 時にも一瞬だけ初期 UI が現れる制約を許容し、ここで全ウィンドウを閉じる。
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    void this.run(parsed);
  }

  private async run(parsed: ReturnType<typeof parseRenderArgv>): Promise<void> {
    if (parsed.error) {
      console.error(`akari-osr-export: ${parsed.error}`);
      app.exit(2);
      return;
    }
    try {
      const modulePath = this.runtimeCandidates().find(existsSync);
      if (!modulePath) throw new Error('OSR export runtime is not bundled');
      const runtime = await dynamicImport(pathToFileURL(modulePath).href);
      await runtime.runOsrExport(parsed);
      app.exit(0);
    } catch (error) {
      console.error(`akari-osr-export: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      app.exit(1);
    }
  }

  private runtimeCandidates(): string[] {
    return [
      resolve(process.resourcesPath, 'packages', 'osr-export', 'src', 'electron-main.mjs'),
      resolve(__dirname, '../../../../../../packages/osr-export/src/electron-main.mjs')
    ];
  }
}
