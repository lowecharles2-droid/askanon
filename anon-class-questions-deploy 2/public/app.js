const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const AUTO_REFRESH_MS = 4000;

let autoRefreshTimer = null;

let state = {
  view: 'home',
  classroom: null,
  questions: [],
  stats: null,
  professorToken: null,
  professorClassId: null,
  currentJoinCode: null,
  filter: 'all',
  search: '',
  sort: 'top',
  knownQuestionIds: new Set()
};

function api(path, options = {}) {
  return fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  }).then(async (response) => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'Request failed.');
    }
    return data;
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timeout);
  showToast.timeout = window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function cloneTemplate(id) {
  const template = document.querySelector(`#${id}`);
  return template.content.cloneNode(true);
}

function getVoterKey() {
  const key = 'askanon_voter_key';
  let value = localStorage.getItem(key);
  if (!value) {
    const randomPart = window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).slice(2);
    value = `voter_${randomPart}_${Date.now()}`;
    localStorage.setItem(key, value);
  }
  return value;
}

function getVotedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem('askanon_votes') || '[]'));
  } catch {
    return new Set();
  }
}

function saveVotedSet(set) {
  localStorage.setItem('askanon_votes', JSON.stringify([...set]));
}

function setButtonLoading(button, isLoading, text = 'Working...') {
  if (!button) return;
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = text;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

function routeTo(path) {
  clearAutoRefresh();
  history.pushState({}, '', path);
  renderRoute();
}

function copyToClipboard(value, successMessage) {
  navigator.clipboard.writeText(value)
    .then(() => showToast(successMessage))
    .catch(() => showToast('Copy failed. You can copy it from the address bar.'));
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function classMeta(classroom) {
  const parts = [classroom.courseCode, classroom.school, classroom.professorName && `Prof. ${classroom.professorName}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Anonymous classroom question board';
}

function clearAutoRefresh() {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

function isProfessorTypingAnswer() {
  return Boolean(document.activeElement?.matches('.answer-editor textarea'));
}

function startAutoRefresh(fetcher) {
  clearAutoRefresh();
  autoRefreshTimer = window.setInterval(() => {
    if (!document.hidden && !isProfessorTypingAnswer()) fetcher({ silent: true });
  }, AUTO_REFRESH_MS);
}

function updateLiveStatus(selector, questionCount) {
  const status = app.querySelector(selector);
  if (!status) return;
  status.textContent = `Live · auto-refreshing every ${AUTO_REFRESH_MS / 1000}s · ${questionCount} question${questionCount === 1 ? '' : 's'} · updated ${formatTime()}`;
}

function detectNewQuestions(nextQuestions, silent) {
  const nextIds = new Set(nextQuestions.map((question) => question.id));
  const hadPreviousQuestions = state.knownQuestionIds.size > 0;
  const newCount = nextQuestions.filter((question) => !state.knownQuestionIds.has(question.id)).length;
  state.knownQuestionIds = nextIds;

  if (silent && hadPreviousQuestions && newCount > 0) {
    showToast(`${newCount} new question${newCount === 1 ? '' : 's'} came in.`);
  }
}

function bindCharacterCounter(textarea, counter, maxLength) {
  const update = () => {
    counter.textContent = `${textarea.value.length}/${maxLength}`;
  };
  textarea.addEventListener('input', update);
  update();
}

function renderHome() {
  clearAutoRefresh();
  state.view = 'home';
  app.replaceChildren(cloneTemplate('homeTemplate'));

  app.querySelector('[data-action="show-create"]').addEventListener('click', () => {
    app.querySelector('#createClassForm input[name="title"]').focus();
  });

  app.querySelector('[data-action="show-join"]').addEventListener('click', () => {
    app.querySelector('#joinClassForm input[name="joinCode"]').focus();
  });

  app.querySelector('#createClassForm').addEventListener('submit', handleCreateClass);
  app.querySelector('#joinClassForm').addEventListener('submit', handleJoinClass);
}

async function handleCreateClass(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form));

  try {
    setButtonLoading(button, true, 'Creating...');
    const result = await api('/api/classes', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    const origin = window.location.origin;
    const professorUrl = `${origin}${result.professorUrl}`;
    const studentUrl = `${origin}${result.studentUrl}`;

    localStorage.setItem(`askanon_professor_${result.class.id}`, result.professorToken);
    showCreatedClassModal(result.class.joinCode, studentUrl, professorUrl);
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

function showCreatedClassModal(joinCode, studentUrl, professorUrl) {
  app.innerHTML = `
    <section class="board-header">
      <div>
        <p class="eyebrow">Class created</p>
        <h1>Your anonymous question board is ready.</h1>
        <p class="muted">Share the student code with your class and save the professor link somewhere private.</p>
      </div>
    </section>
    <section class="split-grid">
      <div class="panel">
        <div class="panel-header">
          <p class="eyebrow">Student code</p>
          <h2>${joinCode}</h2>
        </div>
        <p class="helper-text">Students can use this code from the home page.</p>
        <button class="secondary-button full" id="copyCodeButton">Copy code</button>
      </div>
      <div class="panel">
        <div class="panel-header">
          <p class="eyebrow">Private professor link</p>
          <h2>Dashboard access</h2>
        </div>
        <p class="helper-text">This link controls moderation. Do not post it publicly.</p>
        <button class="primary-button full" id="openProfessorButton">Open dashboard</button>
        <button class="ghost-button full stacked-button" id="copyProfessorButton">Copy professor link</button>
        <button class="ghost-button full stacked-button" id="copyStudentButton">Copy student link</button>
      </div>
    </section>
  `;

  document.querySelector('#copyCodeButton').addEventListener('click', () => copyToClipboard(joinCode, 'Class code copied.'));
  document.querySelector('#copyProfessorButton').addEventListener('click', () => copyToClipboard(professorUrl, 'Professor link copied.'));
  document.querySelector('#copyStudentButton').addEventListener('click', () => copyToClipboard(studentUrl, 'Student link copied.'));
  document.querySelector('#openProfessorButton').addEventListener('click', () => routeTo(new URL(professorUrl).pathname + new URL(professorUrl).search));
}

function handleJoinClass(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const joinCode = new FormData(form).get('joinCode').toString().trim().toUpperCase();
  if (joinCode.length !== 6) {
    showToast('Enter the 6-character class code.');
    return;
  }
  routeTo(`/class/${joinCode}`);
}

async function renderClass(joinCode) {
  clearAutoRefresh();
  state.view = 'class';
  state.currentJoinCode = joinCode;
  state.knownQuestionIds = new Set();
  app.replaceChildren(cloneTemplate('classTemplate'));
  bindClassEvents(joinCode);

  await loadClassQuestions(joinCode);
  startAutoRefresh((options) => loadClassQuestions(joinCode, options));
}

async function loadClassQuestions(joinCode, { silent = false, manual = false } = {}) {
  try {
    const result = await api(`/api/classes/${joinCode}/questions`);
    detectNewQuestions(result.questions, silent);
    state.classroom = result.class;
    state.questions = result.questions;
    paintClassView();
    updateLiveStatus('#classLiveStatus', state.questions.length);
    if (manual) showToast('Questions refreshed.');
  } catch (error) {
    if (!silent) renderError('Class not found', error.message, '/');
  }
}

function bindClassEvents(joinCode) {
  const questionForm = app.querySelector('#questionForm');
  const textarea = questionForm.querySelector('textarea[name="body"]');
  const counter = app.querySelector('#questionCounter');

  bindCharacterCounter(textarea, counter, 600);

  questionForm.addEventListener('submit', (event) => handleSubmitQuestion(event, joinCode));
  app.querySelector('#refreshButton').addEventListener('click', () => loadClassQuestions(joinCode, { manual: true }));
  app.querySelector('#questionFilter').addEventListener('change', (event) => {
    state.filter = event.target.value;
    paintQuestionsList();
  });
  app.querySelector('#questionSort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    paintQuestionsList();
  });
  app.querySelector('#questionSearch').addEventListener('input', (event) => {
    state.search = event.target.value;
    paintQuestionsList();
  });
  app.querySelector('#copyStudentLinkButton').addEventListener('click', () => {
    copyToClipboard(`${location.origin}/class/${joinCode}`, 'Student link copied.');
  });
}

function paintClassView() {
  const classroom = state.classroom;
  app.querySelector('#classCodeLabel').textContent = `Class code: ${classroom.joinCode}`;
  app.querySelector('#classTitle').textContent = classroom.title;
  app.querySelector('#classMeta').textContent = classMeta(classroom);

  const isAccepting = classroom.acceptingQuestions !== false;
  app.querySelector('#submissionStatus').textContent = isAccepting
    ? 'Questions are open. New submissions appear automatically.'
    : 'The professor paused new questions. You can still read and upvote existing questions.';

  app.querySelectorAll('#questionForm input, #questionForm select, #questionForm textarea, #questionForm button').forEach((element) => {
    element.disabled = !isAccepting;
  });

  paintQuestionsList();
}

async function handleSubmitQuestion(event, joinCode) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form));

  try {
    setButtonLoading(button, true, 'Submitting...');
    await api(`/api/classes/${joinCode}/questions`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    form.reset();
    app.querySelector('#questionCounter').textContent = '0/600';
    showToast('Question submitted anonymously.');
    await loadClassQuestions(joinCode);
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

function filteredQuestions(questions, filter, search, sort) {
  let visible = [...questions];

  if (filter === 'open') visible = visible.filter((q) => q.status === 'open' && !q.isHidden);
  else if (filter === 'answered') visible = visible.filter((q) => q.status === 'answered' && !q.isHidden);
  else if (filter === 'hidden') visible = visible.filter((q) => q.isHidden);
  else visible = visible.filter((q) => !q.isHidden);

  const query = String(search || '').trim().toLowerCase();
  if (query) {
    visible = visible.filter((q) => {
      const searchable = `${q.body} ${q.tag || ''} ${q.answerText || ''}`.toLowerCase();
      return searchable.includes(query);
    });
  }

  visible.sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    if (sort === 'newest') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (sort === 'oldest') return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (a.votes !== b.votes) return Number(b.votes || 0) - Number(a.votes || 0);
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return visible;
}

function paintQuestionsList() {
  const list = app.querySelector('#questionsList');
  if (!list) return;
  const questions = filteredQuestions(state.questions, state.filter, state.search, state.sort);
  list.replaceChildren();

  if (!questions.length) {
    list.innerHTML = '<div class="empty-state">No matching questions yet.</div>';
    return;
  }

  const votedSet = getVotedSet();
  questions.forEach((question) => {
    const card = questionCard(question, { professor: false, voted: votedSet.has(question.id) });
    list.appendChild(card);
  });
}

function questionCard(question, options = {}) {
  const card = document.createElement('article');
  card.className = `question-card ${question.isPinned ? 'pinned' : ''} ${question.status === 'answered' ? 'answered' : ''} ${question.isHidden ? 'hidden' : ''}`;

  const topLine = document.createElement('div');
  topLine.className = 'question-topline';
  const meta = document.createElement('span');
  meta.textContent = `${question.tag || 'Question'} · ${formatDate(question.createdAt)}`;
  const votes = document.createElement('strong');
  votes.textContent = `${question.votes} vote${Number(question.votes) === 1 ? '' : 's'}`;
  topLine.append(meta, votes);

  const body = document.createElement('p');
  body.className = 'question-body';
  body.textContent = question.body;

  const pillRow = document.createElement('div');
  pillRow.className = 'pill-row';
  pillRow.appendChild(makePill(question.status === 'answered' ? 'Answered' : 'Open', question.status));
  if (question.isPinned) pillRow.appendChild(makePill('Pinned'));
  if (question.isHidden) pillRow.appendChild(makePill('Hidden', 'hidden-pill'));

  const pieces = [topLine, body, pillRow];

  if (question.answerText) {
    const answer = document.createElement('div');
    answer.className = 'answer-box';
    const label = document.createElement('strong');
    label.textContent = 'Professor answer';
    const text = document.createElement('p');
    text.textContent = question.answerText;
    answer.append(label, text);
    pieces.push(answer);
  }

  if (options.professor) {
    pieces.push(professorAnswerEditor(question));
  }

  const actions = document.createElement('div');
  actions.className = 'question-actions';

  if (options.professor) {
    actions.appendChild(professorButton(question.status === 'answered' ? 'Mark open' : 'Mark answered', () => {
      updateProfessorQuestion(question.id, { status: question.status === 'answered' ? 'open' : 'answered' });
    }));
    actions.appendChild(professorButton(question.isPinned ? 'Unpin' : 'Pin', () => {
      updateProfessorQuestion(question.id, { isPinned: !question.isPinned });
    }));
    actions.appendChild(professorButton(question.isHidden ? 'Unhide' : 'Hide', () => {
      updateProfessorQuestion(question.id, { isHidden: !question.isHidden });
    }, question.isHidden ? 'ghost-button small' : 'danger-button small'));
  } else {
    const voteButton = document.createElement('button');
    voteButton.className = `ghost-button small vote-button ${options.voted ? 'voted' : ''}`;
    voteButton.type = 'button';
    voteButton.textContent = options.voted ? '✓ Upvoted' : 'Upvote';
    voteButton.addEventListener('click', () => handleUpvote(question.id, voteButton));
    actions.appendChild(voteButton);
  }

  pieces.push(actions);
  card.append(...pieces);
  return card;
}

function professorAnswerEditor(question) {
  const wrapper = document.createElement('div');
  wrapper.className = 'answer-editor';

  const textarea = document.createElement('textarea');
  textarea.rows = 2;
  textarea.maxLength = 800;
  textarea.placeholder = 'Optional public answer or note shown to students';
  textarea.value = question.answerText || '';

  const row = document.createElement('div');
  row.className = 'answer-editor-row';

  const counter = document.createElement('span');
  counter.className = 'helper-text';
  const updateCounter = () => {
    counter.textContent = `${textarea.value.length}/800`;
  };
  textarea.addEventListener('input', updateCounter);
  updateCounter();

  const saveButton = professorButton('Save answer', () => {
    updateProfessorQuestion(question.id, { answerText: textarea.value }, saveButton);
  }, 'secondary-button small');

  row.append(counter, saveButton);
  wrapper.append(textarea, row);
  return wrapper;
}

function makePill(text, type = '') {
  const pill = document.createElement('span');
  pill.className = `pill ${type}`;
  pill.textContent = text;
  return pill;
}

function professorButton(text, handler, className = 'ghost-button small') {
  const button = document.createElement('button');
  button.className = className;
  button.type = 'button';
  button.textContent = text;
  button.addEventListener('click', handler);
  return button;
}

async function handleUpvote(questionId, button) {
  try {
    setButtonLoading(button, true, 'Saving...');
    const result = await api(`/api/questions/${questionId}/upvote`, {
      method: 'POST',
      body: JSON.stringify({ voterKey: getVoterKey() })
    });

    const votedSet = getVotedSet();
    if (result.voted) votedSet.add(questionId);
    else votedSet.delete(questionId);
    saveVotedSet(votedSet);

    state.questions = state.questions.map((item) => item.id === questionId ? result.question : item);
    paintQuestionsList();
    updateLiveStatus('#classLiveStatus', state.questions.length);
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

async function renderProfessor(classId, token) {
  clearAutoRefresh();
  state.view = 'professor';
  state.professorClassId = classId;
  state.professorToken = token || localStorage.getItem(`askanon_professor_${classId}`);
  state.knownQuestionIds = new Set();

  if (!state.professorToken) {
    renderError('Missing professor token', 'Use the private professor link created with this class.', '/');
    return;
  }

  app.replaceChildren(cloneTemplate('professorTemplate'));
  bindProfessorEvents();

  await loadProfessorDashboard(classId, state.professorToken);
  startAutoRefresh((options) => loadProfessorDashboard(classId, state.professorToken, options));
}

async function loadProfessorDashboard(classId, token, { silent = false, manual = false } = {}) {
  try {
    const result = await api(`/api/professor/${classId}?token=${encodeURIComponent(token)}`);
    detectNewQuestions(result.questions, silent);
    state.classroom = result.class;
    state.questions = result.questions;
    state.stats = result.stats;
    paintProfessorView();
    updateLiveStatus('#professorLiveStatus', state.questions.length);
    if (manual) showToast('Dashboard refreshed.');
  } catch (error) {
    if (!silent) renderError('Dashboard unavailable', error.message, '/');
  }
}

function bindProfessorEvents() {
  app.querySelector('#professorRefreshButton').addEventListener('click', () => loadProfessorDashboard(state.professorClassId, state.professorToken, { manual: true }));
  app.querySelector('#professorFilter').addEventListener('change', (event) => {
    state.filter = event.target.value;
    paintProfessorQuestionsList();
  });
  app.querySelector('#professorSort').addEventListener('change', (event) => {
    state.sort = event.target.value;
    paintProfessorQuestionsList();
  });
  app.querySelector('#professorSearch').addEventListener('input', (event) => {
    state.search = event.target.value;
    paintProfessorQuestionsList();
  });
  app.querySelector('#copyProfessorLinkButton').addEventListener('click', () => {
    copyToClipboard(location.href, 'Professor link copied.');
  });
  app.querySelector('#copyProfessorStudentLinkButton').addEventListener('click', () => {
    copyToClipboard(`${location.origin}/class/${state.classroom.joinCode}`, 'Student link copied.');
  });
  app.querySelector('#toggleSubmissionsButton').addEventListener('click', toggleSubmissions);
  app.querySelector('#exportCsvButton').addEventListener('click', exportProfessorCsv);
}

function paintProfessorView() {
  const classroom = state.classroom;
  app.querySelector('#professorCodeLabel').textContent = `Student code: ${classroom.joinCode}`;
  app.querySelector('#professorTitle').textContent = classroom.title;
  app.querySelector('#professorMeta').textContent = classMeta(classroom);

  const isAccepting = classroom.acceptingQuestions !== false;
  const toggleButton = app.querySelector('#toggleSubmissionsButton');
  toggleButton.textContent = isAccepting ? 'Pause questions' : 'Resume questions';
  toggleButton.className = isAccepting ? 'danger-button' : 'primary-button';

  paintStats();
  paintProfessorQuestionsList();
}

function paintStats() {
  const stats = state.stats;
  const statItems = [
    ['Total', stats.total],
    ['Open', stats.open],
    ['Answered', stats.answered],
    ['Hidden', stats.hidden],
    ['Votes', stats.votes],
    ['Submissions', stats.acceptingQuestions ? 'Open' : 'Paused']
  ];

  const grid = app.querySelector('#statsGrid');
  grid.replaceChildren();
  statItems.forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    const strong = document.createElement('strong');
    strong.textContent = value;
    const span = document.createElement('span');
    span.textContent = label;
    card.append(strong, span);
    grid.appendChild(card);
  });
}

function paintProfessorQuestionsList() {
  const list = app.querySelector('#professorQuestionsList');
  if (!list) return;
  const questions = filteredQuestions(state.questions, state.filter, state.search, state.sort);
  list.replaceChildren();

  if (!questions.length) {
    list.innerHTML = '<div class="empty-state">No matching questions yet.</div>';
    return;
  }

  questions.forEach((question) => list.appendChild(questionCard(question, { professor: true })));
}

async function updateProfessorQuestion(questionId, updates, button = null) {
  try {
    setButtonLoading(button, true, 'Saving...');
    const result = await api(`/api/professor/${state.professorClassId}/questions/${questionId}?token=${encodeURIComponent(state.professorToken)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    state.questions = state.questions.map((item) => item.id === questionId ? result.question : item);
    if (result.stats) state.stats = result.stats;
    paintStats();
    paintProfessorQuestionsList();
    updateLiveStatus('#professorLiveStatus', state.questions.length);
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

async function toggleSubmissions(event) {
  const button = event.currentTarget;
  const nextValue = !(state.classroom.acceptingQuestions !== false);

  try {
    setButtonLoading(button, true, nextValue ? 'Opening...' : 'Pausing...');
    const result = await api(`/api/professor/${state.professorClassId}/settings?token=${encodeURIComponent(state.professorToken)}`, {
      method: 'PATCH',
      body: JSON.stringify({ acceptingQuestions: nextValue })
    });
    state.classroom = result.class;
    state.stats = result.stats;
    paintProfessorView();
    showToast(nextValue ? 'New questions are open.' : 'New questions are paused.');
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

function csvEscape(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function exportProfessorCsv() {
  const rows = [
    ['Question', 'Topic', 'Status', 'Votes', 'Pinned', 'Hidden', 'Professor answer', 'Created at'],
    ...state.questions.map((question) => [
      question.body,
      question.tag || '',
      question.status,
      question.votes,
      question.isPinned ? 'yes' : 'no',
      question.isHidden ? 'yes' : 'no',
      question.answerText || '',
      question.createdAt
    ])
  ];

  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeTitle = (state.classroom?.title || 'questions').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  link.href = url;
  link.download = `${safeTitle || 'questions'}-askanon-export.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('CSV exported.');
}

function renderError(title, message, actionPath) {
  clearAutoRefresh();
  app.replaceChildren();

  const section = document.createElement('section');
  section.className = 'board-header';

  const wrapper = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'Error';
  const heading = document.createElement('h1');
  heading.textContent = title;
  const body = document.createElement('p');
  body.className = 'muted';
  body.textContent = message;
  wrapper.append(eyebrow, heading, body);

  const button = document.createElement('button');
  button.className = 'primary-button';
  button.type = 'button';
  button.textContent = 'Go home';
  button.addEventListener('click', () => routeTo(actionPath));

  section.append(wrapper, button);
  app.appendChild(section);
}

function resetRouteState() {
  clearAutoRefresh();
  state = {
    ...state,
    view: 'home',
    classroom: null,
    questions: [],
    stats: null,
    professorToken: null,
    professorClassId: null,
    currentJoinCode: null,
    filter: 'all',
    search: '',
    sort: 'top',
    knownQuestionIds: new Set()
  };
}

function renderRoute() {
  resetRouteState();
  const path = location.pathname;
  const professorMatch = path.match(/^\/professor\/([^/]+)$/);
  const classMatch = path.match(/^\/class\/([^/]+)$/);

  if (professorMatch) {
    const token = new URLSearchParams(location.search).get('token');
    renderProfessor(professorMatch[1], token);
    return;
  }

  if (classMatch) {
    renderClass(classMatch[1].toUpperCase());
    return;
  }

  renderHome();
}

document.querySelector('#joinTopButton').addEventListener('click', () => {
  routeTo('/');
  window.setTimeout(() => app.querySelector('#joinClassForm input[name="joinCode"]')?.focus(), 0);
});

document.querySelector('#createTopButton').addEventListener('click', () => {
  routeTo('/');
  window.setTimeout(() => app.querySelector('#createClassForm input[name="title"]')?.focus(), 0);
});

window.addEventListener('popstate', renderRoute);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (state.view === 'class' && state.currentJoinCode) loadClassQuestions(state.currentJoinCode, { silent: true });
  if (state.view === 'professor' && state.professorClassId && state.professorToken && !isProfessorTypingAnswer()) {
    loadProfessorDashboard(state.professorClassId, state.professorToken, { silent: true });
  }
});

renderRoute();
