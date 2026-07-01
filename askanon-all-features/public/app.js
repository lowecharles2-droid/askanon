const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
const siteHeader = document.querySelector('#siteHeader');
const AUTO_REFRESH_MS = 4000;

const state = {
  config: { categories: [], statuses: [], reactions: [] },
  timer: null,
  view: 'home',
  classroom: null,
  questions: [],
  stats: null,
  summary: null,
  exitTickets: [],
  professorToken: '',
  selectedSessionId: '',
  filter: 'all',
  search: '',
  sort: 'top',
  lastUpdated: null,
  allowDuplicateText: '',
  studentLoadedOnce: false,
  professorLoadedOnce: false
};

function ensureAnonId() {
  let anonId = localStorage.getItem('askanon_anon_id');
  if (!anonId) {
    anonId = `anon_${cryptoRandom()}`;
    localStorage.setItem('askanon_anon_id', anonId);
  }
  return anonId;
}

function cryptoRandom() {
  if (window.crypto?.getRandomValues) {
    const bytes = new Uint8Array(8);
    window.crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const anonId = ensureAnonId();

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error(data.error || 'Request failed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timeout);
  showToast.timeout = setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatTime(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  } catch {
    return value;
  }
}

function absoluteUrl(path) {
  return `${window.location.origin}${path}`;
}

function qrUrl(text) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=10&data=${encodeURIComponent(text)}`;
}

function setTimer(callback) {
  clearTimer();
  state.timer = setInterval(callback, AUTO_REFRESH_MS);
}

function clearTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function setPresentationMode(on) {
  document.body.classList.toggle('presentation-body', Boolean(on));
}

function template(id) {
  return document.querySelector(id).innerHTML;
}

function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  return parts.length ? parts : [''];
}

async function init() {
  try {
    const config = await api('/api/config');
    state.config = config;
  } catch {
    state.config = { categories: ['Confused', 'Homework', 'Exam', 'Clarification', 'Discussion', 'Technical issue', 'Other'], statuses: ['new', 'needs_answer', 'answered', 'skipped', 'saved'], reactions: ['got_it', 'still_confused', 'need_example'] };
  }
  window.addEventListener('hashchange', route);
  await route();
}

async function route() {
  clearTimer();
  setPresentationMode(false);
  state.studentLoadedOnce = false;
  state.professorLoadedOnce = false;
  const parts = parseHash();
  const view = parts[0] || '';
  try {
    if (!view) return renderHome();
    if (view === 'create') return renderCreate();
    if (view === 'join' && parts[1]) return renderStudentByCode(parts[1]);
    if (view === 'join') return renderJoin();
    if (view === 'login') return renderLogin();
    if (view === 'professor' && parts[1] && parts[2]) return renderProfessor(parts[1], parts[2]);
    if (view === 'present' && parts[1] && parts[2]) return renderPresentation(parts[1], parts[2]);
    renderHome();
  } catch (error) {
    app.innerHTML = `<section class="card narrow"><h1>Something broke</h1><p class="muted">${escapeHtml(error.message)}</p><a class="primary-button" href="/#/">Go home</a></section>`;
  }
}

function renderHome() {
  state.view = 'home';
  app.innerHTML = template('#homeTemplate');
}

function renderCreate() {
  state.view = 'create';
  app.innerHTML = template('#createTemplate');
  document.querySelector('#createForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const data = await api('/api/classes', {
        method: 'POST',
        body: JSON.stringify(Object.fromEntries(form.entries()))
      });
      showToast('Class created. Opening professor dashboard.');
      window.location.hash = `#/professor/${data.classroom.id}/${data.classroom.adminToken}`;
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

function renderJoin() {
  state.view = 'join';
  app.innerHTML = template('#joinTemplate');
  document.querySelector('#joinForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get('joinCode').toString().trim().toUpperCase();
    if (!code) return showToast('Enter a class code.');
    window.location.hash = `#/join/${encodeURIComponent(code)}`;
  });
}

function renderLogin() {
  state.view = 'login';
  app.innerHTML = template('#loginTemplate');
  document.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const button = event.currentTarget.querySelector('button');
    button.disabled = true;
    try {
      const data = await api('/api/classes/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(form.entries())) });
      window.location.hash = `#/professor/${data.classroom.id}/${data.classroom.adminToken}`;
    } catch (error) {
      showToast(error.message);
    } finally {
      button.disabled = false;
    }
  });
}

async function renderStudentByCode(joinCode) {
  state.view = 'student';
  const data = await api(`/api/classes/join/${encodeURIComponent(joinCode)}`);
  state.classroom = data.classroom;
  state.selectedSessionId = state.selectedSessionId || data.classroom.currentSessionId;
  await loadStudent(true);
  setTimer(() => loadStudent(false));
}

async function loadStudent(fullRender = false) {
  const classId = state.classroom?.id;
  if (!classId) return;
  const sessionId = state.selectedSessionId || state.classroom.currentSessionId || '';
  const data = await api(`/api/classes/${classId}/questions?sessionId=${encodeURIComponent(sessionId)}&anonId=${encodeURIComponent(anonId)}`);
  state.classroom = data.classroom;
  state.questions = data.questions;
  state.stats = data.stats;
  state.lastUpdated = new Date();
  if (fullRender || !state.studentLoadedOnce) {
    state.studentLoadedOnce = true;
    drawStudent();
  } else {
    updateStudentDynamic();
  }
}

function drawStudent() {
  const c = state.classroom;
  const sessionOptions = c.sessions.map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === state.selectedSessionId ? 'selected' : ''}>${escapeHtml(s.title)}${s.isActive ? '' : ' (ended)'}</option>`).join('');
  app.innerHTML = `
    <section class="board-header">
      <div class="board-top">
        <div class="board-title">
          <p class="eyebrow">Student board</p>
          <h1>${escapeHtml(c.title)}</h1>
          <div class="board-meta">
            <span class="pill">Code: ${escapeHtml(c.joinCode)}</span>
            ${c.course ? `<span class="pill">${escapeHtml(c.course)}</span>` : ''}
            <span class="pill">Professor: ${escapeHtml(c.professorName)}</span>
          </div>
        </div>
        <a class="ghost-button" href="/#/join">Switch class</a>
      </div>
      <div id="studentPauseBanner"></div>
    </section>

    <section class="grid">
      <aside class="panel">
        <h2>Ask anonymously</h2>
        <form id="questionForm" class="stacked-form">
          <label>Session<select name="sessionId" id="studentSessionSelect">${sessionOptions}</select></label>
          <label>Category<select name="category">${state.config.categories.map((cat) => `<option>${escapeHtml(cat)}</option>`).join('')}</select></label>
          <label>Question<textarea name="text" id="questionText" maxlength="1000" placeholder="What are you confused about?"></textarea></label>
          <div class="char-row"><span>Anonymous submission</span><span id="charCounter">0/1000</span></div>
          <div id="duplicateBox" class="duplicate-box"></div>
          <button class="primary-button" type="submit">Submit question</button>
        </form>
      </aside>

      <section>
        <div class="panel">
          <div class="controls-row">
            <input id="studentSearch" placeholder="Search questions" value="${escapeHtml(state.search)}" />
            <select id="studentFilter">
              ${filterOptions()}
            </select>
            <select id="studentSort">
              <option value="top" ${state.sort === 'top' ? 'selected' : ''}>Top voted</option>
              <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest</option>
              <option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>Oldest</option>
            </select>
          </div>
          <div class="status-bar"><span><span class="live-dot"></span>Auto-refresh on</span><span id="studentLastUpdated"></span></div>
        </div>
        <div id="studentQuestionList" class="question-list"></div>
        <div class="panel" style="margin-top:1rem;">
          <h2>Exit ticket</h2>
          <p class="muted">After class, quickly tell the professor how clear today felt.</p>
          <form id="exitTicketForm" class="stacked-form">
            <input type="hidden" name="sessionId" value="${escapeHtml(state.selectedSessionId)}" />
            <label>Understanding level</label>
            <div class="exit-ticket-scale">
              ${[1,2,3,4,5].map((n) => `<label><input type="radio" name="understanding" value="${n}" ${n === 3 ? 'checked' : ''}/> ${n}</label>`).join('')}
            </div>
            <label>What should be reviewed?<textarea name="reviewText" maxlength="800" placeholder="Optional"></textarea></label>
            <button class="secondary-button" type="submit">Send exit ticket</button>
          </form>
        </div>
      </section>
    </section>`;

  document.querySelector('#studentSessionSelect').addEventListener('change', async (event) => {
    state.selectedSessionId = event.target.value;
    await loadStudent(true);
  });
  document.querySelector('#studentSearch').addEventListener('input', (event) => { state.search = event.target.value; updateStudentDynamic(); });
  document.querySelector('#studentFilter').addEventListener('change', (event) => { state.filter = event.target.value; updateStudentDynamic(); });
  document.querySelector('#studentSort').addEventListener('change', (event) => { state.sort = event.target.value; updateStudentDynamic(); });

  const questionText = document.querySelector('#questionText');
  questionText.addEventListener('input', debounce(async () => {
    document.querySelector('#charCounter').textContent = `${questionText.value.length}/1000`;
    await checkDuplicates(questionText.value);
  }, 350));
  questionText.addEventListener('keyup', () => { document.querySelector('#charCounter').textContent = `${questionText.value.length}/1000`; });

  document.querySelector('#questionForm').addEventListener('submit', submitQuestion);
  document.querySelector('#exitTicketForm').addEventListener('submit', submitExitTicket);
  updateStudentDynamic();
}

function filterOptions() {
  const choices = [
    ['all', 'All visible'], ['open', 'Open'], ['answered', 'Answered'], ['new', 'New'], ['needs_answer', 'Needs answer'], ['saved', 'Saved'], ['skipped', 'Skipped'],
    ...state.config.categories.map((c) => [`category:${c}`, c])
  ];
  return choices.map(([value, label]) => `<option value="${escapeHtml(value)}" ${state.filter === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('');
}

function getVisibleQuestions() {
  let list = [...state.questions];
  const search = state.search.trim().toLowerCase();
  if (search) list = list.filter((q) => `${q.text} ${q.answerText} ${q.category} ${q.status}`.toLowerCase().includes(search));
  if (state.filter === 'open') list = list.filter((q) => q.status !== 'answered' && q.status !== 'skipped');
  else if (state.filter === 'answered') list = list.filter((q) => q.status === 'answered');
  else if (state.filter.startsWith('category:')) list = list.filter((q) => q.category === state.filter.slice(9));
  else if (state.filter !== 'all' && state.filter !== 'hidden') list = list.filter((q) => q.status === state.filter);
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (state.sort === 'newest') return new Date(b.createdAt) - new Date(a.createdAt);
    if (state.sort === 'oldest') return new Date(a.createdAt) - new Date(b.createdAt);
    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  return list;
}

function updateStudentDynamic() {
  const c = state.classroom;
  const pause = document.querySelector('#studentPauseBanner');
  if (pause) pause.innerHTML = c.acceptingQuestions ? '' : `<div class="paused-banner">${escapeHtml(c.pauseMessage)}</div>`;
  const last = document.querySelector('#studentLastUpdated');
  if (last) last.textContent = state.lastUpdated ? `Last updated ${state.lastUpdated.toLocaleTimeString()}` : '';
  const list = document.querySelector('#studentQuestionList');
  if (!list) return;
  const questions = getVisibleQuestions();
  list.innerHTML = questions.length ? questions.map((q) => questionCard(q, 'student')).join('') : `<div class="empty-state">No questions match this view yet.</div>`;
  list.querySelectorAll('[data-vote]').forEach((button) => button.addEventListener('click', () => voteQuestion(button.dataset.vote)));
  list.querySelectorAll('[data-react]').forEach((button) => button.addEventListener('click', () => reactQuestion(button.dataset.question, button.dataset.react)));
}

async function checkDuplicates(text) {
  const box = document.querySelector('#duplicateBox');
  if (!box) return;
  if (text.trim().length < 12) {
    box.classList.remove('show');
    box.innerHTML = '';
    return;
  }
  try {
    const data = await api(`/api/classes/${state.classroom.id}/duplicates?sessionId=${encodeURIComponent(state.selectedSessionId)}&text=${encodeURIComponent(text)}`);
    renderDuplicateBox(data.matches || []);
  } catch {
    box.classList.remove('show');
  }
}

function renderDuplicateBox(matches) {
  const box = document.querySelector('#duplicateBox');
  if (!box) return;
  if (!matches.length) {
    box.classList.remove('show');
    box.innerHTML = '';
    return;
  }
  box.classList.add('show');
  box.innerHTML = `<strong>This might already be asked.</strong><p class="muted">Click “I’m confused too” instead of making a duplicate, or submit anyway.</p>${matches.map((m) => `
    <div class="duplicate-match">
      <span>${escapeHtml(m.question.text)}</span>
      <button type="button" class="tiny-button" data-vote="${escapeHtml(m.question.id)}">I’m confused too (${m.question.voteCount})</button>
    </div>`).join('')}<button type="button" class="tiny-button" id="submitAnywayButton">Submit anyway</button>`;
  box.querySelectorAll('[data-vote]').forEach((button) => button.addEventListener('click', () => voteQuestion(button.dataset.vote)));
  box.querySelector('#submitAnywayButton')?.addEventListener('click', async () => {
    state.allowDuplicateText = document.querySelector('#questionText').value;
    document.querySelector('#questionForm').requestSubmit();
  });
}

async function submitQuestion(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const body = Object.fromEntries(new FormData(form).entries());
  body.anonId = anonId;
  body.allowDuplicate = state.allowDuplicateText && state.allowDuplicateText === body.text;
  button.disabled = true;
  try {
    await api(`/api/classes/${state.classroom.id}/questions`, { method: 'POST', body: JSON.stringify(body) });
    state.allowDuplicateText = '';
    form.reset();
    form.querySelector('[name="sessionId"]').value = state.selectedSessionId;
    document.querySelector('#charCounter').textContent = '0/1000';
    renderDuplicateBox([]);
    showToast('Question submitted anonymously.');
    await loadStudent(false);
  } catch (error) {
    if (error.status === 409 && error.data?.duplicate) {
      renderDuplicateBox(error.data.matches || []);
      showToast('Similar question found.');
    } else {
      showToast(error.message);
    }
  } finally {
    button.disabled = false;
  }
}

async function submitExitTicket(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = Object.fromEntries(new FormData(form).entries());
  body.anonId = anonId;
  try {
    await api(`/api/classes/${state.classroom.id}/exit-ticket`, { method: 'POST', body: JSON.stringify(body) });
    form.reset();
    form.querySelector('[value="3"]').checked = true;
    showToast('Exit ticket sent.');
  } catch (error) {
    showToast(error.message);
  }
}

async function voteQuestion(questionId) {
  try {
    await api(`/api/questions/${questionId}/vote`, { method: 'POST', body: JSON.stringify({ anonId }) });
    if (state.view === 'student') await loadStudent(false);
    if (state.view === 'professor') await loadProfessor(false);
  } catch (error) {
    showToast(error.message);
  }
}

async function reactQuestion(questionId, type) {
  try {
    await api(`/api/questions/${questionId}/react`, { method: 'POST', body: JSON.stringify({ anonId, type }) });
    if (state.view === 'student') await loadStudent(false);
  } catch (error) {
    showToast(error.message);
  }
}

async function renderProfessor(classId, token) {
  state.view = 'professor';
  state.professorToken = token;
  state.classroom = { id: classId };
  await loadProfessor(true);
  setTimer(() => loadProfessor(false));
}

async function loadProfessor(fullRender = false) {
  const classId = state.classroom?.id;
  if (!classId) return;
  const sessionId = state.selectedSessionId || '';
  const data = await api(`/api/professor/classes/${classId}?token=${encodeURIComponent(state.professorToken)}&sessionId=${encodeURIComponent(sessionId)}`);
  state.classroom = data.classroom;
  state.questions = data.questions;
  state.stats = data.stats;
  state.summary = data.summary;
  state.exitTickets = data.exitTickets || [];
  state.lastUpdated = new Date();
  if (!state.selectedSessionId) state.selectedSessionId = data.classroom.currentSessionId;
  if (fullRender || !state.professorLoadedOnce) {
    state.professorLoadedOnce = true;
    drawProfessor();
  } else {
    updateProfessorDynamic();
  }
}

function drawProfessor() {
  const c = state.classroom;
  const studentUrl = absoluteUrl(`/#/join/${c.joinCode}`);
  const presentationUrl = absoluteUrl(`/#/present/${c.id}/${c.adminToken}`);
  const sessionOptions = `<option value="">All sessions</option>` + c.sessions.map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === state.selectedSessionId ? 'selected' : ''}>${escapeHtml(s.title)}${s.isActive ? '' : ' (ended)'}</option>`).join('');
  app.innerHTML = `
    <section class="board-header">
      <div class="board-top">
        <div class="board-title">
          <p class="eyebrow">Professor dashboard</p>
          <h1>${escapeHtml(c.title)}</h1>
          <div class="board-meta">
            <span class="pill">Code: ${escapeHtml(c.joinCode)}</span>
            ${c.course ? `<span class="pill">${escapeHtml(c.course)}</span>` : ''}
            <span class="pill">${escapeHtml(c.professorName)}</span>
          </div>
        </div>
        <div class="controls-row" style="justify-content:flex-end;">
          <a class="secondary-button" href="${escapeHtml(`/#/present/${c.id}/${c.adminToken}`)}" target="_blank">Presentation mode</a>
          <a class="ghost-button" href="${escapeHtml(`/#/join/${c.joinCode}`)}" target="_blank">Student view</a>
        </div>
      </div>
    </section>

    <section class="stats-grid" id="statsGrid"></section>

    <section class="grid" style="margin-top:1rem;">
      <aside class="panel">
        <h2>Share with students</h2>
        <div class="qr-card">
          <img src="${qrUrl(studentUrl)}" alt="QR code for student join link" />
          <strong>Scan to join</strong>
          <span class="muted">${escapeHtml(studentUrl)}</span>
        </div>
        <div class="copy-row" style="margin-top:0.8rem;"><input id="studentLinkInput" value="${escapeHtml(studentUrl)}" readonly /><button class="tiny-button" id="copyStudentLink">Copy</button></div>
        <div class="copy-row" style="margin-top:0.6rem;"><input value="${escapeHtml(presentationUrl)}" readonly /><button class="tiny-button" id="copyPresentLink">Copy</button></div>
        <hr />
        <h2>Session mode</h2>
        <label>Viewing<select id="profSessionSelect">${sessionOptions}</select></label>
        <form id="sessionForm" class="code-form" style="margin-top:0.7rem;"><input name="title" placeholder="New session title" /><button class="secondary-button">Start</button></form>
        <div id="sessionControls" class="details-list" style="margin-top:0.8rem;"></div>
        <hr />
        <h2>Safety settings</h2>
        <form id="settingsForm" class="stacked-form">
          <label><span>Submissions</span><select name="acceptingQuestions"><option value="true">Open</option><option value="false">Paused</option></select></label>
          <label>Pause message<input name="pauseMessage" maxlength="240" value="${escapeHtml(c.pauseMessage)}" /></label>
          <label>Blocked words <textarea name="blockedWords" placeholder="One word per line">${escapeHtml((c.blockedWords || []).join('\n'))}</textarea></label>
          <button class="primary-button" type="submit">Save settings</button>
        </form>
      </aside>

      <section>
        <div class="panel">
          <div class="controls-row">
            <input id="profSearch" placeholder="Search questions" value="${escapeHtml(state.search)}" />
            <select id="profFilter">${filterOptions()}<option value="hidden" ${state.filter === 'hidden' ? 'selected' : ''}>Hidden</option></select>
            <select id="profSort">
              <option value="top" ${state.sort === 'top' ? 'selected' : ''}>Top voted</option>
              <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest</option>
              <option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>Oldest</option>
            </select>
          </div>
          <div class="status-bar"><span><span class="live-dot"></span>Auto-refresh on</span><span id="profLastUpdated"></span></div>
          <div class="controls-row">
            <a class="ghost-button" href="/api/professor/classes/${c.id}/export.csv?token=${encodeURIComponent(c.adminToken)}&sessionId=${encodeURIComponent(state.selectedSessionId || '')}" target="_blank">Export CSV</a>
            <a class="ghost-button" href="/api/professor/classes/${c.id}/report.txt?token=${encodeURIComponent(c.adminToken)}&sessionId=${encodeURIComponent(state.selectedSessionId || '')}" target="_blank">Export report</a>
            <button class="secondary-button" id="refreshSummaryButton">Refresh smart summary</button>
          </div>
        </div>

        <div class="grid-wide" style="margin-top:1rem;">
          <div class="panel"><h2>Smart confusion summary</h2><div id="summaryBox"></div></div>
          <div class="panel"><h2>Exit tickets</h2><div id="exitTicketsBox"></div></div>
        </div>

        <div id="profQuestionList" class="question-list" style="margin-top:1rem;"></div>
      </section>
    </section>`;

  document.querySelector('[name="acceptingQuestions"]').value = String(c.acceptingQuestions);
  document.querySelector('#copyStudentLink').addEventListener('click', () => copyText(studentUrl));
  document.querySelector('#copyPresentLink').addEventListener('click', () => copyText(presentationUrl));
  document.querySelector('#profSessionSelect').addEventListener('change', async (event) => {
    state.selectedSessionId = event.target.value;
    await loadProfessor(true);
  });
  document.querySelector('#profSearch').addEventListener('input', (event) => { state.search = event.target.value; updateProfessorDynamic(); });
  document.querySelector('#profFilter').addEventListener('change', (event) => { state.filter = event.target.value; updateProfessorDynamic(); });
  document.querySelector('#profSort').addEventListener('change', (event) => { state.sort = event.target.value; updateProfessorDynamic(); });
  document.querySelector('#sessionForm').addEventListener('submit', createSession);
  document.querySelector('#settingsForm').addEventListener('submit', saveSettings);
  document.querySelector('#refreshSummaryButton').addEventListener('click', async () => { await loadProfessor(false); showToast('Summary refreshed.'); });
  updateProfessorDynamic();
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => showToast('Copied.'), () => showToast('Copy failed. Select and copy manually.'));
}

async function createSession(event) {
  event.preventDefault();
  const title = new FormData(event.currentTarget).get('title').toString().trim();
  if (!title) return showToast('Enter a session title.');
  try {
    await api(`/api/professor/classes/${state.classroom.id}/sessions?token=${encodeURIComponent(state.professorToken)}`, { method: 'POST', body: JSON.stringify({ title }) });
    state.selectedSessionId = '';
    showToast('Session started.');
    await loadProfessor(true);
  } catch (error) {
    showToast(error.message);
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = {
    acceptingQuestions: form.get('acceptingQuestions') === 'true',
    pauseMessage: form.get('pauseMessage').toString(),
    blockedWords: form.get('blockedWords').toString().split(/\n|,/).map((w) => w.trim()).filter(Boolean)
  };
  try {
    await api(`/api/professor/classes/${state.classroom.id}/settings?token=${encodeURIComponent(state.professorToken)}`, { method: 'PATCH', body: JSON.stringify(body) });
    showToast('Settings saved.');
    await loadProfessor(false);
  } catch (error) {
    showToast(error.message);
  }
}

function updateProfessorDynamic() {
  updateStats();
  updateSummary();
  updateExitTickets();
  updateSessionControls();
  const last = document.querySelector('#profLastUpdated');
  if (last) last.textContent = state.lastUpdated ? `Last updated ${state.lastUpdated.toLocaleTimeString()}` : '';
  const list = document.querySelector('#profQuestionList');
  if (!list) return;
  const questions = getVisibleQuestions().filter((q) => state.filter === 'hidden' ? q.hidden : true);
  list.innerHTML = questions.length ? questions.map((q) => questionCard(q, 'professor')).join('') : `<div class="empty-state">No questions match this view.</div>`;
  wireProfessorButtons(list);
}

function updateStats() {
  const grid = document.querySelector('#statsGrid');
  if (!grid || !state.stats) return;
  const s = state.stats;
  grid.innerHTML = [
    ['Questions', s.totalQuestions], ['Open', s.openQuestions], ['Answered', s.answeredQuestions], ['Same question votes', s.totalVotes],
    ['Exit tickets', s.exitTickets], ['Avg understanding', s.avgUnderstanding ?? 'n/a'], ['Hidden', s.hiddenQuestions], ['Sessions', state.classroom.sessions.length]
  ].map(([label, value]) => `<div class="stat-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`).join('');
}

function updateSummary() {
  const box = document.querySelector('#summaryBox');
  if (!box || !state.summary) return;
  box.innerHTML = `
    <ul class="summary-list">${state.summary.summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
    ${state.summary.clusters?.length ? `<h3>Top clusters</h3><div class="details-list">${state.summary.clusters.map((cluster) => `<div class="detail-item"><strong>${escapeHtml(cluster.label)}</strong><span class="muted">${cluster.count} related · ${cluster.votes} same-question votes</span></div>`).join('')}</div>` : ''}
    ${state.summary.needsReview?.length ? `<h3>Review requests</h3><div class="details-list">${state.summary.needsReview.map((item) => `<div class="detail-item"><strong>${escapeHtml(item.understanding)}/5</strong>${escapeHtml(item.reviewText)}</div>`).join('')}</div>` : ''}
    <p class="muted">${escapeHtml(state.summary.note)}</p>`;
}

function updateExitTickets() {
  const box = document.querySelector('#exitTicketsBox');
  if (!box) return;
  if (!state.exitTickets.length) {
    box.innerHTML = '<div class="empty-state">No exit tickets yet.</div>';
    return;
  }
  box.innerHTML = `<div class="details-list">${state.exitTickets.slice(0, 10).map((t) => `<div class="detail-item"><strong>${escapeHtml(t.understanding)}/5 · ${formatTime(t.createdAt)}</strong><span>${escapeHtml(t.reviewText || 'No review note')}</span></div>`).join('')}</div>`;
}

function updateSessionControls() {
  const box = document.querySelector('#sessionControls');
  if (!box) return;
  const selected = state.classroom.sessions.find((s) => s.id === state.selectedSessionId) || state.classroom.sessions.find((s) => s.id === state.classroom.currentSessionId);
  if (!selected) {
    box.innerHTML = '<p class="muted">Viewing all sessions.</p>';
    return;
  }
  box.innerHTML = `<div class="detail-item"><strong>${escapeHtml(selected.title)}</strong><span class="muted">${selected.isActive ? 'Active' : 'Ended'} · ${formatTime(selected.createdAt)}</span><div class="prof-actions"><button class="tiny-button" data-session-current="${escapeHtml(selected.id)}">Make current</button><button class="tiny-button" data-session-toggle="${escapeHtml(selected.id)}" data-active="${selected.isActive}">${selected.isActive ? 'End session' : 'Reopen session'}</button></div></div>`;
  box.querySelector('[data-session-current]')?.addEventListener('click', async (event) => patchSession(event.target.dataset.sessionCurrent, { makeCurrent: true }));
  box.querySelector('[data-session-toggle]')?.addEventListener('click', async (event) => patchSession(event.target.dataset.sessionToggle, { isActive: event.target.dataset.active !== 'true' }));
}

async function patchSession(sessionId, body) {
  try {
    await api(`/api/professor/sessions/${sessionId}?token=${encodeURIComponent(state.professorToken)}`, { method: 'PATCH', body: JSON.stringify(body) });
    showToast('Session updated.');
    await loadProfessor(true);
  } catch (error) {
    showToast(error.message);
  }
}

function wireProfessorButtons(root) {
  root.querySelectorAll('[data-prof-action]').forEach((button) => button.addEventListener('click', async () => {
    const qid = button.dataset.question;
    const action = button.dataset.profAction;
    const question = state.questions.find((q) => q.id === qid);
    if (!question) return;
    const body = {};
    if (action === 'pin') body.pinned = !question.pinned;
    if (action === 'hide') body.hidden = !question.hidden;
    if (action === 'status') body.status = button.dataset.status;
    await patchQuestion(qid, body);
  }));
  root.querySelectorAll('[data-status-select]').forEach((select) => select.addEventListener('change', () => patchQuestion(select.dataset.statusSelect, { status: select.value })));
  root.querySelectorAll('[data-save-answer]').forEach((button) => button.addEventListener('click', () => {
    const qid = button.dataset.saveAnswer;
    const textarea = root.querySelector(`[data-answer-text="${qid}"]`);
    patchQuestion(qid, { answerText: textarea.value });
  }));
}

async function patchQuestion(questionId, body) {
  try {
    await api(`/api/professor/questions/${questionId}?token=${encodeURIComponent(state.professorToken)}`, { method: 'PATCH', body: JSON.stringify(body) });
    await loadProfessor(false);
  } catch (error) {
    showToast(error.message);
  }
}

function questionCard(q, mode) {
  const isProfessor = mode === 'professor';
  const answer = q.answerText ? `<div class="answer-box"><strong>Professor answer:</strong><div>${escapeHtml(q.answerText)}</div>${mode === 'student' ? reactionsHtml(q) : ''}</div>` : '';
  const flags = q.moderationFlags?.length ? q.moderationFlags.map((f) => `<span class="tag">Flag: ${escapeHtml(f)}</span>`).join('') : '';
  return `<article class="question-card ${q.hidden ? 'hidden' : ''} ${q.status === 'answered' ? 'answered' : ''}" data-qid="${escapeHtml(q.id)}">
    <div class="question-main">
      <button class="vote-button ${q.myVote ? 'active' : ''}" ${isProfessor ? 'disabled' : ''} data-vote="${escapeHtml(q.id)}"><strong>${q.voteCount}</strong><span>I’m confused too</span></button>
      <div>
        <p class="question-text">${escapeHtml(q.text)}</p>
        <div class="tags">
          ${q.pinned ? '<span class="tag">Pinned</span>' : ''}
          ${q.hidden ? '<span class="tag">Hidden</span>' : ''}
          <span class="tag">${escapeHtml(q.category)}</span>
          <span class="tag status-${escapeHtml(q.status)}">${statusLabel(q.status)}</span>
          <span class="tag">${formatTime(q.createdAt)}</span>
          ${flags}
        </div>
        ${answer}
        ${isProfessor ? professorQuestionControls(q) : ''}
      </div>
    </div>
  </article>`;
}

function reactionsHtml(q) {
  const labels = { got_it: 'Got it', still_confused: 'Still confused', need_example: 'Need example' };
  return `<div class="reactions">${Object.entries(labels).map(([type, label]) => `<button class="tiny-button ${q.myReaction === type ? 'active' : ''}" data-question="${escapeHtml(q.id)}" data-react="${type}">${label} (${q.reactionCounts?.[type] || 0})</button>`).join('')}</div>`;
}

function professorQuestionControls(q) {
  return `<div class="prof-actions">
      <button class="tiny-button" data-prof-action="pin" data-question="${escapeHtml(q.id)}">${q.pinned ? 'Unpin' : 'Pin'}</button>
      <button class="tiny-button" data-prof-action="hide" data-question="${escapeHtml(q.id)}">${q.hidden ? 'Unhide' : 'Hide'}</button>
      <select data-status-select="${escapeHtml(q.id)}">${state.config.statuses.map((s) => `<option value="${s}" ${s === q.status ? 'selected' : ''}>${statusLabel(s)}</option>`).join('')}</select>
    </div>
    <div class="answer-edit">
      <textarea data-answer-text="${escapeHtml(q.id)}" placeholder="Write a public professor answer">${escapeHtml(q.answerText || '')}</textarea>
      <div class="controls-row"><button class="secondary-button" data-save-answer="${escapeHtml(q.id)}">Save public answer</button><span class="muted">Reactions: Got it ${q.reactionCounts.got_it}, Still confused ${q.reactionCounts.still_confused}, Need example ${q.reactionCounts.need_example}</span></div>
      ${q.answerHistory?.length ? `<details><summary>Answer history (${q.answerHistory.length})</summary><div class="details-list">${q.answerHistory.slice().reverse().map((a) => `<div class="detail-item"><strong>${formatTime(a.createdAt)}</strong>${escapeHtml(a.text)}</div>`).join('')}</div></details>` : ''}
    </div>`;
}

function statusLabel(status) {
  return ({ new: 'New', needs_answer: 'Needs answer', answered: 'Answered', skipped: 'Skipped', saved: 'Saved for later' })[status] || status;
}

async function renderPresentation(classId, token) {
  state.view = 'presentation';
  state.professorToken = token;
  state.classroom = { id: classId };
  setPresentationMode(true);
  await loadPresentation(true);
  setTimer(() => loadPresentation(false));
}

async function loadPresentation(fullRender = false) {
  const data = await api(`/api/professor/classes/${state.classroom.id}?token=${encodeURIComponent(state.professorToken)}&sessionId=${encodeURIComponent(state.selectedSessionId || '')}`);
  state.classroom = data.classroom;
  state.questions = data.questions.filter((q) => !q.hidden);
  state.stats = data.stats;
  state.lastUpdated = new Date();
  drawPresentation();
}

function drawPresentation() {
  const c = state.classroom;
  const top = [...state.questions]
    .filter((q) => q.status !== 'skipped')
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.status !== 'answered' && b.status === 'answered') return -1;
      if (a.status === 'answered' && b.status !== 'answered') return 1;
      if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
      return new Date(b.createdAt) - new Date(a.createdAt);
    })
    .slice(0, 6);
  app.innerHTML = `<section class="presentation">
    <div class="presentation-header">
      <div><p class="eyebrow">Live presentation mode</p><h1>${escapeHtml(c.title)}</h1><p>${escapeHtml(c.course || '')} · Code ${escapeHtml(c.joinCode)}</p></div>
      <div class="controls-row"><button class="secondary-button" id="fullScreenButton">Full screen</button><a class="ghost-button" style="color:white;border-color:rgba(255,255,255,.3)" href="/#/professor/${c.id}/${c.adminToken}">Dashboard</a></div>
    </div>
    <div class="status-bar" style="color:rgba(255,255,255,.7)"><span><span class="live-dot"></span>Live</span><span>${state.lastUpdated ? `Updated ${state.lastUpdated.toLocaleTimeString()}` : ''}</span></div>
    <div class="question-list">${top.length ? top.map((q) => questionCard(q, 'present')).join('') : '<div class="empty-state">No questions yet.</div>'}</div>
  </section>`;
  document.querySelector('#fullScreenButton')?.addEventListener('click', () => document.documentElement.requestFullscreen?.());
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

init();
