import { testLayoutSynchronousFailure, testLayoutGuard, testLayoutDependency } from '../../akari-theme/test/helpers/init-layout-fixture.mjs';

testLayoutGuard(new URL('../src/browser/akari-activity-bar-curation.ts', import.meta.url), 'akari-shell-strip', ["left","asset","menu","subscribe","mode"]);
testLayoutGuard(new URL('../src/browser/akari-bottom-panel-curation.ts', import.meta.url), 'akari-shell-strip', ["close","reconcile","connect"]);
testLayoutGuard(new URL('../src/browser/akari-right-panel-curation.ts', import.meta.url), 'akari-shell-strip', ["reconcile","subscribe","mode"]);

testLayoutDependency(new URL('../src/browser/akari-bottom-panel-curation.ts', import.meta.url), 'shell.closeWidget');

testLayoutSynchronousFailure(new URL('../src/browser/akari-activity-bar-curation.ts', import.meta.url), 'reconcileLeftPanel');

testLayoutSynchronousFailure(new URL('../src/browser/akari-right-panel-curation.ts', import.meta.url), 'reconcile');
