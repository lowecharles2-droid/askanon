const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const APP_NAME = process.env.APP_NAME || 'AskAnon';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'app.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

const CATEGORY_OPTIONS = ['Confused', 'Homework', 'Exam', 'Clarification', 'Discussion', 'Technical issue', 'Other'];
const STATUS_OPTIONS = ['new', 'needs_answer', 'answered', 'skipped', 'saved'];
const REACTION_OPTIONS = ['got_it', 'still_confused', 'need_example'];
const DEFAULT_BLOCKED_WORDS = [
  'spamlink',
  'badword',
  'slur',
  'offensive'
];

const defaultDatabase = {
  version: 2,
  classes: [],
  sessions: [],
  questions: [],
  votes: [],
  reactions: [],
  exitTickets: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function generateJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function safeText(value, max = 1000) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeDatabase(parsed) {
  const database = { ...clone(defaultDatabase), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  database.classes = Array.isArray(database.classes) ? database.classes : [];
  database.sessions = Array.isArray(database.sessions) ? database.sessions : [];
  database.questions = Array.isArray(database.questions) ? database.questions : [];
  database.votes = Array.isArray(database.votes) ? database.votes : [];
  database.reactions = Array.isArray(database.reactions) ? database.reactions : [];
  database.exitTickets = Array.isArray(database.exitTickets) ? database.exitTickets : [];

  database.classes = database.classes.map((classroom) => {
    const createdAt = classroom.createdAt || now();
    return {
      id: classroom.id || id('class'),
      title: safeText(classroom.title || classroom.name || 'Untitled class', 120),
      course: safeText(classroom.course || '', 120),
      professorName: safeText(classroom.professorName || classroom.teacher || 'Professor', 120),
      joinCode: safeText(classroom.joinCode || generateJoinCode(), 10).toUpperCase(),
      adminToken: classroom.adminToken || id('adm'),
      passwordSalt: classroom.passwordSalt || '',
      passwordHash: classroom.passwordHash || '',
      acceptingQuestions: classroom.acceptingQuestions !== false,
      pauseMessage: safeText(classroom.pauseMessage || 'Questions are paused while the professor is answering.', 240),
      blockedWords: Array.isArray(classroom.blockedWords) ? classroom.blockedWords.map((w) => safeText(w, 50)).filter(Boolean) : [],
      currentSessionId: classroom.currentSessionId || null,
      createdAt,
      updatedAt: classroom.updatedAt || createdAt
    };
  });

  database.sessions = database.sessions.map((session) => {
    const createdAt = session.createdAt || now();
    return {
      id: session.id || id('session'),
      classId: session.classId,
      title: safeText(session.title || 'Class session', 120),
      isActive: session.isActive !== false,
      createdAt,
      endedAt: session.endedAt || null,
      updatedAt: session.updatedAt || createdAt
    };
  }).filter((session) => database.classes.some((c) => c.id === session.classId));

  for (const classroom of database.classes) {
    const hasSession = database.sessions.some((s) => s.classId === classroom.id);
    if (!hasSession) {
      const session = {
        id: id('session'),
        classId: classroom.id,
        title: 'General questions',
        isActive: true,
        createdAt: classroom.createdAt,
        endedAt: null,
        updatedAt: classroom.createdAt
      };
      database.sessions.push(session);
      classroom.currentSessionId = classroom.currentSessionId || session.id;
    }
    if (!database.sessions.some((s) => s.id === classroom.currentSessionId && s.classId === classroom.id)) {
      classroom.currentSessionId = database.sessions.find((s) => s.classId === classroom.id)?.id || null;
    }
  }

  database.questions = database.questions.map((question) => {
    const createdAt = question.createdAt || now();
    const status = STATUS_OPTIONS.includes(question.status) ? question.status : (question.answered ? 'answered' : 'new');
    return {
      id: question.id || id('q'),
      classId: question.classId,
      sessionId: question.sessionId || database.classes.find((c) => c.id === question.classId)?.currentSessionId || null,
      text: safeText(question.text || '', 1000),
      category: CATEGORY_OPTIONS.includes(question.category) ? question.category : 'Other',
      status,
      pinned: Boolean(question.pinned),
      hidden: Boolean(question.hidden),
      answerText: safeText(question.answerText || '', 2000),
      answerHistory: Array.isArray(question.answerHistory) ? question.answerHistory : [],
      moderationFlags: Array.isArray(question.moderationFlags) ? question.moderationFlags : [],
      createdAt,
      updatedAt: question.updatedAt || createdAt
    };
  }).filter((question) => question.classId && question.text && database.classes.some((c) => c.id === question.classId));

  database.votes = database.votes.map((vote) => ({
    questionId: vote.questionId,
    voterId: safeText(vote.voterId || 'unknown', 80),
    createdAt: vote.createdAt || now()
  })).filter((vote) => database.questions.some((q) => q.id === vote.questionId));

  database.reactions = database.reactions.map((reaction) => ({
    questionId: reaction.questionId,
    anonId: safeText(reaction.anonId || 'unknown', 80),
    type: REACTION_OPTIONS.includes(reaction.type) ? reaction.type : 'got_it',
    createdAt: reaction.createdAt || now()
  })).filter((reaction) => database.questions.some((q) => q.id === reaction.questionId));

  database.exitTickets = database.exitTickets.map((ticket) => ({
    id: ticket.id || id('ticket'),
    classId: ticket.classId,
    sessionId: ticket.sessionId || null,
    anonId: safeText(ticket.anonId || 'unknown', 80),
    understanding: Math.max(1, Math.min(5, Number(ticket.understanding) || 3)),
    reviewText: safeText(ticket.reviewText || '', 800),
    createdAt: ticket.createdAt || now()
  })).filter((ticket) => database.classes.some((c) => c.id === ticket.classId));

  return database;
}

function readDatabase() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDatabase, null, 2));
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return normalizeDatabase(parsed);
  } catch (error) {
    const backup = `${DATA_FILE}.broken-${Date.now()}`;
    if (fs.existsSync(DATA_FILE)) fs.copyFileSync(DATA_FILE, backup);
    fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDatabase, null, 2));
    return clone(defaultDatabase);
  }
}

function writeDatabase(database) {
  const normalized = normalizeDatabase(database);
  const temp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(normalized, null, 2));
  fs.renameSync(temp, DATA_FILE);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  const actual = hashPassword(password, salt).hash;
  const a = Buffer.from(actual, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, value, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(value),
    'Cache-Control': 'no-store'
  });
  res.end(value);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large.'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function getToken(req, url) {
  return req.headers.authorization?.replace(/^Bearer\s+/i, '') || url.searchParams.get('token') || '';
}

function requireClass(database, classId) {
  return database.classes.find((classroom) => classroom.id === classId) || null;
}

function requireAdmin(req, url, database, classId) {
  const classroom = requireClass(database, classId);
  if (!classroom) return { error: 'Class not found.', status: 404 };
  const token = getToken(req, url);
  if (!token || token !== classroom.adminToken) return { error: 'Professor access required.', status: 401 };
  return { classroom };
}

function serializeClassroom(database, classroom, includeAdmin = false) {
  const sessions = database.sessions
    .filter((session) => session.classId === classroom.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const publicData = {
    id: classroom.id,
    title: classroom.title,
    course: classroom.course,
    professorName: classroom.professorName,
    joinCode: classroom.joinCode,
    acceptingQuestions: classroom.acceptingQuestions,
    pauseMessage: classroom.pauseMessage,
    currentSessionId: classroom.currentSessionId,
    sessions,
    urls: buildUrls(classroom)
  };
  if (includeAdmin) {
    return {
      ...publicData,
      adminToken: classroom.adminToken,
      blockedWords: classroom.blockedWords,
      createdAt: classroom.createdAt,
      updatedAt: classroom.updatedAt
    };
  }
  return publicData;
}

function buildUrls(classroom) {
  return {
    studentPath: `/#/join/${classroom.joinCode}`,
    professorPath: `/#/professor/${classroom.id}/${classroom.adminToken}`,
    presentationPath: `/#/present/${classroom.id}/${classroom.adminToken}`
  };
}

function questionVoteCount(database, questionId) {
  return database.votes.filter((vote) => vote.questionId === questionId).length;
}

function reactionCounts(database, questionId) {
  const counts = { got_it: 0, still_confused: 0, need_example: 0 };
  for (const reaction of database.reactions.filter((r) => r.questionId === questionId)) {
    counts[reaction.type] = (counts[reaction.type] || 0) + 1;
  }
  return counts;
}

function serializeQuestion(database, question, includeHidden = false, anonId = '') {
  if (!includeHidden && question.hidden) return null;
  const myVote = anonId ? database.votes.some((vote) => vote.questionId === question.id && vote.voterId === anonId) : false;
  const myReaction = anonId ? database.reactions.find((reaction) => reaction.questionId === question.id && reaction.anonId === anonId)?.type || null : null;
  return {
    ...question,
    voteCount: questionVoteCount(database, question.id),
    reactionCounts: reactionCounts(database, question.id),
    myVote,
    myReaction
  };
}

function filterQuestions(database, classId, options = {}) {
  const { includeHidden = false, sessionId = '', anonId = '' } = options;
  return database.questions
    .filter((question) => question.classId === classId)
    .filter((question) => !sessionId || question.sessionId === sessionId)
    .map((question) => serializeQuestion(database, question, includeHidden, anonId))
    .filter(Boolean)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.status !== 'answered' && b.status === 'answered') return -1;
      if (a.status === 'answered' && b.status !== 'answered') return 1;
      if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
}

function tokenize(text) {
  const stop = new Set(['the', 'and', 'for', 'that', 'this', 'with', 'you', 'are', 'was', 'were', 'what', 'when', 'where', 'why', 'how', 'does', 'into', 'from', 'about', 'have', 'has', 'can', 'could', 'would', 'should', 'there', 'their', 'they', 'them', 'then', 'than', 'will', 'just', 'like', 'also', 'because', 'please']);
  return safeText(text, 1200)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !stop.has(word));
}

function similarity(a, b) {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let intersection = 0;
  for (const token of aSet) if (bSet.has(token)) intersection += 1;
  const union = new Set([...aSet, ...bSet]).size;
  const jaccard = intersection / union;
  const overlap = intersection / Math.min(aSet.size, bSet.size);
  return Number(Math.max(jaccard, overlap * 0.78).toFixed(3));
}

function findDuplicates(database, classId, sessionId, text) {
  return database.questions
    .filter((question) => question.classId === classId && !question.hidden)
    .filter((question) => !sessionId || question.sessionId === sessionId)
    .map((question) => ({
      question: serializeQuestion(database, question, true),
      score: similarity(text, question.text)
    }))
    .filter((match) => match.score >= 0.30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function moderationFlags(classroom, text) {
  const flags = [];
  const lower = text.toLowerCase();
  const blocked = [...DEFAULT_BLOCKED_WORDS, ...(classroom.blockedWords || [])].map((word) => word.toLowerCase()).filter(Boolean);
  for (const word of blocked) {
    if (word.length >= 2 && lower.includes(word)) flags.push(`Blocked word: ${word}`);
  }
  const links = lower.match(/https?:\/\/|www\.|\.com|\.net|\.org/g) || [];
  if (links.length >= 2) flags.push('Possible spam links');
  if (/(.)\1{9,}/.test(lower)) flags.push('Repeated characters');
  if (text.length < 4) flags.push('Too short');
  return [...new Set(flags)].slice(0, 5);
}

function classStats(database, classId, sessionId = '') {
  const questions = database.questions.filter((q) => q.classId === classId && (!sessionId || q.sessionId === sessionId));
  const visible = questions.filter((q) => !q.hidden);
  const answered = visible.filter((q) => q.status === 'answered').length;
  const open = visible.filter((q) => q.status !== 'answered' && q.status !== 'skipped').length;
  const hidden = questions.filter((q) => q.hidden).length;
  const exitTickets = database.exitTickets.filter((t) => t.classId === classId && (!sessionId || t.sessionId === sessionId));
  const avgUnderstanding = exitTickets.length ? Number((exitTickets.reduce((sum, t) => sum + t.understanding, 0) / exitTickets.length).toFixed(2)) : null;
  const categories = {};
  for (const question of visible) categories[question.category] = (categories[question.category] || 0) + 1;
  return {
    totalQuestions: visible.length,
    openQuestions: open,
    answeredQuestions: answered,
    hiddenQuestions: hidden,
    totalVotes: visible.reduce((sum, q) => sum + questionVoteCount(database, q.id), 0),
    exitTickets: exitTickets.length,
    avgUnderstanding,
    categories
  };
}

function smartSummary(database, classId, sessionId = '') {
  const questions = filterQuestions(database, classId, { includeHidden: false, sessionId });
  const open = questions.filter((q) => q.status !== 'answered' && q.status !== 'skipped');
  const answered = questions.filter((q) => q.status === 'answered');
  const tickets = database.exitTickets.filter((t) => t.classId === classId && (!sessionId || t.sessionId === sessionId));

  const tokenMap = new Map();
  for (const q of questions) {
    const weight = 1 + q.voteCount;
    for (const token of tokenize(q.text)) {
      tokenMap.set(token, (tokenMap.get(token) || 0) + weight);
    }
  }
  const keywords = [...tokenMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([word, score]) => ({ word, score }));

  const clusters = [];
  const used = new Set();
  for (const question of open) {
    if (used.has(question.id)) continue;
    const cluster = [question];
    used.add(question.id);
    for (const other of open) {
      if (!used.has(other.id) && similarity(question.text, other.text) >= 0.36) {
        cluster.push(other);
        used.add(other.id);
      }
    }
    clusters.push({
      label: cluster[0].text,
      count: cluster.length,
      votes: cluster.reduce((sum, q) => sum + q.voteCount, 0),
      examples: cluster.slice(0, 3).map((q) => q.text)
    });
  }
  clusters.sort((a, b) => (b.count + b.votes) - (a.count + a.votes));

  const needsReview = tickets
    .filter((ticket) => ticket.reviewText)
    .sort((a, b) => a.understanding - b.understanding || new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5)
    .map((ticket) => ({ understanding: ticket.understanding, reviewText: ticket.reviewText, createdAt: ticket.createdAt }));

  const summaryLines = [];
  if (!questions.length) {
    summaryLines.push('No questions have been submitted yet.');
  } else {
    summaryLines.push(`${open.length} open question${open.length === 1 ? '' : 's'} and ${answered.length} answered question${answered.length === 1 ? '' : 's'} in this view.`);
    if (clusters[0]) summaryLines.push(`Biggest confusion cluster: “${clusters[0].label}” (${clusters[0].count} related question${clusters[0].count === 1 ? '' : 's'}, ${clusters[0].votes} same-question vote${clusters[0].votes === 1 ? '' : 's'}).`);
    if (keywords.length) summaryLines.push(`Common keywords: ${keywords.map((k) => k.word).join(', ')}.`);
  }
  if (tickets.length) {
    const avg = tickets.reduce((sum, t) => sum + t.understanding, 0) / tickets.length;
    summaryLines.push(`Exit tickets average understanding: ${avg.toFixed(1)}/5 from ${tickets.length} response${tickets.length === 1 ? '' : 's'}.`);
  }

  return {
    generatedAt: now(),
    note: 'This is a local smart summary based on question text, categories, votes, and exit tickets. It does not send data to an AI API.',
    summaryLines,
    keywords,
    clusters: clusters.slice(0, 5),
    needsReview
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsv(database, classId, sessionId = '') {
  const questions = filterQuestions(database, classId, { includeHidden: true, sessionId });
  const rows = [
    ['createdAt', 'session', 'category', 'status', 'pinned', 'hidden', 'votes', 'question', 'professorAnswer', 'gotIt', 'stillConfused', 'needExample']
  ];
  for (const q of questions) {
    const session = database.sessions.find((s) => s.id === q.sessionId);
    rows.push([
      q.createdAt,
      session?.title || '',
      q.category,
      q.status,
      q.pinned,
      q.hidden,
      q.voteCount,
      q.text,
      q.answerText,
      q.reactionCounts.got_it,
      q.reactionCounts.still_confused,
      q.reactionCounts.need_example
    ]);
  }
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function buildTextReport(database, classroom, sessionId = '') {
  const session = database.sessions.find((s) => s.id === sessionId);
  const stats = classStats(database, classroom.id, sessionId);
  const summary = smartSummary(database, classroom.id, sessionId);
  const topQuestions = filterQuestions(database, classroom.id, { includeHidden: false, sessionId }).slice(0, 8);
  const lines = [];
  lines.push(`${APP_NAME} Class Report`);
  lines.push(`Class: ${classroom.title}${classroom.course ? ` (${classroom.course})` : ''}`);
  lines.push(`Professor: ${classroom.professorName}`);
  lines.push(`Session: ${session?.title || 'All sessions'}`);
  lines.push(`Generated: ${now()}`);
  lines.push('');
  lines.push('Stats');
  lines.push(`- Questions: ${stats.totalQuestions}`);
  lines.push(`- Open: ${stats.openQuestions}`);
  lines.push(`- Answered: ${stats.answeredQuestions}`);
  lines.push(`- Same-question votes: ${stats.totalVotes}`);
  lines.push(`- Exit tickets: ${stats.exitTickets}`);
  lines.push(`- Average understanding: ${stats.avgUnderstanding ?? 'n/a'}`);
  lines.push('');
  lines.push('Smart Summary');
  for (const line of summary.summaryLines) lines.push(`- ${line}`);
  lines.push('');
  lines.push('Top Questions');
  for (const question of topQuestions) {
    lines.push(`- [${question.status}] (${question.voteCount} votes) ${question.text}`);
    if (question.answerText) lines.push(`  Answer: ${question.answerText}`);
  }
  return `${lines.join('\n')}\n`;
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'Forbidden.');
  if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  } else {
    filePath = normalized;
  }
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  };
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  res.end(body);
}

async function handleApi(req, res, url) {
  const database = readDatabase();
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, app: APP_NAME, time: now() });
  }

  if (method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, { appName: APP_NAME, categories: CATEGORY_OPTIONS, statuses: STATUS_OPTIONS, reactions: REACTION_OPTIONS });
  }

  if (method === 'POST' && pathname === '/api/classes') {
    const body = await readBody(req);
    const title = safeText(body.title, 120);
    const course = safeText(body.course, 120);
    const professorName = safeText(body.professorName || 'Professor', 120);
    const password = String(body.password || '');
    if (!title) return sendError(res, 400, 'Class title is required.');
    if (password.length < 6) return sendError(res, 400, 'Professor password must be at least 6 characters.');

    let joinCode = generateJoinCode();
    while (database.classes.some((c) => c.joinCode === joinCode)) joinCode = generateJoinCode();
    const createdAt = now();
    const { salt, hash } = hashPassword(password);
    const classroom = {
      id: id('class'),
      title,
      course,
      professorName,
      joinCode,
      adminToken: id('adm'),
      passwordSalt: salt,
      passwordHash: hash,
      acceptingQuestions: true,
      pauseMessage: 'Questions are paused while the professor is answering.',
      blockedWords: [],
      currentSessionId: null,
      createdAt,
      updatedAt: createdAt
    };
    const session = {
      id: id('session'),
      classId: classroom.id,
      title: 'General questions',
      isActive: true,
      createdAt,
      endedAt: null,
      updatedAt: createdAt
    };
    classroom.currentSessionId = session.id;
    database.classes.push(classroom);
    database.sessions.push(session);
    writeDatabase(database);
    return sendJson(res, 201, { classroom: serializeClassroom(database, classroom, true) });
  }

  if (method === 'POST' && pathname === '/api/classes/login') {
    const body = await readBody(req);
    const joinCode = safeText(body.joinCode, 20).toUpperCase();
    const classroom = database.classes.find((c) => c.joinCode === joinCode);
    if (!classroom || !verifyPassword(body.password, classroom.passwordSalt, classroom.passwordHash)) {
      return sendError(res, 401, 'Invalid class code or professor password.');
    }
    return sendJson(res, 200, { classroom: serializeClassroom(database, classroom, true) });
  }

  const joinMatch = pathname.match(/^\/api\/classes\/join\/([A-Za-z0-9-]+)$/);
  if (method === 'GET' && joinMatch) {
    const joinCode = safeText(joinMatch[1], 20).toUpperCase();
    const classroom = database.classes.find((c) => c.joinCode === joinCode);
    if (!classroom) return sendError(res, 404, 'Class code not found.');
    return sendJson(res, 200, { classroom: serializeClassroom(database, classroom, false) });
  }

  const publicClassMatch = pathname.match(/^\/api\/classes\/([^/]+)$/);
  if (method === 'GET' && publicClassMatch) {
    const classroom = requireClass(database, publicClassMatch[1]);
    if (!classroom) return sendError(res, 404, 'Class not found.');
    return sendJson(res, 200, { classroom: serializeClassroom(database, classroom, false) });
  }

  const questionsMatch = pathname.match(/^\/api\/classes\/([^/]+)\/questions$/);
  if (method === 'GET' && questionsMatch) {
    const classId = questionsMatch[1];
    const classroom = requireClass(database, classId);
    if (!classroom) return sendError(res, 404, 'Class not found.');
    const token = getToken(req, url);
    const includeHidden = token === classroom.adminToken && url.searchParams.get('includeHidden') === 'true';
    const sessionId = url.searchParams.get('sessionId') || '';
    const anonId = safeText(url.searchParams.get('anonId') || '', 80);
    return sendJson(res, 200, {
      classroom: serializeClassroom(database, classroom, token === classroom.adminToken),
      stats: classStats(database, classId, sessionId),
      questions: filterQuestions(database, classId, { includeHidden, sessionId, anonId }),
      serverTime: now()
    });
  }

  if (method === 'POST' && questionsMatch) {
    const classId = questionsMatch[1];
    const classroom = requireClass(database, classId);
    if (!classroom) return sendError(res, 404, 'Class not found.');
    const body = await readBody(req);
    if (!classroom.acceptingQuestions) return sendError(res, 403, classroom.pauseMessage || 'Questions are paused.');
    const text = safeText(body.text, 1000);
    const category = CATEGORY_OPTIONS.includes(body.category) ? body.category : 'Other';
    const sessionId = safeText(body.sessionId || classroom.currentSessionId, 80);
    if (!text || text.length < 4) return sendError(res, 400, 'Question must be at least 4 characters.');
    if (!database.sessions.some((s) => s.id === sessionId && s.classId === classId)) return sendError(res, 400, 'Invalid session.');

    const flags = moderationFlags(classroom, text);
    if (flags.some((flag) => flag.startsWith('Blocked word'))) {
      return sendError(res, 400, 'This question was blocked by the class moderation rules. Try rewording it.');
    }
    const duplicates = findDuplicates(database, classId, sessionId, text);
    if (duplicates.length && body.allowDuplicate !== true) {
      return sendJson(res, 409, { duplicate: true, matches: duplicates });
    }
    const createdAt = now();
    const question = {
      id: id('q'),
      classId,
      sessionId,
      text,
      category,
      status: flags.length ? 'needs_answer' : 'new',
      pinned: false,
      hidden: false,
      answerText: '',
      answerHistory: [],
      moderationFlags: flags,
      createdAt,
      updatedAt: createdAt
    };
    database.questions.push(question);
    writeDatabase(database);
    return sendJson(res, 201, { question: serializeQuestion(database, question, true, safeText(body.anonId || '', 80)) });
  }

  const duplicateMatch = pathname.match(/^\/api\/classes\/([^/]+)\/duplicates$/);
  if (method === 'GET' && duplicateMatch) {
    const classId = duplicateMatch[1];
    const classroom = requireClass(database, classId);
    if (!classroom) return sendError(res, 404, 'Class not found.');
    const text = safeText(url.searchParams.get('text') || '', 1000);
    const sessionId = safeText(url.searchParams.get('sessionId') || classroom.currentSessionId || '', 80);
    if (text.length < 10) return sendJson(res, 200, { matches: [] });
    return sendJson(res, 200, { matches: findDuplicates(database, classId, sessionId, text) });
  }

  const voteMatch = pathname.match(/^\/api\/questions\/([^/]+)\/vote$/);
  if (method === 'POST' && voteMatch) {
    const body = await readBody(req);
    const question = database.questions.find((q) => q.id === voteMatch[1]);
    if (!question || question.hidden) return sendError(res, 404, 'Question not found.');
    const anonId = safeText(body.anonId, 80) || id('anon');
    const existingIndex = database.votes.findIndex((vote) => vote.questionId === question.id && vote.voterId === anonId);
    if (existingIndex >= 0) {
      database.votes.splice(existingIndex, 1);
    } else {
      database.votes.push({ questionId: question.id, voterId: anonId, createdAt: now() });
    }
    writeDatabase(database);
    return sendJson(res, 200, { question: serializeQuestion(database, question, true, anonId) });
  }

  const reactMatch = pathname.match(/^\/api\/questions\/([^/]+)\/react$/);
  if (method === 'POST' && reactMatch) {
    const body = await readBody(req);
    const question = database.questions.find((q) => q.id === reactMatch[1]);
    if (!question || question.hidden) return sendError(res, 404, 'Question not found.');
    if (!question.answerText) return sendError(res, 400, 'You can react after the professor answers.');
    const anonId = safeText(body.anonId, 80) || id('anon');
    const type = REACTION_OPTIONS.includes(body.type) ? body.type : '';
    if (!type) return sendError(res, 400, 'Invalid reaction.');
    const existingIndex = database.reactions.findIndex((reaction) => reaction.questionId === question.id && reaction.anonId === anonId);
    if (existingIndex >= 0 && database.reactions[existingIndex].type === type) {
      database.reactions.splice(existingIndex, 1);
    } else if (existingIndex >= 0) {
      database.reactions[existingIndex].type = type;
      database.reactions[existingIndex].createdAt = now();
    } else {
      database.reactions.push({ questionId: question.id, anonId, type, createdAt: now() });
    }
    writeDatabase(database);
    return sendJson(res, 200, { question: serializeQuestion(database, question, true, anonId) });
  }

  const ticketMatch = pathname.match(/^\/api\/classes\/([^/]+)\/exit-ticket$/);
  if (method === 'POST' && ticketMatch) {
    const classId = ticketMatch[1];
    const classroom = requireClass(database, classId);
    if (!classroom) return sendError(res, 404, 'Class not found.');
    const body = await readBody(req);
    const sessionId = safeText(body.sessionId || classroom.currentSessionId, 80);
    const ticket = {
      id: id('ticket'),
      classId,
      sessionId,
      anonId: safeText(body.anonId, 80) || id('anon'),
      understanding: Math.max(1, Math.min(5, Number(body.understanding) || 3)),
      reviewText: safeText(body.reviewText, 800),
      createdAt: now()
    };
    database.exitTickets.push(ticket);
    writeDatabase(database);
    return sendJson(res, 201, { ticket });
  }

  const professorClassMatch = pathname.match(/^\/api\/professor\/classes\/([^/]+)$/);
  if (method === 'GET' && professorClassMatch) {
    const access = requireAdmin(req, url, database, professorClassMatch[1]);
    if (access.error) return sendError(res, access.status, access.error);
    const sessionId = url.searchParams.get('sessionId') || '';
    return sendJson(res, 200, {
      classroom: serializeClassroom(database, access.classroom, true),
      stats: classStats(database, access.classroom.id, sessionId),
      summary: smartSummary(database, access.classroom.id, sessionId),
      questions: filterQuestions(database, access.classroom.id, { includeHidden: true, sessionId }),
      exitTickets: database.exitTickets.filter((t) => t.classId === access.classroom.id && (!sessionId || t.sessionId === sessionId)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
      serverTime: now()
    });
  }

  const settingsMatch = pathname.match(/^\/api\/professor\/classes\/([^/]+)\/settings$/);
  if (method === 'PATCH' && settingsMatch) {
    const access = requireAdmin(req, url, database, settingsMatch[1]);
    if (access.error) return sendError(res, access.status, access.error);
    const body = await readBody(req);
    if (typeof body.acceptingQuestions === 'boolean') access.classroom.acceptingQuestions = body.acceptingQuestions;
    if (typeof body.pauseMessage === 'string') access.classroom.pauseMessage = safeText(body.pauseMessage, 240);
    if (Array.isArray(body.blockedWords)) access.classroom.blockedWords = body.blockedWords.map((w) => safeText(w, 50).toLowerCase()).filter(Boolean).slice(0, 80);
    if (typeof body.currentSessionId === 'string' && database.sessions.some((s) => s.id === body.currentSessionId && s.classId === access.classroom.id)) {
      access.classroom.currentSessionId = body.currentSessionId;
    }
    access.classroom.updatedAt = now();
    writeDatabase(database);
    return sendJson(res, 200, { classroom: serializeClassroom(database, access.classroom, true) });
  }

  const sessionsMatch = pathname.match(/^\/api\/professor\/classes\/([^/]+)\/sessions$/);
  if (method === 'POST' && sessionsMatch) {
    const access = requireAdmin(req, url, database, sessionsMatch[1]);
    if (access.error) return sendError(res, access.status, access.error);
    const body = await readBody(req);
    const title = safeText(body.title, 120);
    if (!title) return sendError(res, 400, 'Session title is required.');
    const createdAt = now();
    const session = { id: id('session'), classId: access.classroom.id, title, isActive: true, createdAt, endedAt: null, updatedAt: createdAt };
    database.sessions.push(session);
    access.classroom.currentSessionId = session.id;
    access.classroom.updatedAt = createdAt;
    writeDatabase(database);
    return sendJson(res, 201, { session, classroom: serializeClassroom(database, access.classroom, true) });
  }

  const sessionPatchMatch = pathname.match(/^\/api\/professor\/sessions\/([^/]+)$/);
  if (method === 'PATCH' && sessionPatchMatch) {
    const session = database.sessions.find((s) => s.id === sessionPatchMatch[1]);
    if (!session) return sendError(res, 404, 'Session not found.');
    const access = requireAdmin(req, url, database, session.classId);
    if (access.error) return sendError(res, access.status, access.error);
    const body = await readBody(req);
    if (typeof body.title === 'string') session.title = safeText(body.title, 120) || session.title;
    if (typeof body.isActive === 'boolean') {
      session.isActive = body.isActive;
      session.endedAt = body.isActive ? null : now();
    }
    if (body.makeCurrent === true) access.classroom.currentSessionId = session.id;
    session.updatedAt = now();
    access.classroom.updatedAt = now();
    writeDatabase(database);
    return sendJson(res, 200, { session, classroom: serializeClassroom(database, access.classroom, true) });
  }

  const questionPatchMatch = pathname.match(/^\/api\/professor\/questions\/([^/]+)$/);
  if (method === 'PATCH' && questionPatchMatch) {
    const question = database.questions.find((q) => q.id === questionPatchMatch[1]);
    if (!question) return sendError(res, 404, 'Question not found.');
    const access = requireAdmin(req, url, database, question.classId);
    if (access.error) return sendError(res, access.status, access.error);
    const body = await readBody(req);
    if (typeof body.pinned === 'boolean') question.pinned = body.pinned;
    if (typeof body.hidden === 'boolean') question.hidden = body.hidden;
    if (STATUS_OPTIONS.includes(body.status)) question.status = body.status;
    if (typeof body.category === 'string' && CATEGORY_OPTIONS.includes(body.category)) question.category = body.category;
    if (typeof body.answerText === 'string') {
      const answerText = safeText(body.answerText, 2000);
      if (answerText !== question.answerText) {
        question.answerText = answerText;
        if (answerText) {
          question.status = 'answered';
          question.answerHistory.push({ id: id('answer'), text: answerText, createdAt: now() });
        }
      }
    }
    question.updatedAt = now();
    writeDatabase(database);
    return sendJson(res, 200, { question: serializeQuestion(database, question, true) });
  }

  const summaryMatch = pathname.match(/^\/api\/professor\/classes\/([^/]+)\/summary$/);
  if (method === 'GET' && summaryMatch) {
    const access = requireAdmin(req, url, database, summaryMatch[1]);
    if (access.error) return sendError(res, access.status, access.error);
    const sessionId = url.searchParams.get('sessionId') || '';
    return sendJson(res, 200, { summary: smartSummary(database, access.classroom.id, sessionId), stats: classStats(database, access.classroom.id, sessionId) });
  }

  const exportMatch = pathname.match(/^\/api\/professor\/classes\/([^/]+)\/export\.csv$/);
  if (method === 'GET' && exportMatch) {
    const access = requireAdmin(req, url, database, exportMatch[1]);
    if (access.error) return sendError(res, access.status, access.error);
    const sessionId = url.searchParams.get('sessionId') || '';
    const csv = buildCsv(database, access.classroom.id, sessionId);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="askanon-${access.classroom.joinCode}-questions.csv"`,
      'Cache-Control': 'no-store'
    });
    res.end(csv);
    return;
  }

  const reportMatch = pathname.match(/^\/api\/professor\/classes\/([^/]+)\/report\.txt$/);
  if (method === 'GET' && reportMatch) {
    const access = requireAdmin(req, url, database, reportMatch[1]);
    if (access.error) return sendError(res, access.status, access.error);
    const sessionId = url.searchParams.get('sessionId') || '';
    const report = buildTextReport(database, access.classroom, sessionId);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': `attachment; filename="askanon-${access.classroom.joinCode}-report.txt"`,
      'Cache-Control': 'no-store'
    });
    res.end(report);
    return;
  }

  return sendError(res, 404, 'API route not found.');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else {
      serveStatic(req, res, decodeURIComponent(url.pathname));
    }
  } catch (error) {
    sendError(res, error.message === 'Invalid JSON body.' ? 400 : 500, error.message || 'Server error.');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`${APP_NAME} running at http://${HOST}:${PORT}`);
});
