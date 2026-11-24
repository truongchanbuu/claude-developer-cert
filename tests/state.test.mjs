import assert from 'node:assert/strict';
import test from 'node:test';
import * as learnerState from '../site/state.mjs';

const key = 'claude-developer-cert:learner-state:v1';
const timestamp = '2026-11-23T12:00:00.000Z';
const catalogue = {
  domains: [{ id: 'first' }, { id: 'second' }],
  items: [
    { id: 'study', kind: 'study', domainId: 'first', title: 'Study', contentEdition: '2' },
    { id: 'exercise', kind: 'exercise', domainId: 'first', title: 'Exercise', contentEdition: '1' },
    { id: 'another', kind: 'study', domainId: 'second', title: 'Another', contentEdition: '1' }
  ]
};

function complete(edition) {
  return { status: 'complete', needsReview: false, completedEdition: edition, completedAt: timestamp, updatedAt: timestamp };
}

function savedNote(text = 'Earlier note', itemTitle = 'Earlier title') {
  return { itemTitle, text, savedAt: timestamp };
}

function record(fields = {}) {
  return { schemaVersion: 1, updatedAt: timestamp, lastItemId: null, progress: {}, notes: {}, ...fields };
}

function storageWith(raw) {
  const entries = new Map([['other-project', 'keep']]);
  if (raw !== undefined) entries.set(key, raw);
  return {
    entries,
    getItem(name) { return entries.get(name) ?? null; },
    setItem(name, value) { entries.set(name, value); },
    removeItem(name) { entries.delete(name); }
  };
}

function open(storage = storageWith()) {
  return learnerState.createSession(() => storage, catalogue);
}

function checkTimestamp(value) {
  assert.equal(new Date(value).toISOString(), value);
}

const statuses = ['not-started', 'in-progress', 'complete'];

test('permits all status transitions while keeping the exercise review flag and note independent', () => {
  const note = savedNote();
  const session = open(storageWith(JSON.stringify(record({ notes: { exercise: note } }))));
  assert.equal(session.setReview('exercise', true).persisted, true);
  assert.equal(session.state.progress.exercise.status, 'not-started');
  for (const from of statuses) {
    for (const to of statuses) {
      assert.equal(session.setStatus('exercise', from).ok, true);
      assert.equal(session.setStatus('exercise', to).persisted, true);
      const entry = session.state.progress.exercise;
      assert.equal(entry.status, to);
      assert.equal(entry.needsReview, true);
      assert.equal(entry.completedEdition, to === 'complete' ? '1' : null);
      checkTimestamp(entry.updatedAt);
      if (to === 'complete') checkTimestamp(entry.completedAt);
      else assert.equal(entry.completedAt, null);
      assert.deepEqual(session.state.notes.exercise, note);
    }
  }
  const prior = session.state.progress.exercise;
  assert.equal(session.setReview('exercise', false).persisted, true);
  assert.deepEqual(session.state.progress.exercise, { ...prior, needsReview: false, updatedAt: session.state.progress.exercise.updatedAt });
  assert.equal(session.setStatus('exercise', 'unknown').ok, false);
  assert.equal(session.setReview('exercise', 'true').ok, false);
  assert.equal(session.setStatus('retired', 'complete').ok, false);
});

test('matches editions in domain totals, retains stale completion, and restores only active resume IDs', () => {
  const original = complete('1');
  const storage = storageWith(JSON.stringify(record({
    lastItemId: 'retired', progress: { study: original, exercise: original, retired: original }
  })));
  const session = open(storage);
  assert.equal(session.issue, null);
  assert.equal(session.state.lastItemId, null);
  assert.deepEqual(session.state.progress.study, { ...original, needsReview: true });
  assert.deepEqual(learnerState.getDomainCounts(session.state, catalogue), {
    first: { completed: 1, total: 2 }, second: { completed: 0, total: 1 }
  });
  assert.equal(session.setStatus('study', 'complete').persisted, true);
  assert.equal(session.state.progress.study.completedEdition, '2');
  assert.equal(learnerState.getDomainCounts(session.state, catalogue).first.completed, 2);
  assert.equal(session.setLastItem('retired').ok, false);
  assert.equal(session.setLastItem('study').persisted, true);
  const reopened = open(storage);
  assert.equal(reopened.state.lastItemId, 'study');
  assert.equal(reopened.state.progress.study.needsReview, true);
  checkTimestamp(reopened.state.updatedAt);
});

test('uses the versioned key and the last successful full-state write wins across sessions', () => {
  const storage = storageWith();
  const first = open(storage);
  const second = open(storage);
  assert.equal(first.state.updatedAt, null);
  assert.equal(first.setStatus('study', 'complete').persisted, true);
  assert.equal(second.setReview('exercise', true).persisted, true);
  const persisted = JSON.parse(storage.getItem(key));
  assert.equal(persisted.schemaVersion, 1);
  assert.deepEqual(Object.keys(persisted.progress), ['exercise']);
  assert.deepEqual(Object.keys(persisted.notes), []);
  checkTimestamp(persisted.updatedAt);
  assert.equal(open(storage).state.progress.exercise.needsReview, true);
  assert.equal(storage.getItem('other-project'), 'keep');
});

for (const [name, raw] of [
  ['malformed JSON', '{ unreadable'],
  ['unsupported schema', JSON.stringify(record({ schemaVersion: 2 }))],
  ['invalid top-level values', JSON.stringify(record({ updatedAt: '2026-02-30T00:00:00.000Z', lastItemId: true }))]
]) {
  test(`keeps ${name} raw until a confirmed reset`, () => {
    const storage = storageWith(raw);
    const session = open(storage);
    assert.equal(session.persistencePaused, true);
    assert.ok(session.issue);
    const change = session.setStatus('study', 'in-progress');
    assert.equal(change.ok, true);
    assert.equal(change.persisted, false);
    assert.ok(change.message);
    assert.equal(session.state.progress.study.status, 'in-progress');
    assert.equal(storage.getItem(key), raw);
    assert.equal(session.reset(false).ok, false);
    assert.equal(storage.getItem(key), raw);
    assert.equal(session.reset(true).persisted, true);
    assert.equal(session.persistencePaused, false);
    assert.equal(session.issue, null);
    assert.deepEqual(Object.keys(session.state.progress), []);
    assert.equal(storage.getItem(key), null);
    assert.equal(storage.getItem('other-project'), 'keep');
    assert.equal(session.setLastItem('study').persisted, true);
  });
}

test('salvages valid progress and archived notes from partially invalid records', () => {
  const retired = savedNote();
  const raw = JSON.stringify(record({
    progress: {
      exercise: complete('1'),
      study: { ...complete('2'), completedAt: null },
      another: { ...complete('1'), status: 'in-progress' }
    },
    notes: { retired, exercise: { ...savedNote(), savedAt: 'invalid' }, ['__proto__']: savedNote() }
  }));
  const storage = storageWith(raw);
  const session = open(storage);
  assert.equal(session.persistencePaused, true);
  assert.deepEqual(Object.keys(session.state.progress), ['exercise']);
  assert.deepEqual(Object.keys(session.state.notes), ['retired']);
  assert.deepEqual(session.state.notes.retired, retired);
  assert.equal(session.save().persisted, false);
  assert.equal(storage.getItem(key), raw);
});

test('keeps updates usable if storage access or the initial read throws', () => {
  const blockedAccess = learnerState.createSession(() => { throw Error('blocked'); }, catalogue);
  assert.ok(blockedAccess.issue);
  assert.equal(blockedAccess.setStatus('study', 'in-progress').persisted, false);
  assert.equal(blockedAccess.state.progress.study.status, 'in-progress');

  const raw = JSON.stringify(record({ lastItemId: 'exercise' }));
  const storage = storageWith(raw);
  const blockedRead = open({ ...storage, getItem() { throw Error('read blocked'); } });
  assert.ok(blockedRead.issue);
  assert.equal(blockedRead.setReview('study', true).persisted, false);
  assert.equal(blockedRead.state.progress.study.needsReview, true);
  assert.equal(storage.getItem(key), raw);
});

test('preserves prior raw data and the last successful save time on write and reset errors', () => {
  const note = savedNote();
  const raw = JSON.stringify(record({ lastItemId: 'exercise', notes: { exercise: note } }));
  const storage = storageWith(raw);
  let full = true;
  const session = open({
    ...storage,
    setItem(name, value) {
      if (full) throw Error('quota');
      storage.setItem(name, value);
    },
    removeItem() { throw Error('denied'); }
  });
  const change = session.setStatus('study', 'complete');
  assert.equal(change.ok, true);
  assert.equal(change.persisted, false);
  assert.ok(change.message);
  assert.equal(session.state.updatedAt, timestamp);
  assert.equal(session.reset(true).ok, false);
  assert.equal(session.state.progress.study.status, 'complete');
  assert.equal(session.state.lastItemId, 'exercise');
  assert.deepEqual(session.state.notes.exercise, note);
  assert.equal(storage.getItem(key), raw);
  assert.equal(storage.getItem('other-project'), 'keep');
  full = false;
  assert.equal(session.save().persisted, true);
  assert.equal(session.issue, null);
  assert.equal(open(storage).state.progress.study.status, 'complete');
});

test('confirmed reset removes saved progress, notes, and resume without clearing other keys', () => {
  const storage = storageWith(JSON.stringify(record({
    lastItemId: 'exercise', progress: { exercise: complete('1') }, notes: { exercise: savedNote() }
  })));
  const session = open(storage);
  assert.equal(session.reset(true).persisted, true);
  assert.equal(session.state.lastItemId, null);
  assert.equal(session.state.updatedAt, null);
  assert.deepEqual(Object.keys(session.state.progress), []);
  assert.deepEqual(Object.keys(session.state.notes), []);
  assert.equal(storage.getItem(key), null);
  assert.equal(storage.getItem('other-project'), 'keep');
});

test('notes accept 10,000 Unicode code points and reject 10,001 without replacing saved text', () => {
  const storage = storageWith();
  const session = open(storage);
  const text = '😀'.repeat(10000);
  assert.equal(session.saveNote('study',text).persisted,true);
  const raw = storage.getItem(key);
  assert.equal(session.saveNote('study',text+'x').ok,false);
  assert.equal(storage.getItem(key),raw);
  assert.equal(session.state.notes.study.text,text);
  assert.equal(open(storage).state.notes.study.text,text);
});

test('saving a note affects only that item and treats markup as literal text', () => {
  const storage = storageWith(JSON.stringify(record({notes:{exercise:savedNote()},progress:{study:complete('2')}})));
  const session = open(storage);
  const text = '<img src=x onerror=alert(1)> & <script>run()</script>';
  assert.equal(session.saveNote('study',text).persisted,true);
  assert.equal(session.state.notes.study.text,text);
  assert.equal(session.state.notes.study.itemTitle,'Study');
  assert.deepEqual(session.state.progress.study,complete('2'));
  assert.deepEqual(session.state.notes.exercise,savedNote());
  assert.equal(open(storage).state.notes.study.text,text);
  checkTimestamp(session.state.notes.study.savedAt);
});

test('empty-save deletion requires confirmation and preserves other notes and progress', () => {
  const session = open(storageWith(JSON.stringify(record({notes:{study:savedNote(),exercise:savedNote()},progress:{study:complete('2')}}))));
  assert.equal(session.saveNote('study','').ok,false);
  assert.equal(session.state.notes.study.text,'Earlier note');
  assert.equal(session.saveNote('study','',true).persisted,true);
  assert.equal(session.state.notes.study,undefined);
  assert.deepEqual(session.state.notes.exercise,savedNote());
  assert.deepEqual(session.state.progress.study,complete('2'));
});

test('retired notes stay editable and titled but unknown new item IDs cannot create notes', () => {
  const session = open(storageWith(JSON.stringify(record({notes:{retired:savedNote('Old thoughts','Old title')}}))));
  assert.equal(session.saveNote('retired','New thoughts').persisted,true);
  assert.equal(session.state.notes.retired.itemTitle,'Old title');
  assert.equal(session.state.notes.retired.text,'New thoughts');
  assert.equal(session.saveNote('unknown','Cannot attach').ok,false);
  assert.equal(session.saveNote('__proto__','Cannot attach').ok,false);
  assert.equal(learnerState.getDomainCounts(session.state,catalogue).first.total,2);
  assert.equal(session.saveNote('retired','',true).persisted,true);
});

test('failed note writes preserve stored text while retaining session changes for recovery', () => {
  const prior = JSON.stringify(record({notes:{study:savedNote()}}));
  const storage = storageWith(prior);
  const session = open({...storage,setItem(){throw Error('quota');}});
  const result = session.saveNote('study','Unsaved session text');
  assert.equal(result.ok,true);
  assert.equal(result.persisted,false);
  assert.ok(result.message);
  assert.equal(storage.getItem(key),prior);
  assert.equal(session.state.notes.study.text,'Unsaved session text');
});

for (const [rating,days,expectedDue] of [['help',1,'2026-12-31'],['partial',3,'2027-01-02'],['independent',7,'2027-01-06']]) {
  test(`recall ${rating} schedules a UTC return in ${days} days without claiming completion`, () => {
    const storage = storageWith(JSON.stringify(record({notes:{exercise:savedNote()}})));
    const session = open(storage);
    assert.equal(session.recordRecall('exercise',rating,'2026-12-30T23:59:00.000Z').persisted,true);
    const entry = session.state.progress.exercise;
    assert.equal(entry.status,'not-started');
    assert.equal(entry.needsReview,false);
    assert.equal(entry.recall.rating,rating);
    assert.equal(entry.recall.contentEdition,'1');
    assert.equal(entry.recall.nextDueDate,expectedDue);
    assert.deepEqual(session.state.notes.exercise,savedNote());
    const reopened = open(storage);
    assert.equal(reopened.persistencePaused,false);
    assert.deepEqual(reopened.state.progress.exercise.recall,entry.recall);
    assert.equal(learnerState.isReviewDue(reopened.state,catalogue.items[1],entry.recall.nextDueDate),true);
    assert.equal(learnerState.isReviewDue(reopened.state,catalogue.items[1],'2026-12-30'),false);
  });
}

test('recall scheduling preserves existing progress and survives status/review edits', () => {
  const session = open(storageWith(JSON.stringify(record({progress:{exercise:complete('1')}}))));
  session.recordRecall('exercise','independent','2026-11-24T12:00:00.000Z');
  const recall = {...session.state.progress.exercise.recall};
  assert.equal(session.state.progress.exercise.status,'complete');
  session.setStatus('exercise','in-progress');
  session.setReview('exercise',true);
  assert.deepEqual(session.state.progress.exercise.recall,recall);
  assert.equal(learnerState.isReviewDue(session.state,{...catalogue.items[1],contentEdition:'new'},'2026-11-24'),true);
  assert.equal(learnerState.isReviewDue(session.state,catalogue.items[0],'2027-01-01'),false);
});

test('invalid or failed recall updates cannot erase older notes or stored progress', () => {
  const raw = JSON.stringify(record({notes:{exercise:savedNote()}}));
  const storage = storageWith(raw);
  const session = open({...storage,setItem(){throw Error('full');}});
  for (const args of [['study','help',timestamp],['exercise','invented',timestamp],['exercise','help','invalid']]) {
    assert.equal(session.recordRecall(...args).ok,false);
    assert.equal(storage.getItem(key),raw);
  }
  assert.equal(session.recordRecall('exercise','help',timestamp).persisted,false);
  assert.ok(session.state.progress.exercise.recall);
  assert.equal(storage.getItem(key),raw);
});

test('old saved state remains writable and corrupt recall data pauses persistence without deleting valid notes', () => {
  const old = open(storageWith(JSON.stringify(record({progress:{exercise:complete('1')},notes:{exercise:savedNote()}}))));
  assert.equal(old.persistencePaused,false);
  assert.equal(old.save().persisted,true);
  const storage = storageWith(JSON.stringify(record({progress:{exercise:{...complete('1'),recall:{rating:'independent',reviewedAt:timestamp,nextDueDate:'not-a-date',contentEdition:'1'}}},notes:{exercise:savedNote()}})));
  const raw = storage.getItem(key);
  const session = open(storage);
  assert.equal(session.persistencePaused,true);
  assert.equal(session.state.notes.exercise.text,'Earlier note');
  assert.equal(session.state.progress.exercise.status,'complete');
  assert.equal(session.save().persisted,false);
  assert.equal(storage.getItem(key),raw);
});

test('recall rating boundaries reject array-like enum values rather than coercing them', () => {
  const session = open();
  assert.equal(session.recordRecall('exercise',['help'],timestamp).ok,false);
  const raw = JSON.stringify(record({progress:{exercise:{...complete('1'),recall:{rating:['help'],reviewedAt:timestamp,nextDueDate:'2026-11-24',contentEdition:'1'}}}}));
  const restored = open(storageWith(raw));
  assert.equal(restored.persistencePaused,true);
  assert.equal(restored.state.progress.exercise.recall,undefined);
  assert.equal(restored.state.progress.exercise.status,'complete');
});
