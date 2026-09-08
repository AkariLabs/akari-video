import { testLayoutGuard, testLayoutDependency } from '../../akari-theme/test/helpers/init-layout-fixture.mjs';

testLayoutGuard(new URL('../src/browser/daihon/akari-daihon-contribution.ts', import.meta.url), 'akari-transcript', ["daihon","cuts","configure"]);

testLayoutDependency(new URL('../src/browser/daihon/akari-daihon-contribution.ts', import.meta.url), 'instance.ensureWidget');

testLayoutDependency(new URL('../src/browser/daihon/akari-daihon-contribution.ts', import.meta.url), 'instance.ensureCutsWidget');
