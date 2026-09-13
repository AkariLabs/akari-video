import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const text = readFileSync(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url), 'utf8');
const source = ts.createSourceFile('akari-annotations-contribution.ts', text, ts.ScriptTarget.Latest, true);

const contributionClass = source.statements.find(node =>
  ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsContribution');
assert.ok(contributionClass, 'AkariAnnotationsContribution class');
const watchMethod = contributionClass.members.find(node =>
  ts.isMethodDeclaration(node) && node.name.getText(source) === 'watchForReview');
assert.ok(watchMethod?.body, 'watchForReview method');

const callsNamed = (root, name) => {
  const calls = [];
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === name) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(root);
  return calls;
};

test('watchForReview owns exactly one file-change subscription', () => {
  assert.equal(callsNamed(watchMethod, 'this.fileService.onDidFilesChange').length, 1);
  assert.equal(callsNamed(source, 'this.fileService.onDidFilesChange').length, 2,
    'the existing edit-cache subscription plus review subscription');
});

test('watchForReview gates review events through the pure root helper and coalescer', () => {
  assert.equal(callsNamed(watchMethod, 'shouldOpenReviewPanelFor').length, 1);
  assert.equal(callsNamed(watchMethod, 'coalesceReviewOpens').length, 1);
  assert.equal(callsNamed(watchMethod, 'scheduleReviewOpen').length, 1);
  assert.equal(callsNamed(watchMethod, 'this.openReviewPanel').length, 1);
});
