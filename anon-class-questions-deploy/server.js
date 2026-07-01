const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const APP_NAME = process.env.APP_NAME || 'AskAnon';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'app.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultDatabase = {
  classes: [],
  questions: [],
  votes: []
};

function loadDatabase() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify(defaultDatabase, null, 2));
      return structuredClone(defaultDatabase);
    }

    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      classes: Array.isArray(parsed.classes) ? parsed.classes : [],
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      votes: Array.isArray(parsed.votes) ? parsed.votes : []
    };
  } catch (error) {
    console.error('Could not load database:', error);
    return structuredClone(defaultDatabase);
  }
}

let db = loadDatabase();

function saveDatabase() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

const rateBuckets = new Map();
function checkRateLimit(req, { windowMs, max, keyPrefix }) {
  const now = Date.now();
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
  const key = `${keyPrefix}:${ip}`;
  const bucket = rateBuckets.get(key) || { start: now, count: 0 };

  if (now - bucket.start > windowMs) {
    bucket.start = now;
    bucket.count = 0;
  }

  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return bucket.count <= max;
}

function cleanText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function makeId(prefix = '') {
  return `${prefix}${crypto.randomBytes(12).toString('hex')}`;
}

function makeJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return code;
}

function createUniqueJoinCode() {
  for (let i = 0; i < 30; i += 1) {
    const code = makeJoinCode();
    if (!db.classes.some((classroom) => classroom.joinCode === code)) return code;
  }
  throw new Error('Could not generate a unique class code.');
}

function getClassByCode(joinCode) {
  return db.classes.find((classroom) => classroom.joinCode === String(joinCode || '').toUpperCase()) || null;
}

function getClassById(classId) {
  return db.classes.find((classroom) => classroom.id === classId) || null;
}

function verifyProfessor(classId, token) {
  const classroom = getClassById(classId);
  if (!classroom || !token || classroom.professorToken !== token) return null;
  return classroom;
}

function publicClassRow(classroom) {
  return {
    id: classroom.id,
    joinCode: classroom.joinCode,
    title: classroom.title,
    courseCode: classroom.courseCode || null,
    school: classroom.school || null,
    professorName: classroom.professorName || null,
    createdAt: classroom.createdAt
  };
}

function questionRowsForClass(classId, includeHidden = false) {
  return db.questions
    .filter((question) => question.classId === classId)
    .filter((question) => includeHidden || !question.isHidden)
    .map((question) => ({
      id: question.id,
      body: question.body,
      tag: question.tag || null,
      status: question.status,
      isPinned: Boolean(question.isPinned),
      isHidden: Boolean(question.isHidden),
      createdAt: question.createdAt,
      answeredAt: question.answeredAt || null,
      votes: db.votes.filter((vote) => vote.questionId === question.id).length
    }))
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.votes !== b.votes) return b.votes - a.votes;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(text),
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml; charset=utf-8',
    '.ico': 'image/x-icon'
  };
  return types[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  let requestedPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Forbidden');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  fs.readFile(filePath, (error, content) => {
    if (error) return sendText(res, 500, 'Could not read file.');
    res.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Content-Length': content.length,
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(content);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 24_000) {
        reject(new Error('Request body too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method;

  if (method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, app: APP_NAME });
  }

  if (method === 'POST' && pathname === '/api/classes') {
    if (!checkRateLimit(req, { windowMs: 60_000, max: 10, keyPrefix: 'create-class' })) {
      return sendJson(res, 429, { error: 'Too many requests. Please slow down and try again.' });
    }

    const body = await readRequestBody(req);
    const title = cleanText(body.title, 90);
    const courseCode = cleanText(body.courseCode, 32);
    const school = cleanText(body.school, 80);
    const professorName = cleanText(body.professorName, 70);

    if (title.length < 3) {
      return sendJson(res, 400, { error: 'Class title must be at least 3 characters.' });
    }

    const id = makeId('cls_');
    const professorToken = makeId('prof_');
    const joinCode = createUniqueJoinCode();
    const classroom = {
      id,
      joinCode,
      title,
      courseCode: courseCode || null,
      school: school || null,
      professorName: professorName || null,
      professorToken,
      createdAt: new Date().toISOString()
    };

    db.classes.push(classroom);
    saveDatabase();

    return sendJson(res, 201, {
      class: publicClassRow(classroom),
      professorToken,
      studentUrl: `/class/${joinCode}`,
      professorUrl: `/professor/${id}?token=${professorToken}`
    });
  }

  const classMatch = pathname.match(/^\/api\/classes\/([^/]+)$/);
  if (method === 'GET' && classMatch) {
    const classroom = getClassByCode(classMatch[1]);
    if (!classroom) return sendJson(res, 404, { error: 'Class not found.' });
    return sendJson(res, 200, { class: publicClassRow(classroom) });
  }

  const classQuestionsMatch = pathname.match(/^\/api\/classes\/([^/]+)\/questions$/);
  if (classQuestionsMatch) {
    const classroom = getClassByCode(classQuestionsMatch[1]);
    if (!classroom) return sendJson(res, 404, { error: 'Class not found.' });

    if (method === 'GET') {
      return sendJson(res, 200, {
        class: publicClassRow(classroom),
        questions: questionRowsForClass(classroom.id)
      });
    }

    if (method === 'POST') {
      if (!checkRateLimit(req, { windowMs: 60_000, max: 8, keyPrefix: 'submit-question' })) {
        return sendJson(res, 429, { error: 'Too many requests. Please slow down and try again.' });
      }

      const requestBody = await readRequestBody(req);
      const questionBody = cleanText(requestBody.body, 600);
      const tag = cleanText(requestBody.tag, 24);

      if (questionBody.length < 8) {
        return sendJson(res, 400, { error: 'Question must be at least 8 characters.' });
      }

      const question = {
        id: makeId('q_'),
        classId: classroom.id,
        body: questionBody,
        tag: tag || null,
        status: 'open',
        isPinned: false,
        isHidden: false,
        createdAt: new Date().toISOString(),
        answeredAt: null
      };

      db.questions.push(question);
      saveDatabase();

      const fullQuestion = questionRowsForClass(classroom.id).find((item) => item.id === question.id);
      return sendJson(res, 201, { question: fullQuestion });
    }
  }

  const upvoteMatch = pathname.match(/^\/api\/questions\/([^/]+)\/upvote$/);
  if (method === 'POST' && upvoteMatch) {
    if (!checkRateLimit(req, { windowMs: 60_000, max: 30, keyPrefix: 'upvote' })) {
      return sendJson(res, 429, { error: 'Too many requests. Please slow down and try again.' });
    }

    const question = db.questions.find((item) => item.id === upvoteMatch[1] && !item.isHidden);
    if (!question) return sendJson(res, 404, { error: 'Question not found.' });

    const requestBody = await readRequestBody(req);
    const voterKey = cleanText(requestBody.voterKey, 80);
    if (!voterKey || voterKey.length < 8) {
      return sendJson(res, 400, { error: 'Missing voter key.' });
    }

    const existingIndex = db.votes.findIndex((vote) => vote.questionId === question.id && vote.voterKey === voterKey);
    const alreadyVoted = existingIndex !== -1;

    if (alreadyVoted) {
      db.votes.splice(existingIndex, 1);
    } else {
      db.votes.push({ questionId: question.id, voterKey, createdAt: new Date().toISOString() });
    }

    saveDatabase();

    const updated = questionRowsForClass(question.classId).find((item) => item.id === question.id);
    return sendJson(res, 200, { question: updated, voted: !alreadyVoted });
  }

  const professorMatch = pathname.match(/^\/api\/professor\/([^/]+)$/);
  if (method === 'GET' && professorMatch) {
    const classroom = verifyProfessor(professorMatch[1], url.searchParams.get('token'));
    if (!classroom) return sendJson(res, 401, { error: 'Invalid professor link.' });

    const questions = questionRowsForClass(classroom.id, true);
    const stats = {
      total: questions.length,
      open: questions.filter((question) => question.status === 'open' && !question.isHidden).length,
      answered: questions.filter((question) => question.status === 'answered' && !question.isHidden).length,
      hidden: questions.filter((question) => question.isHidden).length,
      votes: questions.reduce((sum, question) => sum + Number(question.votes || 0), 0)
    };

    return sendJson(res, 200, { class: publicClassRow(classroom), questions, stats });
  }

  const professorQuestionMatch = pathname.match(/^\/api\/professor\/([^/]+)\/questions\/([^/]+)$/);
  if (professorQuestionMatch) {
    const classroom = verifyProfessor(professorQuestionMatch[1], url.searchParams.get('token'));
    if (!classroom) return sendJson(res, 401, { error: 'Invalid professor link.' });

    const question = db.questions.find((item) => item.id === professorQuestionMatch[2] && item.classId === classroom.id);
    if (!question) return sendJson(res, 404, { error: 'Question not found.' });

    if (method === 'PATCH') {
      const requestBody = await readRequestBody(req);
      let changed = false;

      if (typeof requestBody.status === 'string' && ['open', 'answered'].includes(requestBody.status)) {
        question.status = requestBody.status;
        question.answeredAt = requestBody.status === 'answered' ? new Date().toISOString() : null;
        changed = true;
      }

      if (typeof requestBody.isPinned === 'boolean') {
        question.isPinned = requestBody.isPinned;
        changed = true;
      }

      if (typeof requestBody.isHidden === 'boolean') {
        question.isHidden = requestBody.isHidden;
        changed = true;
      }

      if (!changed) return sendJson(res, 400, { error: 'No valid update provided.' });
      saveDatabase();

      const updated = questionRowsForClass(classroom.id, true).find((item) => item.id === question.id);
      return sendJson(res, 200, { question: updated });
    }

    if (method === 'DELETE') {
      question.isHidden = true;
      saveDatabase();
      return sendJson(res, 200, { ok: true });
    }
  }

  return sendJson(res, 404, { error: 'API route not found.' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url);
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    if (!res.headersSent) {
      return sendJson(res, error.message === 'Request body too large.' ? 413 : 500, {
        error: error.message || 'Something went wrong. Please try again.'
      });
    }
    console.error(error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`${APP_NAME} running on ${HOST}:${PORT}`);
});
