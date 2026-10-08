import { interfaces } from '@theia/core/shared/inversify';
import { AkariTitleBarContribution } from './title-bar/akari-title-bar-contribution';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronMenuContribution = require('@theia/core/lib/electron-browser/menu/electron-menu-contribution').ElectronMenuContribution;

/** Theia の帯の生成経路を AKARI の帯へ差し替える。 */
export function bindTitleBar(_bind: interfaces.Bind, rebind: interfaces.Rebind): void {
    rebind(ElectronMenuContribution).to(AkariTitleBarContribution).inSingletonScope();
}
