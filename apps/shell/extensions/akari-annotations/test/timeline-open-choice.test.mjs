import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('contribution.ts', readFileSync(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsContribution');
const method = owner?.members.find(node => node.name?.getText(source) === 'openOrCreateTimeline');
assert.ok(method);
const findMethod = owner.members.find(node => node.name?.getText(source) === 'findProjectLocation');
assert.ok(findMethod);
const code = ts.transpileModule('class Harness { ' + method.getText(source) + findMethod.getText(source) + ' }', { compilerOptions: { target: ts.ScriptTarget.ES2021 } }).outputText;
const Harness = new Function('sameProjectFile', 'timelineDisplayName', code + '\nreturn Harness;')((a, b) => a === b, slug => slug || 'タイムライン');
const location = (name, slug) => ({ slug, displayName: slug || 'タイムライン', editUri: { toString: () => 'file:///' + name, path: { base: name } } });

function setup(openNames = ['edit.json']) {
    const harness = new Harness();
    const base = location('edit.json');
    const v20 = location('edit.v20.json', 'v20');
    harness.locateAll = async () => [base, v20];
    harness.findTimelineWidget = item => openNames.includes(item.editUri.path.base) ? { isAttached: true } : undefined;
    harness.timelineHidden = false;
    harness.attachAt = async item => ({ id: item.editUri.path.base, timelineLocation: item });
    harness.review = {};
    const activated = [];
    harness.shell = { activateWidget: async id => { activated.push(id); } };
    let choices;
    harness.quickInputService = { pick: async items => { choices = items; return items.find(item => item.id === 'file:///edit.v20.json'); } };
    let created = 0;
    harness.createTimeline = async () => { created++; return location('edit.new.json', 'new'); };
    return { harness, activated, choices: () => choices, created: () => created };
}

test('plus offers closed timelines and a new timeline, then opens the selected variant', async () => {
    const fixture = setup();
    const widget = await fixture.harness.openOrCreateTimeline();
    assert.deepEqual(fixture.choices().map(item => [item.label, item.description]), [
        ['v20', 'edit.v20.json'], ['新しいタイムライン', undefined]
    ]);
    assert.equal(widget.id, 'edit.v20.json');
    assert.deepEqual(fixture.activated, ['edit.v20.json']);
    assert.equal(fixture.created(), 0);
});

test('explicit edit URI opens that timeline without showing choices', async () => {
    const fixture = setup();
    const widget = await fixture.harness.openOrCreateTimeline('file:///edit.v20.json');
    assert.equal(widget.id, 'edit.v20.json');
    assert.equal(fixture.choices(), undefined);
});

test('plus uses creation dialog directly when no timeline is closed', async () => {
    const fixture = setup(['edit.json', 'edit.v20.json']);
    const widget = await fixture.harness.openOrCreateTimeline();
    assert.equal(widget.id, 'edit.new.json');
    assert.equal(fixture.choices(), undefined);
    assert.equal(fixture.created(), 1);
});
test('plus reopens an unattached location without edit URI without showing choices', async () => {
    const fixture = setup();
    const empty = { editUri: undefined, displayName: 'タイムライン' };
    fixture.harness.locateAll = async () => [empty];
    fixture.harness.findTimelineWidget = () => undefined;
    fixture.harness.attachAt = async item => ({ id: 'empty', timelineLocation: item });
    const widget = await fixture.harness.openOrCreateTimeline();
    assert.equal(widget.id, 'empty');
    assert.equal(widget.timelineLocation, empty);
    assert.equal(fixture.choices(), undefined);
    assert.equal(fixture.created(), 0);
});

test('explicit edit URI refreshes a stale location cache before opening', async () => {
    const fixture = setup();
    const base = location('edit.json');
    const v20 = location('edit.v20.json', 'v20');
    let resolves = 0;
    fixture.harness.locateAll = async function () {
        if (!this.projectLocationsPromise) {
            resolves++;
            this.projectLocationsPromise = Promise.resolve(resolves === 1 ? [base] : [base, v20]);
        }
        return this.projectLocationsPromise;
    };
    const widget = await fixture.harness.openOrCreateTimeline('file:///edit.v20.json');
    assert.equal(widget.id, 'edit.v20.json');
    assert.equal(resolves, 2);
    assert.equal(fixture.choices(), undefined);
});
