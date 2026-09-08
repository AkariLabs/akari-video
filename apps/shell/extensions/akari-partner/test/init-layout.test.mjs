import { testLayoutGuard, testLayoutDependency } from '../../akari-theme/test/helpers/init-layout-fixture.mjs';

testLayoutGuard(new URL('../src/browser/akari-partner-contribution.ts', import.meta.url), 'akari-partner', ["storage","factory","restore","width"]);

testLayoutDependency(new URL('../src/browser/akari-partner-contribution.ts', import.meta.url), 'instance.storageService.getData');

testLayoutDependency(new URL('../src/browser/akari-partner-contribution.ts', import.meta.url), 'instance.widgetManager.getOrCreateWidget');

testLayoutDependency(new URL('../src/browser/akari-partner-contribution.ts', import.meta.url), 'widget.restorePartnerTerminals');
