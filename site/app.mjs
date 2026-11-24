import { validateContent, createSession, getDomainCounts, isReviewDue } from './state.mjs';

const main = document.querySelector('main');
const feedback = document.querySelector('#feedback');
let catalogue;
let session;
let editor = null;
let editingNoteId = null;
let currentHash = location.hash || '#home';
let currentIndex = Number.isInteger(history.state?.studyIndex) ? history.state.studyIndex : 0;
let restoring = null;
let allowHistory = false;
let navigating = false;

function announce(result, success) {
  feedback.textContent = result.persisted ? success : result.message || 'Changes are available in this session only, unsaved for future visits.';
}
function choose(title, description, choices) {
  const dialog = document.querySelector('#decision');
  const previousFocus = document.activeElement;
  document.querySelector('#decision-title').textContent = title;
  document.querySelector('#decision-description').textContent = description;
  const actions = document.querySelector('#decision-actions');
  actions.replaceChildren();
  return new Promise(resolve => {
    function finish(value) {
      dialog.close();
      previousFocus?.focus();
      resolve(value);
    }
    for (const [value, label] of choices) {
      const button = el('button', label);
      button.type = 'button';
      if (value === 'cancel') button.className = 'secondary';
      button.onclick = () => finish(value);
      actions.append(button);
    }
    dialog.oncancel = event => { event.preventDefault(); finish('cancel'); };
    dialog.showModal();
    actions.lastElementChild.focus();
  });
}
function isDirty() { return editor !== null && (editor.forcedDirty || editor.input.value !== editor.baseline); }
function updateUnloadGuard() {
  removeEventListener('beforeunload', warnBeforeUnload);
  if (isDirty()) addEventListener('beforeunload', warnBeforeUnload);
}
function warnBeforeUnload(event) { event.preventDefault(); event.returnValue = ''; }
async function permitNavigation() {
  if (!isDirty()) return true;
  const choice = await choose('Keep your note changes?', 'Save them in this browser, discard this draft, or stay here to keep editing.', [['save','Save and continue'],['discard','Discard changes'],['cancel','Keep editing']]);
  if (choice === 'cancel') return false;
  if (choice === 'save') return saveEditor();
  editor.input.value = editor.baseline;
  editor.forcedDirty = false;
  updateUnloadGuard();
  return true;
}
async function navigateTo(hash) {
  if (navigating) return;
  navigating = true;
  try {
    if (!(await permitNavigation())) return;
    currentIndex++;
    currentHash = hash;
    history.pushState({studyIndex:currentIndex},'',hash);
    renderRoute();
  } finally { navigating = false; }
}


function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function link(text, href, external = false) {
  const node = el('a', text);
  node.href = href;
  if (external) { node.target = '_blank'; node.rel = 'noopener noreferrer'; node.append(el('span', ' ↗ (new tab)', 'muted')); }
  return node;
}
function section(title, paragraphs, parent) {
  const node = el('section');
  node.append(el('h2', title));
  for (const text of paragraphs) node.append(el('p', text));
  parent.append(node);
  return node;
}
function itemsFor(domain) { return catalogue.items.filter(item => item.domainId === domain.id).sort((a,b) => a.order-b.order); }
function itemLink(item) { return link(item.title, `#item/${item.id}`); }
function resources(item, parent) {
  const block = section('Where to learn', [], parent);
  for (const id of item.resourceIds) {
    const resource = catalogue.resources.find(r => r.id === id);
    const row = el('article', undefined, 'resource');
    row.append(link(resource.title, resource.url, true), el('p', resource.purpose));
    row.append(el('p', `${resource.provider} · ${resource.classification === 'official' ? 'Official source' : 'Community resource'} · Access: ${resource.access.replaceAll('-', ' ')} · Edition: ${resource.compatibility} · Checked ${resource.checkedAt}`, 'metadata'));
    if (resource.compatibilityNote) row.append(el('p', resource.compatibilityNote, 'metadata'));
    block.append(row);
  }
}
function renderHome() {
  const hero = el('section', undefined, 'hero');
  const copy = el('div');
  copy.append(el('p', 'A little structure. A steady practice.', 'eyebrow'), el('h1', 'Build understanding,\none session at a time.'));
  copy.append(el('p', 'Your personal path to Claude Developer Foundations. Follow trusted resources, practice real decisions, and keep track of what you learn.', 'lead'));
  copy.append(el('p', 'For developers who have used Claude Code or Codex and are new to formal certification study.', 'muted'));
  const actions = el('div', undefined, 'actions');
  const first = [...catalogue.items].filter(i => i.kind === 'study').sort((a,b) => a.order-b.order)[0];
  const start = itemLink(first); start.textContent = 'Start studying →'; start.className = 'button'; actions.append(start);
  if (session?.state.lastItemId) {
    const resumeItem = catalogue.items.find(i => i.id === session.state.lastItemId);
    if (resumeItem) { const resume = itemLink(resumeItem); resume.textContent = 'Resume last activity'; resume.className = 'button secondary'; actions.append(resume); }
  }
  copy.append(actions);
  const note = el('div', undefined, 'hero-note');
  note.append(el('p', 'YOUR STUDY SPACE', 'eyebrow'), el('span', '08', 'big-number'), el('p', 'domains, one connected roadmap'), el('p', 'Learn elsewhere. Practice here. Make it your own.', 'muted'));
  const dueCount = catalogue.items.filter(item => isReviewDue(session.state,item)).length;
  const reviewLink = link(dueCount ? `${dueCount} exercise${dueCount === 1 ? '' : 's'} due for recall →` : 'Open your review plan →','#review');
  note.append(reviewLink);
  hero.append(copy,note); main.append(hero);
  const methods = el('details');
  methods.append(el('summary','A small learning cycle: example → recall → feedback → return'));
  methods.append(el('p','New to a topic? Explain a worked example first, then close it and attempt the related exercise from memory. Compare your reasoning with the solution, note one correction, and choose when to return. On later visits, try recalling before reopening your notes.'));
  methods.append(link('Learning methods and research','./learning-methods.html'));
  main.append(methods);
  const guide = catalogue.guide;
  const upcoming = guide.effectiveDate > new Date().toISOString().slice(0,10);
  const notice = el('div', undefined, 'notice');
  notice.append(el('p', guide.title), el('strong', `${upcoming ? 'Upcoming' : 'Selected'} exam guide · ${guide.edition} · Effective ${guide.effectiveDate}`), el('p', `Roadmap reviewed ${guide.reviewedAt}. Resources may follow a different edition; check their labels. Study progress is not an official exam score.`), link('Read the official guide', guide.sourceUrl, true));
  main.append(notice);
  const heading = el('div', undefined, 'section-heading');
  heading.append(el('h2', 'Your roadmap'), el('p', 'Explore freely. Return whenever you need.', 'muted')); main.append(heading);
  const intro = el('details');
  intro.append(el('summary', 'New to formal study? Start with these distinctions.'));
  intro.append(el('p', 'Claude Code and Codex are coding assistants: their applications supply tools, permissions, and a working loop. Building with the Claude API means your application takes responsibility for requests, tool execution, failure handling, and evaluating outcomes. Familiarity with an assistant helps, but these are additional skills.'));
  intro.append(el('p', 'A token is a unit of model input or output. The context window is the limited amount of information available for a response. An agent combines model decisions with tools in a loop; a workflow uses a predefined sequence. MCP is a protocol for connecting applications to tools and context. The roadmap links the details as you need them.'));
  intro.append(el('p', 'Learning here does not establish eligibility to register for the certification. Check current official registration rules first.'));
  for (const id of ['partner-certifications', 'partner-certification-faq', 'pearson-program']) {
    const r = catalogue.resources.find(resource => resource.id === id);
    if (r) { const p = el('p'); p.append(link(r.title,r.url,true), el('span', ` · Access: ${r.access} · Checked ${r.checkedAt}`, 'metadata')); intro.append(p); }
  }
  main.append(intro);
  const grid = el('div', undefined, 'domain-grid');
  for (const domain of [...catalogue.domains].sort((a,b) => a.order-b.order)) {
    const card = el('section', undefined, 'card');
    const top = el('div', undefined, 'card-top');
    top.append(el('span', String(domain.order).padStart(2,'0'), 'domain-number'), el('span', `${domain.weight}% of blueprint`, 'badge'));
    card.append(top, el('h3', domain.title));
    const list = el('ul', undefined, 'item-list');
    for (const item of itemsFor(domain)) {
      const row = el('li'); row.append(el('span', item.kind === 'exercise' ? 'Practice · original exercise' : 'Learn · curated resources', 'item-kind'), itemLink(item)); list.append(row);
    }
    card.append(list);
    if (session) {
      const counts = getDomainCounts(session.state,catalogue)[domain.id];
      card.append(el('p', `${counts.completed} / ${counts.total} activities complete`, 'metadata'));
      const progress = el('progress'); progress.max = counts.total; progress.value = counts.completed; progress.setAttribute('aria-label',`${domain.title}: ${counts.completed} of ${counts.total} complete`); card.append(progress);
    }
    grid.append(card);
  }
  main.append(grid);
}
function renderItem(item) {
  main.append(link('← Your roadmap', '#home'));
  const domain = catalogue.domains.find(d => d.id === item.domainId);
  main.append(el('p', `${domain.title} / ${item.kind === 'study' ? 'Learn' : 'Practice'}`, 'eyebrow'), el('h1', item.title));
  const layout = el('div', undefined, 'item-layout');
  const body = el('article', undefined, 'item-body');
  body.append(el('p', `Content ${item.contentEdition} · Reviewed ${item.reviewedAt}`, 'metadata'));
  const objectives = item.objectiveIds.map(id => catalogue.guide.objectives.find(o => o.id === id));
  section('What you’ll work on', objectives.map(o => `${o.id} · ${o.title}`), body);
  if (catalogue.guide.objectiveIdNote) body.append(el('p', catalogue.guide.objectiveIdNote, 'muted'));
  const prereq = section('Before you start', [], body);
  if (!item.prerequisiteIds.length) prereq.append(el('p', 'No earlier study activity required. Familiarity with code, JSON, and command-line tools will help.'));
  for (const id of item.prerequisiteIds) { const p = el('p'); p.append(itemLink(catalogue.items.find(i => i.id === id))); prereq.append(p); }
  if (item.kind === 'study') {
    section('Why it matters', [item.whyItMatters], body);
    section('Get oriented', item.orientation, body);
  } else {
    section('Your goal', [item.goal], body);
    const practice = el('details'); practice.className = 'practice-cues';
    practice.open = !session?.state.progress[item.id]?.recall;
    practice.append(el('summary','Practice case and instructions — close before recall'));
    body.append(practice);
    if (item.workedExample) {
      const example = el('details'); example.className = 'worked-example';
      example.append(el('summary','New to this topic? Study a different worked example'));
      item.workedExample.forEach(text => example.append(el('p',text)));
      example.append(el('p','Explain why the key step works, then close this example before trying the exercise.','muted'));
      practice.append(example);
    }
    const material = section('Supplied practice material', [], practice);
    if (item.material.kind === 'fixture') material.append(link('Open practice fixture', item.material.path));
    else if (item.material.kind === 'code') { const pre = el('pre'); pre.append(el('code', item.material.text)); material.append(pre); }
    else material.append(el('p', item.material.text, 'note-text'));
    const steps = section('Try it yourself', [], practice);
    const ol = el('ol'); item.instructions.forEach(text => ol.append(el('li', text))); steps.append(ol);
    const recall = section('Recall and explain',[item.recallPrompt || 'Explain your answer and why the strongest alternative would fail.','Close the example, resources, and earlier notes. Try explaining the answer aloud or in your own words before revealing feedback. A supported first attempt is fine when the topic is unfamiliar.'],body);
    if (session) {
      if (session.state.notes[item.id]) {
        const previous = el('details'); previous.append(el('summary','Your earlier note — open after attempting recall'));
        noteEditor(item.id,item.title,previous); recall.append(previous);
      } else noteEditor(item.id,item.title,recall);
    }
    const hint = el('details'); hint.append(el('summary','Reveal a hint')); item.hints.forEach(text => hint.append(el('p',text))); body.append(hint);
    const solution = el('details'); solution.className = 'reference-solution';
    solution.append(el('summary','Compare with a reference solution'));
    section('What to look for', item.expectedObservations, solution);
    [...item.solution,...item.reasoning].forEach(text => solution.append(el('p',text)));
    solution.append(el('p','What did you get right? Explain one mismatch and the reason for the correction. Record it in your note if useful.','muted'));
    body.append(solution);
    if (session) recallRating(item,body,solution);
    if (item.liveExecution) section('Optional live execution', [item.liveExecution.requirements,item.liveExecution.costNotice],body);
    body.append(el('p', 'Self-assessed practice. There is no automatic grading or exam pass prediction.', 'muted'));
  }
  resources(item,body);
  const next = el('div', undefined, 'actions'); next.append(item.nextItemId ? itemLink(catalogue.items.find(i => i.id === item.nextItemId)) : link('Return to roadmap →','#home')); body.append(next);
  layout.append(body);
  if (session) layout.append(progressPanel(item));
  main.append(layout);
  if (session) {
    if (item.kind === 'study') noteEditor(item.id,item.title,body);
    const result = session.setLastItem(item.id);
    if (!result.persisted) announce(result,'');
  }
}
function progressPanel(item) {
  const panel = el('aside',undefined,'card');
  panel.append(el('p','YOUR PROGRESS','eyebrow'));
  const label = el('label','Activity status'); label.htmlFor = 'item-status';
  const select = el('select'); select.id = 'item-status';
  for (const [value,title] of [['not-started','Not started'],['in-progress','In progress'],['complete','Complete']]) { const option = el('option',title); option.value = value; select.append(option); }
  const progress = session.state.progress[item.id];
  select.value = progress?.status || 'not-started';
  select.onchange = () => { const result = session.setStatus(item.id,select.value); announce(result,'Progress saved in this browser.'); stale.hidden = !(session.state.progress[item.id]?.status === 'complete' && session.state.progress[item.id]?.completedEdition !== item.contentEdition); };
  const reviewLabel = el('label',undefined,'check-label');
  const review = el('input'); review.type = 'checkbox'; review.checked = progress?.needsReview || false;
  review.onchange = () => announce(session.setReview(item.id,review.checked),'Review preference saved in this browser.');
  reviewLabel.append(review,el('span','Needs review'));
  const stale = el('p','Previously completed against another content edition. Review this activity and choose Complete again to confirm the current edition.','notice');
  stale.hidden = !(progress?.status === 'complete' && progress.completedEdition !== item.contentEdition);
  const reaffirm = el('button','Confirm Complete for this edition','secondary');
  reaffirm.type = 'button'; reaffirm.hidden = stale.hidden;
  reaffirm.onclick = () => { const result = session.setStatus(item.id,'complete'); announce(result,'Completion confirmed for the current edition.'); if(result.ok) { stale.hidden = true; reaffirm.hidden = true; select.value = 'complete'; } };
  select.addEventListener('change',() => { reaffirm.hidden = stale.hidden; });
  panel.append(label,select,reviewLabel,stale,reaffirm,el('p','Manual, self-assessed progress. Visiting an external course never marks an activity complete.','muted'),link('Open review list →','#review'));
  return panel;
}
function noteEditor(id,title,parent) {
  const saved = session.state.notes[id];
  const block = section('Your notes',[],parent);
  const label = el('label','Questions, mistakes, and things to revisit'); label.htmlFor = 'note-input';
  const input = el('textarea'); input.id = 'note-input'; input.value = saved?.text || ''; input.setAttribute('aria-describedby','note-help note-counter');
  const help = el('p','Saved only in this browser. Keep sensitive information and credentials out of your notes.','muted'); help.id = 'note-help';
  const counter = el('p',undefined,'muted'); counter.id = 'note-counter';
  const savedMessage = el('p',saved ? `Last saved ${new Date(saved.savedAt).toLocaleString()}` : 'No saved note yet.','metadata'); savedMessage.id = 'note-save-state';
  editor = {id,title,input,baseline:saved?.text || '',baselineNote:saved ? {...saved} : null,forcedDirty:false};
  function update() {
    const count = [...input.value].length;
    counter.textContent = `${count.toLocaleString()} / 10,000 characters${count > 10000 ? ' — shorten this note before saving.' : ''}`;
    input.setAttribute('aria-invalid',String(count > 10000));
    savedMessage.textContent = isDirty() ? 'Unsaved changes. Choose Save before leaving.' : (session.state.notes[id] ? 'Saved in this browser.' : 'No saved note yet.');
    updateUnloadGuard();
  }
  input.oninput = update;
  const actions = el('div',undefined,'actions');
  const save = el('button','Save note'); save.type = 'button'; save.onclick = saveEditor;
  const remove = el('button','Delete note','secondary'); remove.type = 'button'; remove.onclick = async () => {
    const result = await choose('Delete this note?',`This clears only the note for “${title}”, including the current draft. Other notes and progress stay as they are.`,[['delete','Delete note'],['cancel','Keep note']]);
    if (result !== 'delete') return;
    const outcome = session.saveNote(id,'',true);
    if (!outcome.persisted) { restoreNoteBaseline(); editor.forcedDirty = true; updateUnloadGuard(); announce(outcome,''); return; }
    input.value = ''; editor.baseline = ''; editor.baselineNote = null; editor.forcedDirty = false; update(); announce(outcome,'Note deleted from this browser.');
  };
  actions.append(save,remove);
  block.append(label,help,input,counter,actions,savedMessage);
  update();
}
function restoreNoteBaseline() {
  if (editor.baselineNote) session.state.notes[editor.id] = {...editor.baselineNote};
  else delete session.state.notes[editor.id];
}
async function saveEditor() {
  if (!editor) return true;
  if ([...editor.input.value].length > 10000) { feedback.textContent = 'This note is over 10,000 characters. Shorten it before saving; your previous saved note is unchanged.'; editor.input.focus(); return false; }
  let confirmedDelete = false;
  if (editor.input.value === '' && editor.baselineNote) {
    const result = await choose('Delete this note?', 'Saving an empty note deletes this item’s saved note only.', [['delete','Delete note'],['cancel','Keep editing']]);
    if (result !== 'delete') return false;
    confirmedDelete = true;
  }
  const result = session.saveNote(editor.id,editor.input.value,confirmedDelete);
  if (!result.persisted) {
    restoreNoteBaseline();
    editor.forcedDirty = true;
    updateUnloadGuard();
    announce(result,'');
    document.querySelector('#note-save-state').textContent = 'Not saved for future visits. Your draft is still here.';
    return false;
  }
  editor.baseline = editor.input.value;
  editor.baselineNote = session.state.notes[editor.id] ? {...session.state.notes[editor.id]} : null;
  editor.forcedDirty = false;
  updateUnloadGuard();
  document.querySelector('#note-save-state').textContent = editor.baseline ? 'Saved in this browser.' : 'No saved note.';
  announce(result,editor.baseline ? 'Note saved in this browser.' : 'Note cleared.');
  return true;
}
function recallRating(item,parent,solution) {
  const block = section('Plan your next recall',['After attempting the exercise and checking feedback, choose how it went. Opening a solution or rereading a note does not by itself demonstrate recall.'],parent);
  const status = el('p',undefined,'metadata'); status.setAttribute('aria-live','polite');
  function update() {
    const recall = session.state.progress[item.id]?.recall;
    status.textContent = recall ? `Last self-rating: ${recall.rating === 'help' ? 'needed support' : recall.rating === 'partial' ? 'partly recalled' : 'recalled independently'}. Return ${recall.nextDueDate} (UTC).${recall.contentEdition !== item.contentEdition ? ' This result belongs to an earlier content edition; review the updated exercise.' : ''}` : 'No recall recorded. Open the reference solution after attempting, then choose a rating.';
  }
  const actions = el('div',undefined,'actions');
  for (const [rating,label] of [['help','Needed support · return in 1 day'],['partial','Partly recalled · return in 3 days'],['independent','Recalled independently · return in 7 days']]) {
    const button = el('button',label,'secondary'); button.type = 'button'; button.disabled = true; button.dataset.recall = rating;
    button.onclick = () => {
      const result = session.recordRecall(item.id,rating);
      announce(result,'Recall and next review date saved in this browser.'); update();
    };
    actions.append(button);
  }
  solution.addEventListener('toggle',() => { if(solution.open) actions.querySelectorAll('button').forEach(button => { button.disabled = false; }); });
  block.append(actions,status,el('p','The 1/3/7-day gaps are practical starting points, not a scientifically optimal algorithm or an exam-readiness score. Repeat on another day; no notifications are sent.','muted'));
  update();
}
function renderReview() {
  main.append(el('p','RECALL, THEN REVISIT','eyebrow'),el('h1','Your review list'),el('p','Return to due exercises and topics you flagged. Attempt the answer before reopening previous notes or solutions.','lead'));
  let total = 0;
  for (const domain of catalogue.domains) {
    const flagged = itemsFor(domain).filter(item => {
      const progress = session.state.progress[item.id];
      return isReviewDue(session.state,item) || progress?.needsReview || (progress?.status === 'complete' && progress.completedEdition !== item.contentEdition);
    });
    if (!flagged.length) continue;
    total += flagged.length;
    const block = section(domain.title,[],main);
    const list = el('ul',undefined,'item-list');
    for (const item of flagged) {
      const row = el('li'); row.append(itemLink(item));
      const recall = session.state.progress[item.id]?.recall;
      if (isReviewDue(session.state,item)) row.append(el('span',recall?.contentEdition !== item.contentEdition ? ' · Content changed — recall again' : ` · Recall due ${recall.nextDueDate}`,'badge'));
      if (session.state.notes[item.id]) {
        const previous = el('details'); previous.append(el('summary','Earlier note — reveal after recall'),el('p',session.state.notes[item.id].text,'note-text muted')); row.append(previous);
      }
      list.append(row);
    }
    block.append(list);
  }
  if (!total) main.append(el('p','Nothing due or flagged yet. Choose Needs review on an activity, or record an exercise recall after comparing with its solution. No weak areas are inferred from unattempted work.','notice'),link('Explore your roadmap','#home'));
  const upcoming = catalogue.items.filter(item => item.kind === 'exercise' && session.state.progress[item.id]?.recall && !isReviewDue(session.state,item)).sort((a,b) => session.state.progress[a.id].recall.nextDueDate.localeCompare(session.state.progress[b.id].recall.nextDueDate));
  if (upcoming.length) {
    const block = section('Scheduled returns',[],main);
    const list = el('ul',undefined,'item-list');
    for (const item of upcoming) { const row = el('li'); row.append(itemLink(item),el('span',` · ${session.state.progress[item.id].recall.nextDueDate} (UTC)`,'metadata')); list.append(row); }
    block.append(list);
  }
}
function renderNotes() {
  main.append(el('p','THINK IT THROUGH','eyebrow'),el('h1','Your notebook'),el('p','A place for the questions and connections you want to keep. Notes remain on this device, in this browser profile.','lead'));
  const notes = Object.entries(session.state.notes);
  if (!notes.length) main.append(el('p','No notes yet. Open any study activity or exercise to start writing.','notice'),link('Explore your roadmap','#home'));
  for (const [id,note] of notes) {
    const item = catalogue.items.find(i => i.id === id);
    const card = el('section',undefined,'card notebook-card');
    card.append(el('h2',item?.title || note.itemTitle));
    if (!item) card.append(el('p','Archived activity · retained for your reference','badge'));
    if (editingNoteId === id) noteEditor(id,item?.title || note.itemTitle,card);
    else {
      card.append(el('p',note.text,'note-text'));
      const actions = el('div',undefined,'actions');
      if (item) actions.append(itemLink(item));
      const edit = el('button','Edit note','secondary'); edit.type = 'button'; edit.onclick = async () => { if (await permitNavigation()) { editingNoteId = id; renderRoute(); document.querySelector('textarea')?.focus(); } };
      actions.append(edit); card.append(actions);
    }
    main.append(card);
  }
}
function renderRoute() {
  editor = null;
  updateUnloadGuard();
  main.replaceChildren();
  if (session?.issue) main.append(el('p',session.issue,'notice'));
  let hash;
  try { hash = decodeURIComponent(location.hash || '#home'); } catch { hash = '#invalid'; }
  document.querySelectorAll('nav a').forEach(a => { a.removeAttribute('aria-current'); if(a.getAttribute('href') === hash) a.setAttribute('aria-current','page'); });
  if (hash === '#home') renderHome();
  else if (hash.startsWith('#item/')) {
    const item = catalogue.items.find(i => i.id === hash.slice(6));
    if (item) renderItem(item); else notFound();
  } else if (hash === '#review') renderReview();
  else if (hash === '#notes') renderNotes();
  else if (hash === '#main') { main.focus(); return; }
  else notFound();
  const heading = main.querySelector('h1');
  if (heading) { heading.tabIndex = -1; heading.focus(); document.title = `${heading.textContent} · Foundations`; }
}
function notFound() { main.append(el('h1','Item not found'),el('p','This study link is unavailable. Choose another activity from your roadmap.'),link('Return to roadmap','#home')); }
try {
  const response = await fetch(new URL('./content.json', import.meta.url));
  if (!response.ok) throw new Error('Catalogue request failed');
  catalogue = validateContent(await response.json());
  session = createSession(() => localStorage,catalogue);
  history.replaceState({studyIndex:currentIndex},'',currentHash);
  renderRoute();
  document.addEventListener('click',event => {
    const anchor = event.target.closest('a');
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = anchor.getAttribute('href');
    if (!href?.startsWith('#')) return;
    event.preventDefault();
    if (href === '#main') { main.focus(); return; }
    if (href !== currentHash) navigateTo(href);
  });
  addEventListener('popstate',async () => {
    if (restoring) { const resolve = restoring; restoring = null; resolve(); return; }
    const targetHash = location.hash || '#home';
    const targetIndex = history.state?.studyIndex ?? currentIndex+1;
    if (allowHistory || !isDirty()) {
      allowHistory = false;
      currentIndex = targetIndex; currentHash = targetHash;
      history.replaceState({studyIndex:currentIndex},'',currentHash);
      renderRoute(); return;
    }
    const delta = targetIndex-currentIndex;
    if (navigating) {
      if (delta) { restoring = () => {}; history.go(-delta); }
      return;
    }
    navigating = true;
    try {
      if (delta) await new Promise(resolve => { restoring = resolve; history.go(-delta); });
      if (await permitNavigation()) {
        if (delta) { allowHistory = true; history.go(delta); }
        else { currentHash = targetHash; renderRoute(); }
      }
    } finally { navigating = false; }
  });
  document.querySelector('#reset').onclick = async () => {
    const choice = await choose('Reset this companion?', 'This deletes all of this companion’s progress, review flags, notes, and resume position in this browser. Current drafts will be discarded. Other websites’ data is unaffected.', [['reset','Reset companion'],['cancel','Keep my data']]);
    if (choice !== 'reset') return;
    const result = session.reset(true);
    announce(result,'This companion’s saved data was reset.');
    if (result.ok) { editingNoteId = null; currentHash = '#home'; history.replaceState({studyIndex:currentIndex},'',currentHash); renderRoute(); }
  };
} catch {
  main.replaceChildren(el('h1','Study content is unavailable'),el('p','Please reload to try again. Your saved notes have not been changed.'));
}
