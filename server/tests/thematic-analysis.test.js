'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const calls = []; let fail = false;
class FakeOpenAI {
  constructor() { this.chat = { completions: { create: async input => {
    calls.push(input); assert.equal(input.model, 'gpt-6-luna');
    if (fail) throw Object.assign(new Error('quota'), { status: 429 });
    const data = JSON.parse(input.messages[1].content), name = input.response_format.json_schema.name;
    const value = require('./helpers/analysisFixture').responseFor(input);
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] };
  } } }; }
}
const id = require.resolve('openai'); require.cache[id] = { id, filename: id, loaded: true, exports: { OpenAI: FakeOpenAI } };
process.env.OPENAI_API_KEY = 'test-only';
const { analyzeThematic, materializeAnalysis } = require('../services/thematicAnalysis');
const { indexSources } = require('../services/argumentMapIndexed');
function candidate(ids) {
  return { themes: [{ theme_id: 'T1', name: 'Authorship depends on the extent of delegation', central_concept: 'Retaining authorship while delegating work', definition: 'How authorship changes with delegation', inclusion: 'Statements on authoring and delegation', exclusion: 'Tool speed alone', qualifications: 'Authorship is conditional', topic_relevance: 'ON_TOPIC', code_ids: ids }],
    axes: ids.length < 2 ? [] : [{ axis_id: 'A1', name: 'Extent of delegated authorship', dimension: 'Who performs the drafting work', relationship: 'CONTINUUM', left_pole: { label: 'Assisted student authorship', definition: 'Student remains author', code_ids: [ids[0]] }, right_pole: { label: 'Replaced student authorship', definition: 'Tool does the drafting', code_ids: [ids[1]] }, theme_ids: ['T1'], rationale: 'Both approaches are explicitly discussed.', qualifications: 'Intermediate approaches remain possible.' }],
    unassigned_code_ids: [], alternative_interpretations: ['Differences may concern task stages, not opposing students.'], limitations: ['Interpretive draft requiring human review.'], review_questions: ['Do both poles refer to the same task?'],
  };
}
const groups = [{ id: 'g1', name: 'One', transcript: 'AI should help students develop their own draft. AI could replace the whole drafting process.', manualPoints: [{ id: 'p1', text: 'Keep students responsible for final choices.' }] }];
test('thematic pipeline codes original/typed input, synthesizes and reviews; restores exact evidence for both poles', async () => {
  calls.length = 0;
  const result = await analyzeThematic({ topic: 'AI authorship', instructions: '', groups });
  assert.equal(result.status, 'completed'); assert.equal(result.review_status, 'AI_DRAFT');
  assert.deepEqual(calls.map(c => c.response_format.json_schema.name), ['transcript_cleanup', 'transcript_cleanup_review', 'thematic_codes', 'thematic_synthesis', 'thematic_review']);
  assert.equal(result.codes[0].sources[0].original_quote, 'AI should help students develop their own draft.');
  assert.equal(result.codes[1].sources[0].original_quote, 'AI could replace the whole drafting process.');
  assert.ok(result.codes.some(c => c.sources.some(s => s.source_kind === 'manual')));
  assert.equal(result.themes[0].group_ids.length, 1, 'Group counts are derived from source IDs, not invented votes');
});
test('validation rejects invented evidence and one-sided axes, retaining unmatched codes automatically', () => {
  const sources = indexSources(groups), codes = sources.map((s, i) => ({ code_id: 'C' + (i + 1), label: 'Meaning', meaning: s.original_quote, source_ids: [s.source_id] }));
  const input = candidate(codes.map(c => c.code_id));
  const unknown = structuredClone(input); unknown.themes[0].code_ids = ['FAKE']; assert.throws(() => materializeAnalysis(unknown, codes, sources), /Unknown code/);
  const oneSided = structuredClone(input); oneSided.axes[0].right_pole.code_ids = ['C1']; assert.throws(() => materializeAnalysis(oneSided, codes, sources), /distinct supporting codes/);
  const dropped = structuredClone(input); dropped.themes[0].code_ids = ['C1'];
  assert.deepEqual(materializeAnalysis(dropped, codes, sources).unassigned_code_ids, codes.slice(1).map(c => c.code_id));
  const noAxis = structuredClone(input); noAxis.axes = []; assert.equal(materializeAnalysis(noAxis, codes, sources).axes.length, 0);
});
test('empty data and AI failure produce transparent outcomes without inventing themes or poles', async () => {
  assert.equal((await analyzeThematic({ topic: '', groups: [] })).status, 'completed');
  fail = true; await assert.rejects(analyzeThematic({ topic: '', groups }), /quota/); fail = false;
});
