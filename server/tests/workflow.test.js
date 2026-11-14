'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { io: connect } = require('socket.io-client');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.OPENAI_API_KEY = 'test-only-not-a-real-key';
process.env.NODE_ENV = 'test';
process.env.INSTRUCTOR_PIN = 'test-pin';

function mock(relative, exports) {
  const id = require.resolve(relative);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}

const values = new Map();
const hashes = new Map();
const client = {
  get: async key => values.get(key) ?? null,
  set: async (key, value) => { values.set(key, String(value)); },
  append: async (key, value) => { values.set(key, (values.get(key) || '') + value); },
  del: async key => { values.delete(key); hashes.delete(key); },
  incr: async key => { const next = Number(values.get(key) || 0) + 1; values.set(key, String(next)); return next; },
  expire: async () => {},
  hGet: async (key, field) => hashes.get(key)?.get(field) ?? null,
  eval: async (_script, { keys, arguments: args }) => {
    const hash = hashes.get(keys[1]) || new Map();
    if (hash.has(args[0])) return 0;
    hash.set(args[0], args[1]); hashes.set(keys[1], hash);
    await client.append(keys[0], args[1] + '\n');
    return 1;
  },
  on: () => {}, connect: async () => {},
};
mock('redis', { createClient: () => client });
const redis = require('../services/redis');

const room = { id: crypto.randomUUID(), code: '123456', teacher_topic: 'Original topic', discussion_instructions: 'Original instructions' };
const groups = [
  { id: crypto.randomUUID(), name: 'One', members: ['A'], room_id: room.id },
  { id: crypto.randomUUID(), name: 'Two', members: ['B'], room_id: room.id },
];
mock('../db/pool', { query: async (sql, args = []) => {
  if (sql.startsWith('UPDATE rooms')) { room.teacher_topic = args[0]; room.discussion_instructions = args[1]; return { rows: [{ ...room }] }; }
  if (sql.startsWith('INSERT INTO rooms')) return { rows: [{ ...room, duration_minutes: args[3] }] };
  if (sql.includes('SELECT id FROM rooms WHERE code')) return { rows: [] };
  if (sql.includes('FROM rooms WHERE code')) return { rows: [{ ...room }] };
  if (sql.includes('WHERE g.id = $1')) {
    const group = groups.find(g => g.id === args[0]);
    return { rows: group && (!args[1] || args[1] === room.code) ? [{ ...group, code: room.code }] : [] };
  }
  if (sql.includes('FROM groups')) return { rows: groups.map(g => ({ ...g })) };
  throw new Error('Unexpected test query: ' + sql);
} });

let summaryCalls = 0;
mock('../services/summarize', {
  summarizeTranscript: async transcript => { summaryCalls++; return '• Summary of: ' + transcript; },
  synthesizeAllSummaries: async () => 'Overall',
});

let aiInputs = [];
let aiAttempts = 0;
let transcribeCalls = 0;
let failReport = false;
function graphFor(quote, groupId = groups[0].id) {
  return { nodes: [{ node_id: 'N1', normalized_statement: 'A grounded claim', primary_type: 'CLAIM', sources: [{
    group_id: groupId, speaker_id: null, timestamp: null, source_location: null, original_quote: quote,
  }] }], edges: [] };
}
class FakeOpenAI {
  constructor() {
    this.chat = { completions: { create: async input => {
      aiInputs.push(structuredClone(input));
      if (input.response_format.json_schema.name === 'classroom_report') {
        if (failReport) throw Object.assign(new Error('Test quota failure'), { status: 429 });
        return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          overall_summary: 'High-level classroom synthesis.', reference_proposition: 'AI should be used in class.',
          statements: [{ statement_id: 'S1', statement: 'A shared classroom statement.', position: 'OTHER', sources: [
            { group_id: groups[0].id, original_quote: 'Original first group speech.' },
            { group_id: groups[1].id, original_quote: 'Original second group speech.' }
          ] }]
        }) } }] };
      }
      aiAttempts++;
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(
        graphFor(aiAttempts === 1 ? 'Invented quotation.' : 'Original first group speech.')
      ) } }] };
    } } };
    this.audio = { transcriptions: { create: async () => { transcribeCalls++; return { text: 'Recorded speech.' }; } } };
  }
}
mock('openai', { OpenAI: FakeOpenAI, default: FakeOpenAI, toFile: async value => value });

const { originalQuote, validateGraph } = require('../services/argumentMap');
const { server, io } = require('../index');
let base;
let cookie;
const sockets = [];
before(async () => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
  const login = await fetch(base + '/api/instructor/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: 'test-pin' }) });
  assert.equal(login.status, 200);
  cookie = login.headers.get('set-cookie').split(';')[0];
});
after(async () => { sockets.forEach(socket => socket.disconnect()); await new Promise(resolve => io.close(resolve)); });

async function socket() {
  const result = connect(base, { transports: ['websocket'], reconnection: false });
  sockets.push(result); await once(result, 'connect'); return result;
}
const post = (url, body, authenticated = false) => fetch(base + url, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}) }, body: JSON.stringify(body),
});

test('quote validation only repairs whitespace and rejects paraphrase or incorrect group provenance', () => {
  assert.equal(originalQuote('one\n  two.', 'one two.'), 'one\n  two.');
  assert.equal(originalQuote('one two.', 'One two.'), null);
  assert.equal(originalQuote('AI helps.', 'AI is helpful.'), null);
  const transcripts = new Map([[groups[0].id, 'Original first group speech.'], [groups[1].id, 'Second group speech.']]);
  assert.throws(() => validateGraph(graphFor('Original first group speech.', groups[1].id), '', transcripts), /cited group/);
  assert.doesNotThrow(() => validateGraph(graphFor('Original first group speech.'), '', transcripts));
});

test('atomic transcription saves every segment and deduplicates retried chunks', async () => {
  await redis.appendTranscript(groups[0].id, 'First.', 'chunk-one');
  await redis.appendTranscript(groups[0].id, 'First.', 'chunk-one');
  await Promise.all([redis.appendTranscript(groups[0].id, 'Second.', 'chunk-two'), redis.appendTranscript(groups[0].id, 'Third.', 'chunk-three')]);
  assert.equal(await redis.getTranscript(groups[0].id), 'First.\nSecond.\nThird.\n');
});

test('recording publishes original transcript without automatic summary; upload retries are idempotent', async () => {
  const observer = await socket(); observer.emit('join:room', room.code);
  const event = once(observer, 'group:transcript:update');
  const chunkId = crypto.randomUUID();
  async function send() {
    const form = new FormData(); form.append('audio', new Blob(['audio bytes'], { type: 'audio/webm' }), 'chunk.webm');
    form.append('groupId', groups[1].id); form.append('chunkId', chunkId);
    return fetch(base + '/api/transcribe', { method: 'POST', body: form });
  }
  assert.equal((await send()).status, 200);
  const [update] = await event;
  assert.equal(update.transcript, 'Recorded speech.\n');
  assert.equal(summaryCalls, 0);
  assert.equal((await send()).status, 200);
  assert.equal(transcribeCalls, 1);
  const summary = await post('/api/groups/' + groups[1].id + '/summary');
  assert.equal(summary.status, 200); assert.equal(summaryCalls, 1);
});

test('leaving marks only the last connection offline, preserves data and supports rejoining', async () => {
  const a = await socket(); const b = await socket();
  for (const item of [a, b]) assert.deepEqual(await item.emitWithAck('group:join', { roomCode: room.code, groupId: groups[0].id }), { ok: true });
  await a.emitWithAck('group:leave');
  let list = await (await fetch(base + '/api/groups/' + room.code)).json();
  assert.equal(list.groups[0].online, true);
  await b.emitWithAck('group:leave');
  list = await (await fetch(base + '/api/groups/' + room.code)).json();
  assert.equal(list.groups[0].online, false);
  assert.match(list.groups[0].transcript, /First/);
  await a.emitWithAck('group:join', { roomCode: room.code, groupId: groups[0].id });
  list = await (await fetch(base + '/api/groups/' + room.code)).json();
  assert.equal(list.groups[0].online, true);
  a.disconnect();
});

test('teacher updates topic and instructions live; duration is not required', async () => {
  const observer = await socket(); observer.emit('join:room', room.code);
  const event = once(observer, 'room:updated');
  const response = await fetch(base + '/api/rooms/' + room.code, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ teacher_topic: 'New topic', discussion_instructions: 'New instructions' }) });
  assert.equal(response.status, 200);
  const [update] = await event;
  assert.equal(update.room.teacher_topic, 'New topic');
  assert.equal(update.room.discussion_instructions, 'New instructions');
  const create = await post('/api/rooms', { instructor_name: 'Teacher', teacher_topic: 'Topic', discussion_instructions: '' }, true);
  assert.equal(create.status, 201); assert.equal((await create.json()).room.duration_minutes, null);
  const denied = await fetch(base + '/api/rooms/' + room.code, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ teacher_topic: 'Unauthenticated' }) });
  assert.equal(denied.status, 401);
});

test('Argument Map reads all original group transcripts (including offline), never summaries, and retries failed quotation validation', async () => {
  await client.set('group:' + groups[0].id + ':transcript', 'Original first group speech.');
  await client.set('group:' + groups[1].id + ':transcript', 'Original second group speech.');
  await client.set('group:' + groups[0].id + ':summary', 'SUMMARY MUST NOT BE INPUT');
  const response = await post('/api/rooms/' + room.code + '/argument-map', {}, true);
  assert.equal(response.status, 200);
  const graph = await response.json();
  assert.equal(aiInputs.length, 2);
  const input = JSON.parse(aiInputs[0].messages[1].content);
  assert.match(input.discussion_transcript, /Original first group speech/);
  assert.match(input.discussion_transcript, /Original second group speech/);
  assert.doesNotMatch(input.discussion_transcript, /SUMMARY MUST NOT BE INPUT/);
  assert.equal(input.teacher_topic, 'New topic');
  assert.equal(graph.input.groups.length, 2);
  assert.equal(graph.input.source, 'original_transcripts');
  assert.equal(graph.nodes[0].sources[0].original_quote, 'Original first group speech.');
  assert.ok(await client.get('room:' + room.code + ':argumentMap'));
});

test('full report includes merged cross-group statements, diagram, members and exact original transcripts in one stable snapshot', async () => {
  groups.push({ id: crypto.randomUUID(), name: 'Empty group', members: ['C'], room_id: room.id });
  const response = await post('/api/rooms/' + room.code + '/report/generate', {}, true);
  assert.equal(response.status, 200);
  const report = await response.json();
  assert.equal(report.overallSummary, 'High-level classroom synthesis.');
  assert.equal(report.contentAnalysis.statements.length, 1);
  assert.deepEqual(report.contentAnalysis.statements[0].sources.map(s => s.group_id), [groups[0].id, groups[1].id]);
  assert.ok(report.argumentMap.nodes.length);
  assert.equal(report.groups.length, 3);
  assert.deepEqual(report.groups[0].members, ['A']);
  assert.equal(report.groups[0].transcript, 'Original first group speech.');
  assert.equal(report.groups[2].transcript, '');
  const calls = aiInputs.length;
  const saved = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(aiInputs.length, calls, 'Preview/export must not call AI');
  assert.equal(saved.stale, false);
  await redis.appendTranscript(groups[0].id, 'New speech after the snapshot.');
  const later = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(later.stale, true);
  assert.equal(later.groups[0].transcript, report.groups[0].transcript, 'Appendix must match analysis snapshot');
  failReport = true;
  const failed = await post('/api/rooms/' + room.code + '/report/generate', {}, true);
  assert.equal(failed.status, 502);
  assert.equal(JSON.parse(await client.get('room:' + room.code + ':reportSnapshot')).generatedAt, report.generatedAt);
  assert.equal((await post('/api/rooms/' + room.code + '/report/generate', {})).status, 401);
});

test('content analysis rejects fabricated provenance, duplicated statements and forced positions without a proposition', () => {
  const { validateAnalysis } = require('../services/reportAnalysis');
  const input = [{ id: groups[0].id, transcript: 'An original claim.' }];
  const analysis = { overall_summary: 'Overview', reference_proposition: '', statements: [
    { statement_id: 'S1', statement: 'A claim', position: 'OTHER', sources: [{ group_id: groups[0].id, original_quote: 'An original claim.' }] }
  ] };
  assert.doesNotThrow(() => validateAnalysis(structuredClone(analysis), input));
  const fabricated = structuredClone(analysis); fabricated.statements[0].sources[0].original_quote = 'Invented claim';
  assert.throws(() => validateAnalysis(fabricated, input), /cited group/);
  const forced = structuredClone(analysis); forced.statements[0].position = 'FOR';
  assert.throws(() => validateAnalysis(forced, input), /reference proposition/);
  const duplicate = structuredClone(analysis); duplicate.statements.push({ ...duplicate.statements[0], statement_id: 'S2' });
  assert.throws(() => validateAnalysis(duplicate, input), /Duplicate/);
});
