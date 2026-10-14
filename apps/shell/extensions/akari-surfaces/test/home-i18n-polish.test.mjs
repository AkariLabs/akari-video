import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage, t } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { computeProjectStages, EMPTY_PRESENCE } = require('../lib/browser/home/project-progress-model.js');

function stageDetails(assetFiles, exportFiles) {
    const stages = computeProjectStages({ ...EMPTY_PRESENCE, planningDocs: 1, assetFiles, editHasContent: true, reportFiles: 1, exportFiles });
    return [stages.find(stage => stage.key === 'assets').detail, stages.find(stage => stage.key === 'export').detail];
}

test('home asset and project counts render singular and plural English', () => {
    try {
        setLanguage('en');
        assert.equal(t('surfaces.home.projectAssets.label', { count: 1, n: 1 }), '1 asset');
        assert.equal(t('surfaces.home.projectAssets.label', { count: 2, n: 2 }), '2 assets');
        assert.equal(t('surfaces.home.otherProjectCount.label', { count: 1, n: 1 }), '1 project');
        assert.equal(t('surfaces.home.otherProjectCount.label', { count: 2, n: 2 }), '2 projects');
        assert.equal(t('surfaces.projects.computeProjectStagesVideos.message', { exportFiles: 1, n: 1 }), '1 video');
        assert.equal(t('surfaces.projects.computeProjectStagesVideos.message', { exportFiles: 2, n: 2 }), '2 videos');
        assert.deepEqual(stageDetails(1, 1), ['1 asset', '1 video']);
        assert.deepEqual(stageDetails(2, 2), ['2 assets', '2 videos']);
        assert.equal(t('surfaces.channel.cases.message', { people: 1, n: 1, packBadge: '' }), '1 person and things');
        assert.equal(t('surfaces.channel.cases.message', { people: 2, n: 2, packBadge: '' }), '2 people and things');
        setLanguage('ja');
        assert.equal(t('surfaces.home.projectAssets.label', { count: 1, n: 1 }), '素材 1');
        assert.equal(t('surfaces.home.otherProjectCount.label', { count: 2, n: 2 }), '2 本');
        assert.equal(t('surfaces.projects.computeProjectStagesVideos.message', { exportFiles: 1, n: 1 }), '1 本');
        assert.deepEqual(stageDetails(1, 1), ['1 件', '1 本']);
        assert.equal(t('surfaces.channel.cases.message', { people: 1, n: 1, packBadge: '' }), '1 件');
    } finally {
        setLanguage(undefined);
    }
});
