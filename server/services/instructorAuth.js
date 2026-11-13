'use strict';

const crypto = require('crypto');
const redis = require('./redis');

const COOKIE_NAME = 'classdiscuss_instructor_session';
const TTL_SECONDS = 12 * 60 * 60;

function instructorPIN() {
  // Existing demo default is available only in local development.
  return process.env.INSTRUCTOR_PIN || (process.env.NODE_ENV === 'production' ? '' : '0000');
}

function constantTimeMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function parseCookies(header) {
  const result = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) result[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return result;
}

function cookieSettings(req) {
  const secure = process.env.NODE_ENV === 'production';
  return [
    COOKIE_NAME + '=',
    'Path=/',
    'HttpOnly',
    secure ? 'SameSite=None' : 'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
    'Max-Age=' + TTL_SECONDS
  ];
}

async function login(req, res) {
  const expected = instructorPIN();
  if (!expected) return res.status(503).json({ error: 'Instructor authentication is not configured' });
  if (!constantTimeMatch(req.body?.pin, expected)) return res.status(401).json({ error: 'Incorrect instructor PIN' });
  const sessionId = crypto.randomBytes(32).toString('hex');
  const key = 'instructor:session:' + crypto.createHash('sha256').update(sessionId).digest('hex');
  const client = await redis.getClient();
  await client.set(key, 'instructor', { EX: TTL_SECONDS });
  const pieces = cookieSettings(req);
  pieces[0] += sessionId;
  res.setHeader('Set-Cookie', pieces.join('; '));
  return res.json({ authenticated: true });
}

async function requireInstructor(req, res, next) {
  try {
    const sessionId = parseCookies(req.get('cookie'))[COOKIE_NAME];
    if (!sessionId || !/^[a-f0-9]{64}$/.test(sessionId)) {
      return res.status(401).json({ error: 'Instructor login required' });
    }
    const key = 'instructor:session:' + crypto.createHash('sha256').update(sessionId).digest('hex');
    const client = await redis.getClient();
    const valid = await client.get(key);
    if (valid !== 'instructor') return res.status(401).json({ error: 'Instructor session expired; please sign in again' });
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { login, requireInstructor };
