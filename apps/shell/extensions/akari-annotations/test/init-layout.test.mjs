import { testLayoutSynchronousFailure, testLayoutGuard } from '../../akari-theme/test/helpers/init-layout-fixture.mjs';

testLayoutGuard(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'akari-annotations', ["right-order","subscribe"]);

testLayoutSynchronousFailure(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'reconcileRightPanelOrder');
