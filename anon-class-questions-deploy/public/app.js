const app = document.querySelector('#app');
const toast = document.querySelector('#toast');

let state = {
  classroom: null,
  questions: [],
  stats: null,
  professorToken: null,
  professorClassId: null,
  filter: 'all'
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
    value = `voter_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}_${Date.now()}`;
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

function classMeta(classroom) {
  const parts = [classroom.courseCode, classroom.school, classroom.professorName && `Prof. ${classroom.professorName}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Anonymous classroom question board';
}

function renderHome() {
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
        <button class="ghost-button full" id="copyProfessorButton" style="margin-top: .7rem;">Copy professor link</button>
        <button class="ghost-button full" id="copyStudentButton" style="margin-top: .7rem;">Copy student link</button>
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
  app.replaceChildren(cloneTemplate('classTemplate'));
  bindClassEvents(joinCode);

  try {
    const result = await api(`/api/classes/${joinCode}/questions`);
    state.classroom = result.class;
    state.questions = result.questions;
    paintClassView();
  } catch (error) {
    renderError('Class not found', error.message, '/');
  }
}

function bindClassEvents(joinCode) {
  app.querySelector('#questionForm').addEventListener('submit', (event) => handleSubmitQuestion(event, joinCode));
  app.querySelector('#refreshButton').addEventListener('click', () => renderClass(joinCode));
  app.querySelector('#questionFilter').addEventListener('change', (event) => {
    state.filter = event.target.value;
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
    showToast('Question submitted anonymously.');
    const result = await api(`/api/classes/${joinCode}/questions`);
    state.questions = result.questions;
    paintQuestionsList();
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

function filteredQuestions(questions, filter) {
  if (filter === 'open') return questions.filter((q) => q.status === 'open' && !q.isHidden);
  if (filter === 'answered') return questions.filter((q) => q.status === 'answered' && !q.isHidden);
  if (filter === 'hidden') return questions.filter((q) => q.isHidden);
  return questions.filter((q) => !q.isHidden);
}

function paintQuestionsList() {
  const list = app.querySelector('#questionsList');
  if (!list) return;
  const questions = filteredQuestions(state.questions, state.filter);
  list.replaceChildren();

  if (!questions.length) {
    list.innerHTML = '<div class="empty-state">No questions yet. Be the first to ask one.</div>';
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
  topLine.innerHTML = `<span>${question.tag || 'Question'} · ${formatDate(question.createdAt)}</span><strong>${question.votes} vote${Number(question.votes) === 1 ? '' : 's'}</strong>`;

  const body = document.createElement('p');
  body.className = 'question-body';
  body.textContent = question.body;

  const pillRow = document.createElement('div');
  pillRow.className = 'pill-row';
  pillRow.appendChild(makePill(question.status === 'answered' ? 'Answered' : 'Open', question.status));
  if (question.isPinned) pillRow.appendChild(makePill('Pinned'));
  if (question.isHidden) pillRow.appendChild(makePill('Hidden', 'hidden-pill'));

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
    voteButton.textContent = options.voted ? '✓ Upvoted' : 'Upvote';
    voteButton.addEventListener('click', () => handleUpvote(question.id, voteButton));
    actions.appendChild(voteButton);
  }

  card.append(topLine, body, pillRow, actions);
  return card;
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
  } catch (error) {
    showToast(error.message);
  } finally {
    setButtonLoading(button, false);
  }
}

async function renderProfessor(classId, token) {
  state.professorClassId = classId;
  state.professorToken = token || localStorage.getItem(`askanon_professor_${classId}`);

  if (!state.professorToken) {
    renderError('Missing professor token', 'Use the private professor link created with this class.', '/');
    return;
  }

  app.replaceChildren(cloneTemplate('professorTemplate'));
  bindProfessorEvents();

  try {
    const result = await api(`/api/professor/${classId}?token=${encodeURIComponent(state.professorToken)}`);
    state.classroom = result.class;
    state.questions = result.questions;
    state.stats = result.stats;
    paintProfessorView();
  } catch (error) {
    renderError('Dashboard unavailable', error.message, '/');
  }
}

function bindProfessorEvents() {
  app.querySelector('#professorRefreshButton').addEventListener('click', () => renderProfessor(state.professorClassId, state.professorToken));
  app.querySelector('#professorFilter').addEventListener('change', (event) => {
    state.filter = event.target.value;
    paintProfessorQuestionsList();
  });
  app.querySelector('#copyProfessorLinkButton').addEventListener('click', () => {
    copyToClipboard(location.href, 'Professor link copied.');
  });
  app.querySelector('#copyProfessorStudentLinkButton').addEventListener('click', () => {
    copyToClipboard(`${location.origin}/class/${state.classroom.joinCode}`, 'Student link copied.');
  });
}

function paintProfessorView() {
  const classroom = state.classroom;
  app.querySelector('#professorCodeLabel').textContent = `Student code: ${classroom.joinCode}`;
  app.querySelector('#professorTitle').textContent = classroom.title;
  app.querySelector('#professorMeta').textContent = classMeta(classroom);
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
    ['Votes', stats.votes]
  ];

  const grid = app.querySelector('#statsGrid');
  grid.replaceChildren();
  statItems.forEach(([label, value]) => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    card.innerHTML = `<strong>${value}</strong><span>${label}</span>`;
    grid.appendChild(card);
  });
}

function paintProfessorQuestionsList() {
  const list = app.querySelector('#professorQuestionsList');
  if (!list) return;
  const questions = filteredQuestions(state.questions, state.filter);
  list.replaceChildren();

  if (!questions.length) {
    list.innerHTML = '<div class="empty-state">No matching questions yet.</div>';
    return;
  }

  questions.forEach((question) => list.appendChild(questionCard(question, { professor: true })));
}

async function updateProfessorQuestion(questionId, updates) {
  try {
    await api(`/api/professor/${state.professorClassId}/questions/${questionId}?token=${encodeURIComponent(state.professorToken)}`, {
      method: 'PATCH',
      body: JSON.stringify(updates)
    });
    const result = await api(`/api/professor/${state.professorClassId}?token=${encodeURIComponent(state.professorToken)}`);
    state.questions = result.questions;
    state.stats = result.stats;
    paintStats();
    paintProfessorQuestionsList();
  } catch (error) {
    showToast(error.message);
  }
}

function renderError(title, message, actionPath) {
  app.innerHTML = `
    <section class="board-header">
      <div>
        <p class="eyebrow">Error</p>
        <h1>${title}</h1>
        <p class="muted">${message}</p>
      </div>
      <button class="primary-button" id="errorActionButton">Go home</button>
    </section>
  `;
  app.querySelector('#errorActionButton').addEventListener('click', () => routeTo(actionPath));
}

function renderRoute() {
  state = { ...state, classroom: null, questions: [], stats: null, filter: 'all' };
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
renderRoute();
