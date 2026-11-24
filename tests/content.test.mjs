import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContent } from '../site/state.mjs';

function catalogue() {
  return {
    schemaVersion: 1,
    guide: { id: 'guide', title: 'Guide', edition: '1', effectiveDate: '2026-12-07', reviewedAt: '2026-11-23', sourceUrl: 'https://example.com/guide', objectives: [{ id: '1.1', domainId: 'd1', title: 'Objective' }] },
    domains: Array.from({ length: 8 }, (_, i) => ({ id: `d${i+1}`, title: `Domain ${i+1}`, order: i+1, weight: i === 7 ? 16 : 12 })),
    resources: [{ id: 'r1', title: 'Reference', provider: 'Official', url: 'https://example.com/', classification: 'official', access: 'public', purpose: 'Learn', checkedAt: '2026-11-23', compatibility: 'matching' }],
    items: [{ id: 'study-one', kind: 'study', title: 'Study', domainId: 'd1', objectiveIds: ['1.1'], prerequisiteIds: [], order: 1, contentEdition: '1', reviewedAt: '2026-11-23', resourceIds: ['r1'], whyItMatters: 'Understand this.', orientation: ['Start here.'] }]
  };
}

test('accepts a valid catalogue without DOM or network access', () => assert.equal(validateContent(catalogue()).items.length, 1));
for (const [name, change] of [
  ['schema', c => c.schemaVersion = 2],
  ['guide date', c => c.guide.effectiveDate = '2026-02-31'],
  ['guide protocol', c => c.guide.sourceUrl = 'javascript:alert(1)'],
  ['duplicate domain', c => c.domains[1].id = 'd1'],
  ['domain count', c => c.domains.pop()],
  ['duplicate domain order', c => c.domains[1].order = 1],
  ['weights', c => c.domains[0].weight = 1],
  ['resource protocol', c => c.resources[0].url = 'data:text/html,hi'],
  ['access category', c => c.resources[0].access = 'anything'],
  ['duplicate resource', c => c.resources.push(c.resources[0])],
  ['wrong objective domain', c => c.guide.objectives[0].domainId = 'missing'],
  ['unknown objective', c => c.items[0].objectiveIds = ['missing']],
  ['unknown domain', c => c.items[0].domainId = 'missing'],
  ['empty objective mapping', c => c.items[0].objectiveIds = []],
  ['unknown resource', c => c.items[0].resourceIds = ['missing']],
  ['unknown prerequisite', c => c.items[0].prerequisiteIds = ['missing']],
  ['self prerequisite', c => c.items[0].prerequisiteIds = ['study-one']],
  ['unknown next step', c => c.items[0].nextItemId = 'missing'],
  ['missing rationale', c => delete c.items[0].whyItMatters],
  ['empty orientation', c => c.items[0].orientation = []],
  ['duplicate item', c => c.items.push(c.items[0])],
  ['unsafe identity', c => c.items[0].id = '__proto__']
]) test(`rejects invalid ${name}`, () => { const c = catalogue(); change(c); assert.throws(() => validateContent(c)); });

test('rejects cycles across prerequisite chains', () => {
  const c = catalogue();
  c.items.push({ ...c.items[0], id: 'second', order: 2, prerequisiteIds: ['study-one'] });
  c.items[0].prerequisiteIds = ['second'];
  assert.throws(() => validateContent(c));
});

test('exercise material must remain text or safe site-relative fixture paths', () => {
  const c = catalogue();
  c.items[0] = { ...c.items[0], kind: 'exercise', goal: 'Practice', instructions: ['Try'], expectedObservations: ['Observe'], hints: ['Hint'], solution: ['Solution'], reasoning: ['Reason'], material: { kind: 'code', text: 'example()' } };
  assert.doesNotThrow(() => validateContent(c));
  for (const path of ['../secret', '/absolute', 'https://evil.test/a', 'fixtures/%2e%2e/secret', 'fixtures/../../secret', 'fixtures\\secret']) {
    c.items[0].material = { kind: 'fixture', path };
    assert.throws(() => validateContent(c), path);
  }
});

import { readFile } from 'node:fs/promises';
test('published roadmap covers eight domains with checked public sources and complete study items', async () => {
  const c = validateContent(JSON.parse(await readFile(new URL('../site/content.json', import.meta.url), 'utf8')));
  for (const domain of c.domains) {
    const studies = c.items.filter(i => i.domainId === domain.id && i.kind === 'study');
    assert.ok(studies.length >= 1, domain.id);
    assert.ok(studies.some(i => i.resourceIds.some(id => c.resources.some(r => r.id === id && r.classification === 'official' && r.access === 'public'))), domain.id);
  }
});

test('every domain has an original supplied-material exercise with explained solution', async () => {
  const c = validateContent(JSON.parse(await readFile(new URL('../site/content.json', import.meta.url), 'utf8')));
  for (const domain of c.domains) {
    const exercises = c.items.filter(i => i.domainId === domain.id && i.kind === 'exercise');
    assert.ok(exercises.length >= 1, domain.id);
    for (const exercise of exercises) assert.ok(['code','text'].includes(exercise.material.kind));
  }
});

test('each published exercise supports a worked example and recall with explanation', async () => {
  const c = validateContent(JSON.parse(await readFile(new URL('../site/content.json', import.meta.url), 'utf8')));
  for (const exercise of c.items.filter(i => i.kind === 'exercise')) {
    assert.ok(Array.isArray(exercise.workedExample) && exercise.workedExample.length >= 2,exercise.id);
    assert.ok(exercise.workedExample.every(p => typeof p === 'string' && p.trim()),exercise.id);
    assert.ok(typeof exercise.recallPrompt === 'string' && exercise.recallPrompt.trim(),exercise.id);
  }
});
