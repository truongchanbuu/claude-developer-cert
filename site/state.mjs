const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(value) && !['constructor', 'prototype'].includes(value);
const textValue = value => typeof value === 'string' && value.trim().length > 0;
const dateValue = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const textList = value => Array.isArray(value) && value.length > 0 && value.every(textValue);
const httpsUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};

export function validateContent(content) {
  const require = (condition, message) => { if (!condition) throw new Error(`Invalid catalogue: ${message}`); };
  const unique = (values, label) => {
    require(Array.isArray(values), `${label} must be a list`);
    const ids = new Set();
    for (const value of values) {
      require(value && validId(value.id) && !ids.has(value.id), `${label} identities`);
      ids.add(value.id);
    }
    return ids;
  };
  require(content?.schemaVersion === 1, 'schema version');
  const { guide, domains, resources, items } = content;
  require(guide && validId(guide.id) && ['title', 'edition'].every(key => textValue(guide[key])) && dateValue(guide.effectiveDate) && dateValue(guide.reviewedAt) && httpsUrl(guide.sourceUrl), 'guide metadata');
  const domainIds = unique(domains, 'domains');
  require(domains.length === 8 && new Set(domains.map(d => d.order)).size === 8, 'eight ordered domains');
  require(domains.every(d => textValue(d.title) && Number.isInteger(d.order) && d.order > 0 && Number.isFinite(d.weight) && d.weight > 0) && Math.abs(domains.reduce((sum, d) => sum + d.weight, 0) - 100) < 0.001, 'domain weights');
  const objectiveIds = unique(guide.objectives, 'objectives');
  require(guide.objectives.length > 0 && guide.objectives.every(o => textValue(o.title) && domainIds.has(o.domainId)), 'objective metadata');
  const resourceIds = unique(resources, 'resources');
  for (const resource of resources) {
    require(['title', 'provider', 'purpose'].every(key => textValue(resource[key])) && httpsUrl(resource.url) && dateValue(resource.checkedAt), 'resource metadata');
    require(['official', 'community'].includes(resource.classification) && ['public', 'free-registration', 'paid', 'restricted', 'unverified'].includes(resource.access) && ['matching', 'different', 'unverified'].includes(resource.compatibility), 'resource labels');
    require(resource.compatibilityNote === undefined || textValue(resource.compatibilityNote), 'compatibility note');
  }
  const itemIds = unique(items, 'items');
  require(items.length > 0, 'empty items');
  const objectives = new Map(guide.objectives.map(o => [o.id, o]));
  for (const item of items) {
    require(['study', 'exercise'].includes(item.kind) && domainIds.has(item.domainId) && ['title', 'contentEdition'].every(key => textValue(item[key])) && dateValue(item.reviewedAt) && Number.isInteger(item.order) && item.order > 0, 'item metadata');
    require(textList(item.objectiveIds) && item.objectiveIds.every(id => objectiveIds.has(id) && objectives.get(id).domainId === item.domainId), 'objective mapping');
    require(textList(item.resourceIds) && item.resourceIds.every(id => resourceIds.has(id)), 'resource mapping');
    require(Array.isArray(item.prerequisiteIds) && item.prerequisiteIds.every(id => itemIds.has(id)), 'prerequisites');
    require(item.nextItemId === undefined || itemIds.has(item.nextItemId), 'next item');
    if (item.kind === 'study') require(textValue(item.whyItMatters) && textList(item.orientation), 'study fields');
    else {
      require(textValue(item.goal) && ['instructions', 'expectedObservations', 'hints', 'solution', 'reasoning'].every(key => textList(item[key])), 'exercise fields');
      if (item.workedExample !== undefined) require(textList(item.workedExample), 'worked example');
      if (item.recallPrompt !== undefined) require(textValue(item.recallPrompt), 'recall prompt');
      const material = item.material;
      require(material && (['code', 'text'].includes(material.kind) ? textValue(material.text) : material.kind === 'fixture' && typeof material.path === 'string' && /^fixtures\/[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(material.path)), 'exercise material');
      if (item.liveExecution !== undefined) require(textValue(item.liveExecution.requirements) && textValue(item.liveExecution.costNotice), 'live execution notices');
    }
  }
  const visited = new Set();
  const active = new Set();
  const byId = new Map(items.map(item => [item.id, item]));
  function visit(id) {
    require(!active.has(id), 'prerequisite cycle');
    if (visited.has(id)) return;
    active.add(id);
    byId.get(id).prerequisiteIds.forEach(visit);
    active.delete(id);
    visited.add(id);
  }
  items.forEach(item => visit(item.id));
  return content;
}

const learnerKey = 'claude-developer-cert:learner-state:v1';
const progressStatuses = ['not-started', 'in-progress', 'complete'];
const noteLimit = 10_000;
const recallIntervals = {help:1,partial:3,independent:7};
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validTimestamp = value => typeof value === 'string' && dateValue(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const validNoteText = value => typeof value === 'string' && value.length > 0 && value.length <= noteLimit * 2 && [...value].length <= noteLimit;
const outcome = (ok, persisted, message = null) => ({ ok, persisted, message });

function emptyLearnerState() {
  return { schemaVersion: 1, updatedAt: null, lastItemId: null, progress: Object.create(null), notes: Object.create(null) };
}

function readProgress(entry) {
  const { status, needsReview, completedEdition, completedAt, updatedAt } = entry;
  if (!progressStatuses.includes(status) || typeof needsReview !== 'boolean' || !validTimestamp(updatedAt)) return null;
  const validCompletion = status === 'complete' ? textValue(completedEdition) && validTimestamp(completedAt) : completedEdition === null && completedAt === null;
  if (!validCompletion) return null;
  const progress = { status, needsReview, completedEdition, completedAt, updatedAt };
  if (entry.recall !== undefined) {
    const recall = entry.recall;
    if (!isRecord(recall) || typeof recall.rating !== 'string' || !Object.hasOwn(recallIntervals,recall.rating) || !validTimestamp(recall.reviewedAt) || !dateValue(recall.nextDueDate) || !textValue(recall.contentEdition) || Object.keys(recall).length !== 4) return progress;
    progress.recall = { rating:recall.rating, reviewedAt:recall.reviewedAt, nextDueDate:recall.nextDueDate, contentEdition:recall.contentEdition };
  }
  return progress;
}

function readNote(entry) {
  const { itemTitle, text, savedAt } = entry;
  if (!textValue(itemTitle) || !validNoteText(text) || !validTimestamp(savedAt)) return null;
  return { itemTitle, text, savedAt };
}

function restoreEntries(source, target, readEntry) {
  if (!isRecord(source)) return false;
  let valid = true;
  for (const [id, entry] of Object.entries(source)) {
    const restored = validId(id) && isRecord(entry) ? readEntry(entry) : null;
    if (restored) target[id] = restored;
    if (!restored || Object.keys(entry).length !== Object.keys(restored).length) valid = false;
  }
  return valid;
}

function restoreLearnerState(raw, state, items) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'Saved study data could not be read.';
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1) return 'Saved study data uses an unsupported format.';
  const progressValid = restoreEntries(parsed.progress, state.progress, readProgress);
  const notesValid = restoreEntries(parsed.notes, state.notes, readNote);
  const resumeValid = parsed.lastItemId === null || validId(parsed.lastItemId);
  const savedAtValid = validTimestamp(parsed.updatedAt);
  if (items.has(parsed.lastItemId)) state.lastItemId = parsed.lastItemId;
  if (savedAtValid) state.updatedAt = parsed.updatedAt;
  for (const [id, progress] of Object.entries(state.progress)) {
    const item = items.get(id);
    if (item && progress.status === 'complete' && progress.completedEdition !== item.contentEdition) progress.needsReview = true;
  }
  if (progressValid && notesValid && resumeValid && savedAtValid && Object.keys(parsed).length === Object.keys(state).length) return null;
  return 'Some saved study data could not be read. Usable entries are shown for this session.';
}

export function getDomainCounts(state, catalogue) {
  const counts = Object.fromEntries(catalogue.domains.map(domain => [domain.id, { completed: 0, total: 0 }]));
  for (const item of catalogue.items) {
    const count = counts[item.domainId];
    const progress = state.progress[item.id];
    count.total++;
    if (progress?.status === 'complete' && progress.completedEdition === item.contentEdition) count.completed++;
  }
  return counts;
}

export function isReviewDue(state, item, today = new Date().toISOString().slice(0,10)) {
  const recall = state.progress[item.id]?.recall;
  return item.kind === 'exercise' && Boolean(recall) && (recall.contentEdition !== item.contentEdition || recall.nextDueDate <= today);
}

export function createSession(getStorage, catalogue) {
  const state = emptyLearnerState();
  const items = new Map(catalogue.items.map(item => [item.id, item]));
  let blockedWrite = null;
  try {
    const raw = getStorage().getItem(learnerKey);
    if (raw !== null) {
      const restoreError = restoreLearnerState(raw, state, items);
      if (restoreError) blockedWrite = `${restoreError} Changes are available in this session only until you reset saved study data.`;
    }
  } catch {
    blockedWrite = 'Browser storage could not be read. Changes are available in this session only. Reload the page or reset saved study data to restore saving.';
  }
  let issue = blockedWrite;

  function save() {
    if (blockedWrite) {
      issue = blockedWrite;
      return outcome(true, false, issue);
    }
    const updatedAt = new Date().toISOString();
    try {
      getStorage().setItem(learnerKey, JSON.stringify({ ...state, updatedAt }));
    } catch {
      issue = 'Saving to browser storage failed. Changes are available in this session only.';
      return outcome(true, false, issue);
    }
    state.updatedAt = updatedAt;
    issue = null;
    return outcome(true, true);
  }

  function reset(confirmed) {
    if (confirmed !== true) return outcome(false, false);
    try {
      getStorage().removeItem(learnerKey);
    } catch {
      issue = 'Browser storage could not be reset. Current study data is still available.';
      return outcome(false, false, issue);
    }
    Object.assign(state, emptyLearnerState());
    blockedWrite = null;
    issue = null;
    return outcome(true, true);
  }

  function setStatus(id, status) {
    const item = items.get(id);
    if (!item || !progressStatuses.includes(status)) return outcome(false, false, 'Choose a valid study item and status.');
    const updatedAt = new Date().toISOString();
    state.progress[id] = {
      ...(state.progress[id]?.recall ? {recall:state.progress[id].recall} : {}),
      status,
      needsReview: state.progress[id]?.needsReview ?? false,
      completedEdition: status === 'complete' ? item.contentEdition : null,
      completedAt: status === 'complete' ? updatedAt : null,
      updatedAt
    };
    return save();
  }

  function setReview(id, needsReview) {
    if (!items.has(id) || typeof needsReview !== 'boolean') return outcome(false, false, 'Choose a valid study item and review flag.');
    state.progress[id] = {
      status: 'not-started', completedEdition: null, completedAt: null,
      ...state.progress[id], needsReview, updatedAt: new Date().toISOString()
    };
    return save();
  }

  function setLastItem(id) {
    if (id !== null && !items.has(id)) return outcome(false, false, 'Choose an active study item.');
    state.lastItemId = id;
    return save();
  }

  function recordRecall(id, rating, at = new Date().toISOString()) {
    const item = items.get(id);
    if (item?.kind !== 'exercise' || typeof rating !== 'string' || !Object.hasOwn(recallIntervals,rating) || !validTimestamp(at)) return outcome(false,false,'Choose an exercise and a valid recall rating.');
    const due = new Date(`${new Date(at).toISOString().slice(0,10)}T00:00:00.000Z`);
    due.setUTCDate(due.getUTCDate()+recallIntervals[rating]);
    state.progress[id] = {
      status:'not-started', needsReview:false, completedEdition:null, completedAt:null,
      ...state.progress[id], updatedAt:at,
      recall:{rating,reviewedAt:at,nextDueDate:due.toISOString().slice(0,10),contentEdition:item.contentEdition}
    };
    return save();
  }

  function saveNote(id, text, confirmedDelete = false) {
    const item = items.get(id);
    const prior = state.notes[id];
    if (!validId(id) || (!item && !prior) || typeof text !== 'string') return outcome(false, false, 'Choose an existing activity or archived note.');
    if (text !== '' && !validNoteText(text)) return outcome(false, false, 'Shorten your note to 10,000 characters before saving.');
    if (text === '') {
      if (prior && confirmedDelete !== true) return outcome(false, false, 'Confirm deletion before clearing this note.');
      delete state.notes[id];
    } else {
      state.notes[id] = { itemTitle: item?.title || prior.itemTitle, text, savedAt: new Date().toISOString() };
    }
    return save();
  }

  return {
    state, get issue() { return issue; }, get persistencePaused() { return blockedWrite !== null; },
    save, reset, setStatus, setReview, setLastItem, saveNote, recordRecall
  };
}
