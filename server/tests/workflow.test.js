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
// A deployment may still have these old values; they must not override Luna.
process.env.ARGUMENT_MAP_MODEL = 'gpt-4o-mini';
process.env.REPORT_MODEL = 'gpt-4o-mini';

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
const jobs = new Map();
const notes = new Map();
mock('../db/pool', { query: async (sql, args = []) => {
  if (sql.includes('FROM group_notes')) return { rows: [...notes.values()].filter(p => p.groupId === args[0]).map(({groupId, ...point}) => point) };
  if (sql.includes('INSERT INTO group_notes')) { notes.set(args[0] + ':' + args[1], { groupId: args[0], id: args[1], text: args[2], replacesText: args[3] }); return { rows: [] }; }
  if (sql.includes('INSERT INTO argument_map_jobs')) {
    const old = jobs.get(args[0]);
    if (old && ['queued', 'running'].includes(old.status)) return { rows: [] };
    const job = { room_code: args[0], id: crypto.randomUUID(), status: 'queued', stage: 'Queued', input: JSON.parse(args[1]), result: old?.result || null, updated_at: new Date().toISOString() };
    jobs.set(args[0], job); return { rows: [structuredClone(job)] };
  }
  if (sql.includes('SELECT * FROM argument_map_jobs')) return { rows: jobs.has(args[0]) ? [structuredClone(jobs.get(args[0]))] : [] };
  if (sql.includes("SET status = 'running'")) {
    const job = [...jobs.values()].find(job => job.status === 'queued' || (job.status === 'running' && job.expired));
    if (!job) return { rows: [] };
    job.status = 'running'; job.expired = false; return { rows: [structuredClone(job)] };
  }
  if (sql.includes('SET input = input ||')) {
    const job = jobs.get(args[0]);
    if (!job || !['queued', 'running'].includes(job.status)) return { rows: [] };
    if (sql.includes("'reportRequested'")) {
      job.input.reportRequested = true;
      job.input.refreshSummary = Boolean(job.input.refreshSummary || args[1]);
      job.input.thematicRequested = Boolean(job.input.thematicRequested || args[2] || !job.input.reuseSavedMap);
    } else job.input.thematicRequested = true;
    return { rows: [structuredClone(job)] };
  }
  if (sql.includes('UPDATE argument_map_jobs')) {
    const job = [...jobs.values()].find(job => job.id === args[1]);
    if (!job || job.status !== 'running') return { rows: [] };
    if (sql.includes("SET status = 'succeeded'")) {
      if (job.input.reportRequested && !args[2]) return { rows: [] };
      if (job.input.thematicRequested && !args[3]) return { rows: [] };
      job.status = 'succeeded'; job.result = JSON.parse(args[0]);
    }
    else if (sql.includes('jsonb_set')) job.input.pipelineCheckpoints = JSON.parse(args[0]);
    else if (sql.includes('SET result =')) job.result = JSON.parse(args[0]);
    else if (sql.includes("SET status = 'failed'")) { job.status = 'failed'; job.error = args[0]; }
    else job.stage = args[0];
    return { rows: [{ room_code: job.room_code }] };
  }
  if (sql.startsWith('UPDATE rooms SET discussion_timer')) {
    if (JSON.stringify(room.discussion_timer ?? null) !== args[2]) return { rows: [] };
    room.discussion_timer = JSON.parse(args[0]); return { rows: [{ ...room }] };
  }
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
let lastSummaryInput = null;
mock('../services/summarize', {
  summarizeTranscript: async (transcript, context) => { summaryCalls++; lastSummaryInput = { transcript, context }; return '• Summary of: ' + transcript; },
  synthesizeAllSummaries: async () => 'Overall',
});

let aiInputs = [];
let aiAttempts = 0;
let transcribeCalls = 0;
let failReport = false;
let aiGate = null;
let summaryGate = null;
let thematicGate = null;
let failThematic = false;
function graphFor(quote, groupId = groups[0].id) {
  return { nodes: [{ node_id: 'N1', normalized_statement: 'A grounded claim', primary_type: 'CLAIM', sources: [{
    group_id: groupId, speaker_id: null, timestamp: null, source_location: null, original_quote: quote,
  }] }], edges: [] };
}
class FakeOpenAI {
  constructor() {
    this.chat = { completions: { create: async input => {
      assert.equal(input.model, 'gpt-6-luna');
      assert.equal(input.reasoning_effort, 'none');
      assert.equal('max_tokens' in input, false);
      assert.ok(input.max_completion_tokens > 0);
      aiInputs.push(structuredClone(input));
      const name = input.response_format.json_schema.name;
      if (name.startsWith('thematic_')) {
        if (failThematic) throw Object.assign(new Error('Test thematic quota failure'), { status: 429 });
        if (thematicGate) await thematicGate;
      } else if (name === 'report_overall_summary') {
        if (summaryGate) await summaryGate;
        if (failReport) throw Object.assign(new Error('Test quota failure'), { status: 429 });
      } else if (aiGate) await aiGate;
      const result = require('./helpers/analysisFixture').responseFor(input);
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] };

    } } };
    this.audio = { transcriptions: { create: async () => { transcribeCalls++; return { text: 'Recorded speech.' }; } } };
  }
}
mock('openai', { OpenAI: FakeOpenAI, default: FakeOpenAI, toFile: async value => value });

// Keep the legacy graph fixture for generic durable-job/cache regression tests.
// The v3 pipeline, censoring, frequency and four-section report have their own tests.
mock('../services/claimReportAnalysis', {
  METHOD_VERSION: 'cleaned-discussion-v2',
  analyzeClaimReport: input => require('../services/discussionAnalysis').analyzeDiscussion(input),
  publicClaimGraph: graph => graph,
});

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

async function completeJobs() {
  for (let i = 0; i < 50; i++) {
    await require('../services/argumentMapJobs').wakeWorker();
    if (![...jobs.values()].some(j => ['queued', 'running'].includes(j.status))) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Background job did not finish');
}

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
  const classroomEvent = once(b, 'test:classroom-event');
  io.to(room.code).emit('test:classroom-event', { stillInRoom: true });
  assert.deepEqual((await classroomEvent)[0], { stillInRoom: true }, 'Leaving a group must not leave the classroom');
  await a.emitWithAck('group:join', { roomCode: room.code, groupId: groups[0].id });
  list = await (await fetch(base + '/api/groups/' + room.code)).json();
  assert.equal(list.groups[0].online, true);
  await a.emitWithAck('group:leave');
  await a.emitWithAck('group:join', { roomCode: room.code, groupId: groups[1].id });
  list = await (await fetch(base + '/api/groups/' + room.code)).json();
  assert.equal(list.groups[0].online, false);
  assert.equal(list.groups[1].online, true);
  assert.match(list.groups[0].transcript, /First/, 'Regrouping must retain old group transcripts');
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

test('presentation timer is instructor-controlled, shared live and never expires the discussion or transcript', async () => {
  const observer = await socket();
  await observer.emitWithAck('group:join', { roomCode: room.code, groupId: groups[0].id });
  const patch = (body, auth = true) => fetch(base + '/api/rooms/' + room.code + '/timer', { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  assert.equal((await patch({ action: 'start', durationSeconds: 90 }, false)).status, 401);
  const notification = once(observer, 'room:updated');
  const started = await (await patch({ action: 'start', durationSeconds: 90 })).json();
  assert.equal(started.room.discussion_timer.status, 'running');
  assert.equal((await notification)[0].room.discussion_timer.endsAt, started.room.discussion_timer.endsAt);
  const paused = await (await patch({ action: 'pause' })).json();
  assert.equal(paused.room.discussion_timer.status, 'paused');
  assert.ok(paused.room.discussion_timer.remainingMs > 80000);
  const resumed = await (await patch({ action: 'resume' })).json();
  assert.equal(resumed.room.discussion_timer.status, 'running');
  const changed = await (await patch({ action: 'start', durationSeconds: 30 })).json();
  assert.equal(changed.room.discussion_timer.durationSeconds, 30);
  assert.equal((await patch({ action: 'start', durationSeconds: -1 })).status, 400);
  const originalText = await redis.getTranscript(groups[0].id);
  room.discussion_timer.endsAt = Date.now() - 1000;
  const finished = await (await fetch(base + '/api/rooms/' + room.code)).json();
  assert.equal(finished.room.discussion_timer.status, 'finished');
  assert.equal(finished.room.discussion_timer.remainingMs, 0);
  assert.equal(await redis.getTranscript(groups[0].id), originalText);
  const stillAvailable = await fetch(base + '/api/groups/' + room.code);
  assert.equal(stillAvailable.status, 200, 'Timer expiry must not end the room');
  assert.equal((await (await patch({ action: 'reset', durationSeconds: 120 })).json()).room.discussion_timer.status, 'idle');
});

test('manual points remain saved and visible but group AI summary uses recorded transcripts only', async () => {
  const student = await socket();
  await student.emitWithAck('group:join', { roomCode: room.code, groupId: groups[1].id });
  const pointId = crypto.randomUUID();
  const text = 'Typed contribution without a recording. ' + 'Detail '.repeat(20000);
  const event = once(student, 'group:points:update');
  const response = await fetch(base + '/api/groups/' + groups[1].id + '/points/' + pointId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  assert.equal(response.status, 200, 'Typed input larger than the default 100 KB JSON limit must be accepted');
  const saved = await response.json();
  assert.equal(saved.manualPoints[0].text, text);
  assert.equal((await event)[0].manualPoints[0].text, text);
  const listed = await (await fetch(base + '/api/groups/' + room.code)).json();
  assert.equal(listed.groups.find(g => g.id === groups[1].id).manualPoints[0].text, text);
  await client.set('group:' + groups[1].id + ':transcript', '');
  const callsBefore = summaryCalls;
  assert.equal((await post('/api/groups/' + groups[1].id + '/summary', {})).status, 422);
  assert.equal(summaryCalls, callsBefore, 'Manual-only input must not trigger group AI analysis');
  await client.set('group:' + groups[1].id + ':transcript', 'Original recorded speech only.');
  const generated = await post('/api/groups/' + groups[1].id + '/summary', {});
  assert.equal(generated.status, 200);
  assert.equal(lastSummaryInput.transcript, 'Original recorded speech only.');
  assert.equal('manualPoints' in lastSummaryInput.context, false);
  assert.equal((await generated.json()).manualPoints[0].text, text, 'Generating AI summary must preserve manual points');
  await client.set('group:' + groups[1].id + ':transcript', '');
  assert.equal(await redis.getTranscript(groups[1].id), '', 'Manual notes must not be mislabeled as recorded speech');
  await fetch(base + '/api/groups/' + groups[1].id + '/points/' + pointId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'A saved student-written viewpoint.' }) });
});

test('Argument Map runs detached, deduplicates pending requests and restores the result after navigation', async () => {
  await client.set('group:' + groups[0].id + ':transcript', 'Original first group speech.');
  await client.set('group:' + groups[1].id + ':transcript', 'Original second group speech.');
  await client.set('group:' + groups[0].id + ':summary', 'SUMMARY MUST NOT BE INPUT');
  let release;
  aiGate = new Promise(resolve => { release = resolve; });
  const response = await post('/api/rooms/' + room.code + '/argument-map', {}, true);
  assert.equal(response.status, 202);
  const queued = await response.json();
  const repeated = await (await post('/api/rooms/' + room.code + '/argument-map', {}, true)).json();
  assert.equal(repeated.job.id, queued.job.id);
  const status = await (await fetch(base + '/api/rooms/' + room.code + '/argument-map', { headers: { Cookie: cookie } })).json();
  assert.ok(['queued', 'running'].includes(status.job.status));
  release(); aiGate = null;
  await require('../services/argumentMapJobs').wakeWorker();
  const restored = await (await fetch(base + '/api/rooms/' + room.code + '/argument-map', { headers: { Cookie: cookie } })).json();
  assert.equal(restored.job.status, 'succeeded');
  const graph = restored.graph;
  assert.ok(aiInputs.some(i => i.response_format.json_schema.name === 'transcript_cleanup'));
  assert.ok(aiInputs.some(i => i.response_format.json_schema.name === 'argument_relations'));
  const input = { original_sources: aiInputs.filter(i => i.response_format.json_schema.name === 'group_content').flatMap(i => JSON.parse(i.messages[1].content).original_sources) };
  assert.match(JSON.stringify(input.original_sources), /Original first group speech/);
  assert.match(JSON.stringify(input.original_sources), /Original second group speech/);
  assert.ok(input.original_sources.some(s => s.source_kind === 'manual' && s.original_quote === 'A saved student-written viewpoint.'));
  assert.equal(graph.source_snapshot.groups[1].manualPoints[0].text, 'A saved student-written viewpoint.');
  assert.doesNotMatch(JSON.stringify(input.original_sources), /SUMMARY MUST NOT BE INPUT/);
  assert.equal('teacher_topic' in input, false);
  assert.equal(graph.input.groups.length, 2);
  assert.equal(graph.input.source, 'original_transcripts');
  assert.equal(graph.nodes[0].sources[0].original_quote, 'Original first group speech.');
  assert.ok(await client.get('room:' + room.code + ':argumentMap'));
  const job = jobs.get(room.code); job.status = 'running'; job.expired = true;
  await require('../services/argumentMapJobs').wakeWorker();
  assert.equal(job.status, 'succeeded', 'Expired leases must be recoverable after restart');
});

test('report reuses the authoritative map, its four categories and exact source snapshot without repeating extraction', async () => {
  const job = jobs.get(room.code);
  const source = job.result.nodes[0].sources[0];
  job.result.nodes = ['POSITIVE', 'NEGATIVE', 'OFF_TOPIC', 'NEUTRAL'].map((topic_position, i) => ({
    node_id: 'N' + i, normalized_statement: 'Saved statement ' + i, primary_type: 'CLAIM', topic_position,
    sources: [source, { ...source, group_id: groups[1].id, original_quote: 'Original second group speech.' }],
  }));
  job.result.edges = [{ edge_id: 'E0', source_node_id: 'N0', target_node_id: 'N3', relationship_type: 'SUPPORTS', justification: 'Saved verified relation', evidence: [] }];
  groups.push({ id: crypto.randomUUID(), name: 'New group after map generation', members: ['C'], room_id: room.id });
  // Simulate cache loss and an old report made by the previous, separate pipeline.
  await client.del('room:' + room.code + ':argumentMap');
  await client.set('room:' + room.code + ':reportSnapshot', JSON.stringify({ argumentMap: graphFor('Legacy quotation'), contentAnalysis: { statements: [{ statement: 'DO NOT REUSE OLD EXTRACTION' }] } }));
  const calls = aiInputs.length;
  const preview = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(aiInputs.length, calls, 'Loading/exporting a report must never call AI');
  assert.deepEqual(preview.argumentMap, job.result, 'PostgreSQL map wins over old reports and missing cache');
  assert.equal(preview.contentAnalysis.statements.length, 4);
  assert.deepEqual(preview.contentAnalysis.statements.map(s => s.position), ['POSITIVE', 'NEGATIVE', 'OFF_TOPIC', 'NEUTRAL']);
  assert.equal(preview.groups.length, 2, 'Appendix uses the captured map groups, not new groups');
  assert.equal(preview.stale, true);
  const response = await post('/api/rooms/' + room.code + '/report/generate', {}, true);
  assert.equal(response.status, 202);
  await completeJobs();
  const report = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(report.overallSummary, 'High-level classroom synthesis.');
  assert.deepEqual(report.argumentMap.nodes, job.result.nodes);
  assert.deepEqual(report.argumentMap.edges, job.result.edges);
  assert.equal(report.thematicAnalysis.status, 'completed');
  assert.deepEqual(aiInputs.slice(calls).map(i => i.response_format.json_schema.name), ['thematic_codes', 'thematic_codes', 'thematic_synthesis', 'thematic_review', 'report_overall_summary'], 'Complete missing thematic analysis and summary without new graph extraction');
  assert.equal(aiInputs.at(-1).response_format.json_schema.name, 'report_overall_summary');
  assert.equal(report.groups[0].transcript, 'Original first group speech.');
  assert.deepEqual(report.groups[0].members, ['A']);
  await redis.appendTranscript(groups[0].id, 'New speech after the snapshot.');
  const later = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(later.stale, true);
  assert.equal(later.groups[0].transcript, report.groups[0].transcript);
  assert.equal(later.overallSummary, report.overallSummary);
  failReport = true;
  const failedSummary = await post('/api/rooms/' + room.code + '/report/generate', { refreshSummary: true }, true);
  assert.equal(failedSummary.status, 202);
  await completeJobs();
  const preserved = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(preserved.overallSummary, report.overallSummary);
  assert.deepEqual(preserved.argumentMap, report.argumentMap);
  assert.match(preserved.summaryWarning, /available for export/);
  // A newer map invalidates old summary but is immediately exportable without AI.
  const latestJob = jobs.get(room.code);
  latestJob.result = structuredClone(latestJob.result); latestJob.result.nodes[0].normalized_statement = 'New saved map statement';
  const updated = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(updated.overallSummary, null);
  assert.equal(updated.contentAnalysis.statements[0].statement, 'New saved map statement');
  assert.equal((await post('/api/rooms/' + room.code + '/report/generate', {})).status, 401);
});

test('reports with an existing summary fill missing thematic analysis and retry failures without regenerating the map or summary', async () => {
  failReport = false;
  const graph = jobs.get(room.code).result;
  delete graph.thematic_analysis;
  await require('../services/reportStore').finishReport(room.code, graph, false, graph.source_snapshot);
  const nodes = structuredClone(graph.nodes);
  jobs.get(room.code).input.pipelineCheckpoints = {};
  failThematic = true;
  const calls = aiInputs.length;
  assert.equal((await post('/api/rooms/' + room.code + '/report/generate', {}, true)).status, 202);
  await completeJobs();
  assert.equal(jobs.get(room.code).status, 'failed');
  assert.equal(jobs.get(room.code).result.thematic_analysis, undefined);
  assert.deepEqual(aiInputs.slice(calls).map(i => i.response_format.json_schema.name), ['thematic_codes', 'thematic_codes']);
  failThematic = false;
  const retryCalls = aiInputs.length;
  assert.equal((await post('/api/rooms/' + room.code + '/report/generate', {}, true)).status, 202);
  await completeJobs();
  const report = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(report.thematicAnalysis.status, 'completed');
  assert.equal(report.overallSummary, 'High-level classroom synthesis.');
  assert.deepEqual(report.argumentMap.nodes, nodes);
  assert.deepEqual(aiInputs.slice(retryCalls).map(i => i.response_format.json_schema.name), ['thematic_codes', 'thematic_codes', 'thematic_synthesis', 'thematic_review']);
  const completedCalls = aiInputs.length;
  assert.equal((await post('/api/rooms/' + room.code + '/report/generate', {}, true)).status, 200);
  assert.equal(aiInputs.length, completedCalls);

  // A regenerating map retains its previous result while running. Its old
  // completed themes must not suppress thematic analysis of the new map.
  let release;
  aiGate = new Promise(resolve => { release = resolve; });
  await post('/api/rooms/' + room.code + '/argument-map', {}, true);
  const freshCalls = aiInputs.length;
  await post('/api/rooms/' + room.code + '/report/generate', {}, true);
  assert.equal(jobs.get(room.code).input.thematicRequested, true);
  release(); aiGate = null; await completeJobs();
  assert.equal(jobs.get(room.code).result.thematic_analysis.status, 'completed');
  assert.ok(aiInputs.slice(freshCalls).some(i => i.response_format.json_schema.name === 'thematic_review'));
});

test('report-first generation and simultaneous map requests share one durable analysis and survive page navigation', async () => {
  jobs.delete(room.code); await client.del('room:' + room.code + ':argumentMap'); await client.del('room:' + room.code + ':reportSnapshot');
  failReport = false;
  const calls = aiInputs.length;
  let releaseMap, releaseSummary;
  aiGate = new Promise(resolve => { releaseMap = resolve; });
  summaryGate = new Promise(resolve => { releaseSummary = resolve; });
  const first = await post('/api/rooms/' + room.code + '/report/generate', {}, true);
  assert.equal(first.status, 202);
  const pending = await first.json();
  assert.equal(pending.reportPending, true);
  const repeated = await (await post('/api/rooms/' + room.code + '/report/generate', {}, true)).json();
  const mapRequest = await (await post('/api/rooms/' + room.code + '/argument-map', {}, true)).json();
  assert.equal(repeated.job.id, pending.job.id); assert.equal(mapRequest.job.id, pending.job.id);
  releaseMap(); aiGate = null;
  let map;
  for (let i = 0; i < 100; i++) {
    map = await (await fetch(base + '/api/rooms/' + room.code + '/argument-map', { headers: { Cookie: cookie } })).json();
    if (map.graph) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(map.graph?.nodes.length, 'Map is visible before the summary completes');
  const reopening = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(reopening.reportPending, true);
  assert.deepEqual(reopening.argumentMap.nodes, map.graph.nodes);
  releaseSummary(); summaryGate = null;
  await completeJobs();
  const complete = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.equal(complete.reportPending, false);
  assert.equal(complete.overallSummary, 'High-level classroom synthesis.');
  assert.deepEqual(complete.argumentMap.nodes, map.graph.nodes);
  assert.equal(complete.thematicAnalysis.status, 'completed');
  const stages = aiInputs.slice(calls).map(i => i.response_format.json_schema.name);
  assert.equal(stages[0], 'transcript_cleanup');
  assert.ok(stages.indexOf('argument_relations') >= 0 && stages.indexOf('argument_relations') < stages.indexOf('thematic_codes'));
  assert.equal(stages.at(-1), 'report_overall_summary');
  const count = aiInputs.length;
  assert.equal((await post('/api/rooms/' + room.code + '/report/generate', {}, true)).status, 200);
  assert.equal(aiInputs.length, count, 'Completed results must be reused');
  const regenerate = await (await post('/api/rooms/' + room.code + '/argument-map', {}, true)).json();
  assert.notEqual(regenerate.job.id, pending.job.id);
  await completeJobs();
  assert.equal(aiInputs.length, count, 'Unchanged successful stages are restored from durable checkpoints');
});

test('a report request joins an existing map job, and persisted report intent recovers after restart', async () => {
  jobs.delete(room.code); await client.del('room:' + room.code + ':argumentMap'); await client.del('room:' + room.code + ':reportSnapshot');
  let release;
  aiGate = new Promise(resolve => { release = resolve; });
  const map = await (await post('/api/rooms/' + room.code + '/argument-map', {}, true)).json();
  const report = await (await post('/api/rooms/' + room.code + '/report/generate', {}, true)).json();
  assert.equal(report.job.id, map.job.id);
  assert.equal(jobs.get(room.code).input.reportRequested, true, 'Report intent is persisted on the map job');
  release(); aiGate = null; await completeJobs();
  const graph = jobs.get(room.code).result;
  assert.ok(JSON.parse(await client.get('room:' + room.code + ':reportSnapshot')).overallSummary);
  // Recover an expired lease with a completed map but unfinished report. No new
  // extraction should happen when the worker resumes this persisted task.
  await client.del('room:' + room.code + ':reportSnapshot');
  const job = jobs.get(room.code);
  job.status = 'running'; job.expired = true;
  job.input = { ...graph.source_snapshot, reportRequested: true, reuseSavedMap: true };
  const calls = aiInputs.length;
  await completeJobs();
  assert.equal(job.status, 'succeeded');
  assert.deepEqual(job.result, graph);
  assert.deepEqual(aiInputs.slice(calls).map(i => i.response_format.json_schema.name), ['report_overall_summary']);
});

test('thematic analysis reuses saved original input and leaves graph nodes and relationships unchanged', async () => {
  const previous = structuredClone(jobs.get(room.code).result);
  const calls = aiInputs.length; let release;
  thematicGate = new Promise(resolve => { release = resolve; });
  const first = await (await post('/api/rooms/' + room.code + '/thematic-analysis', {}, true)).json();
  const duplicate = await (await post('/api/rooms/' + room.code + '/thematic-analysis', {}, true)).json();
  assert.equal(first.job.id, duplicate.job.id);
  assert.equal(first.job.thematic_requested, true);
  release(); thematicGate = null; await completeJobs();
  const result = jobs.get(room.code).result;
  assert.deepEqual(result.nodes, previous.nodes); assert.deepEqual(result.edges, previous.edges);
  assert.equal(result.thematic_analysis.status, 'completed');
  assert.ok(result.thematic_analysis.themes[0].sources.length);
  assert.deepEqual(aiInputs.slice(calls).map(i => i.response_format.json_schema.name), ['thematic_codes', 'thematic_codes', 'thematic_synthesis', 'thematic_review']);
  const report = await (await fetch(base + '/api/rooms/' + room.code + '/report', { headers: { Cookie: cookie } })).json();
  assert.deepEqual(report.thematicAnalysis, result.thematic_analysis);
  failThematic = true;
  assert.equal((await post('/api/rooms/' + room.code + '/thematic-analysis', {}, true)).status, 202);
  await completeJobs(); failThematic = false;
  const preserved = jobs.get(room.code).result;
  assert.deepEqual(preserved.nodes, previous.nodes);
  assert.deepEqual(preserved.thematic_analysis.themes, result.thematic_analysis.themes);
  assert.equal(preserved.thematic_analysis.status, 'completed');
  assert.equal(jobs.get(room.code).status, 'failed');
  assert.ok(jobs.get(room.code).error, 'Failed retry exposes job failure and preserves the previous reviewed draft');
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
