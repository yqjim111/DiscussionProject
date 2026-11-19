'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const fixture = require('./helpers/claimReportFixture').createFixture();
fixture.setScenario('community');
const calls = [];
function mock(name, exports) { const id = require.resolve(name); require.cache[id] = { id, filename: id, loaded: true, exports }; }
mock('openai', { OpenAI: class { constructor() { this.chat = { completions: { create: async input => {
  const name = input.response_format.json_schema.name; calls.push(name);
  return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixture.response(name, JSON.parse(input.messages[1].content))) } }] };
} } }; } } });
process.env.OPENAI_API_KEY = 'test-only';
mock('../db/pool', { query: async () => { throw Error('Unexpected database call in report route test'); } });
mock('../services/redis', { getClient: async () => ({ get: async () => null }) });
mock('../services/instructorAuth', { requireInstructor: (_req, _res, next) => next() });
const groups = ['One', 'Two'].map((name, i) => ({ id: 'g' + (i + 1), name, members: ['Student ' + (i + 1)], transcript: fixture.items().map(i => i.quote).join(' '), manualPoints: [] }));
const session = { room: { code: '123456', teacher_topic: 'Stale AI task', discussion_instructions: 'Old instructions' }, groups };
mock('../services/reportStore', { readSession: async () => structuredClone(session) });
const legacyGraph = { nodes: [], edges: [], cleaned_groups: structuredClone(groups), source_snapshot: { groups: structuredClone(groups) },
  generation: { mode: 'ai', method_version: 'claim-evidence-v4' }, input: {},
  claim_analysis: { summary: 'Old report summary', sections: [] }, thematic_analysis: { status: 'completed' } };
let job = { id: 'old', status: 'succeeded', input: {}, result: legacyGraph }, enqueues = 0;
const jobs = {
  getJob: async () => structuredClone(job),
  publicJob: value => ({ id: value.id, status: value.status, stage: value.stage }),
  enqueue: async (_code, input) => { enqueues++; job = { id: 'job-' + enqueues, status: 'queued', stage: 'Queued', input, result: job.result }; return structuredClone(job); },
  requestReport: async () => { job.input.reportRequested = true; return structuredClone(job); },
  wakeWorker: async () => {
    if (job.status !== 'queued') return;
    job.status = 'running';
    try {
      const { analyzeArgumentMap } = require('../services/argumentMapIndexed');
      const graph = await analyzeArgumentMap({ ...job.input, onProgress: async stage => { job.stage = stage; } });
      graph.source_snapshot = { groups: graph.source_groups, topic: session.room.teacher_topic, instructions: session.room.discussion_instructions };
      job.result = graph; job.status = 'succeeded';
    } catch (error) { job.status = 'failed'; job.error = error.message; }
  },
};
mock('../services/argumentMapJobs', jobs);
const app = express(); app.use(express.json()); app.use('/api/rooms', require('../routes/report'));
let server, base;
before(async () => { server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); base = 'http://127.0.0.1:' + server.address().port + '/api/rooms/123456/report'; });
after(async () => { await new Promise(resolve => server.close(resolve)); });
const generate = () => fetch(base + '/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
async function complete() {
  for (let attempt = 0; attempt < 150; attempt++) {
    const report = await (await fetch(base)).json();
    if (report.job.status === 'failed') throw Error(job.error);
    if (report.job.status === 'succeeded') return report;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw Error('Report did not finish');
}
test('Generate Report upgrades old analysis, discovers section headers and returns the complete new report; changed transcripts trigger new planning', async () => {
  const response = await generate(); assert.equal(response.status, 202);
  assert.equal(job.input.reuseSavedMap, false, 'An old hardcoded report must be reanalyzed');
  const report = await complete();
  assert.equal(report.argumentMap.generation.method_version, 'discussion-report-v5');
  assert.deepEqual(report.claimAnalysis.sections.map(s => s.title), ['Access and travel choices', 'Crossing safety', 'Community coordination']);
  assert.equal(report.claimAnalysis.overall_map.tensions.length, 1);
  assert.equal(report.groups.every(g => g.cleanup.status === 'completed'), true);
  assert.equal(report.claimAnalysis.sections.flatMap(s => s.themes.flatMap(t => t.claims)).length, 3);
  const { claimReportHtml } = require('../../lib/claimReportExport');
  const html = claimReportHtml(report);
  assert.match(html, /Tension Analysis/); assert.match(html, /Claim-Original transcript/); assert.match(html, /Collapse transcripts/);
  assert.doesNotMatch(html, /AI helpful|AI unhelpful/);
  const count = calls.length;
  assert.equal((await generate()).status, 200); assert.equal(calls.length, count, 'Unchanged completed reports reuse their verified result');
  groups[0].transcript += ' We shared another observation.';
  assert.equal((await generate()).status, 202);
  await complete(); assert.equal(calls.filter(name => name === 'discussion_report_plan').length, 2);
  assert.equal(enqueues, 2);
});
