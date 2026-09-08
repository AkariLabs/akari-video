import { testLayoutSynchronousFailure, testLayoutGuard } from './helpers/init-layout-fixture.mjs';

testLayoutGuard(new URL('../src/browser/akari-shell-card-layout.ts', import.meta.url), 'akari-theme', ["gap"]);

testLayoutSynchronousFailure(new URL('../src/browser/akari-shell-card-layout.ts', import.meta.url), 'applyGap');
