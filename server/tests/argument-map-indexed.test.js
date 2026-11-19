'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { responseFor } = require('./helpers/analysisFixture');
let failure = false, empty = false, calls = [];
class FakeOpenAI {
  constructor() { this.chat = { completions: { create: async input => {
    calls.push(input);
    assert.equal(input.model, 'gpt-6-luna');
    const data = JSON.parse(input.messages[1].content);
    assert.equal('teacher_topic' in data, false);
    assert.equal('discussion_instructions' in data, false);
    if (failure) throw Object.assign(new Error('Quota reached'), { status: 429 });
    const name = input.response_format.json_schema.name;
    const value = empty && name === 'group_content' ? { episodes: [], statements: [], exclusions: [] } : responseFor(input);
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] };
  } } }; }
}
const id = require.resolve('openai'); require.cache[id] = { id, filename: id, loaded: true, exports: { OpenAI: FakeOpenAI } };
process.env.OPENAI_API_KEY = 'test-only';
const { indexSources } = require('../services/transcriptPreparation');
const { analyzeDiscussion: analyzeArgumentMap } = require('../services/discussionAnalysis');
const { validateCleanup, resolveQuote } = require('../services/transcriptPreparation');
const { materializeEdges, reviewArgumentEdges } = require('../services/discussionAnalysis');
const { reportFromMap } = require('../services/reportFromMap');
const groups = [{ id: 'g1', name: 'One', transcript: 'Um, AI helped.\nBut sometimes it failed.', manualPoints: [{ id: 'p1', text: 'Um, AI helped.\nBut sometimes it failed.' }] }];

test('changing classroom instructions alone does not invalidate transcript analysis', () => {
  const { snapshotHash } = require('../services/reportAnalysis');
  assert.equal(snapshotHash({ teacher_topic: 'positive' }, groups), snapshotHash({ teacher_topic: 'negative', discussion_instructions: 'Different round' }, groups));
  assert.notEqual(snapshotHash({}, groups), snapshotHash({}, [{ ...groups[0], transcript: 'New actual contribution.' }]));
});

test('whole-group indexing never splits speech and marks duplicated manual evidence', () => {
  const sources = indexSources(groups);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].original_quote, groups[0].transcript);
  assert.equal(sources[1].duplicate_of, sources[0].source_id);
  assert.throws(() => resolveQuote({ source_id: 'Q1', original_quote: 'AI always helps.' }, sources), /original wording/);
  assert.equal(resolveQuote({ source_id: 'Q1', original_quote: 'AI helped. But sometimes it failed.' }, sources).original_quote, 'AI helped.\nBut sometimes it failed.');
});

test('cleanup allows removal and punctuation but rejects rewritten/reordered words and invented notes', () => {
  assert.doesNotThrow(() => validateCleanup({ cleaned_transcript: 'AI helped.\n\nBut sometimes it failed.', review_notes: [] }, groups[0].transcript));
  assert.throws(() => validateCleanup({ cleaned_transcript: 'AI improved my project.', review_notes: [] }, groups[0].transcript), /added or reordered/);
  assert.throws(() => validateCleanup({ cleaned_transcript: 'Sometimes it failed. AI helped.', review_notes: [] }, groups[0].transcript), /added or reordered/);
  assert.throws(() => validateCleanup({ cleaned_transcript: 'AI helped.', review_notes: [{ original_excerpt: 'Invented', issue: 'Unclear' }] }, groups[0].transcript), /quote the original/);
});

test('pipeline uses AI cleanup/review before semantic extraction and separate argument verification; cached stages resume', async () => {
  calls = []; const checkpoints = {}; let persisted = {};
  const before = structuredClone(groups);
  const graph = await analyzeArgumentMap({ topic: 'IGNORE THIS TOPIC', instructions: 'IGNORE THIS TASK', groups, checkpoints, onCheckpoint: async cache => { persisted = cache; } });
  assert.deepEqual(groups, before);
  assert.equal(graph.generation.mode, 'ai');
  assert.equal(graph.cleaned_groups[0].cleanedTranscript, groups[0].transcript);
  assert.deepEqual(calls.slice(0, 4).map(c => c.response_format.json_schema.name), ['transcript_cleanup', 'transcript_cleanup_review', 'group_content', 'group_content_review']);
  assert.equal(calls.at(-1).response_format.json_schema.name, 'argument_relations');
  assert.equal(graph.argument_review.candidates, 0);
  graph.nodes.forEach(n => n.sources.forEach(s => assert.ok(groups[0].transcript.includes(s.original_quote))));
  const count = calls.length;
  await analyzeArgumentMap({ groups, checkpoints: persisted });
  assert.equal(calls.length, count, 'Successful unchanged stages are resumed without new provider calls');
});

test('relationship review must decide every candidate instead of silently returning an empty graph', async () => {
  const source = resolveQuote({ source_id: 'Q1', original_quote: 'AI helped.' }, indexSources(groups));
  const nodes = ['N1', 'N2'].map(node_id => ({ node_id, normalized_statement: 'An evidence-grounded proposition', primary_type: 'CLAIM', sources: [source] }));
  const candidate = { source_node_id: 'N1', target_node_id: 'N2', relationship_type: 'SUPPORTS', justification: 'Candidate connection', evidence_refs: [{ node_id: 'N1', source_index: 0 }, { node_id: 'N2', source_index: 0 }] };
  const request = async (name, schema, system, data, validate) => {
    assert.equal(name, 'argument_edge_review');
    assert.throws(() => validate({ decisions: [] }), /explicitly KEEP or REMOVE/);
    const result = { decisions: [{ candidate_id: data.candidates[0].candidate_id, decision: 'KEEP', reason: 'A contextual reason strengthens the stated conclusion.',
      source_node_id: 'N1', target_node_id: 'N2', relationship_type: 'SUPPORTS', evidence_refs: candidate.evidence_refs }] };
    validate(result); return result;
  };
  const result = await reviewArgumentEdges({ candidates: [candidate], nodes, groups, request });
  assert.equal(result.graph.edges.length, 1); assert.equal(result.decisions.length, 1);
});

test('API failures reject instead of converting raw speech to statements; empty semantic results stay empty', async () => {
  failure = true;
  await assert.rejects(analyzeArgumentMap({ groups }), /Quota reached/);
  failure = false; empty = true;
  const graph = await analyzeArgumentMap({ groups });
  assert.deepEqual(graph.nodes, []); assert.deepEqual(graph.edges, []); assert.equal(graph.generation.mode, 'ai');
  empty = false;
  const legacy = { nodes: [{ normalized_statement: 'Yeah.' }], edges: [], generation: { mode: 'extractive_fallback' } };
  const report = reportFromMap({ room: {}, groups: [] }, legacy, null, null);
  assert.equal(report.argumentMap, null); assert.equal(report.contentAnalysis, null);
});

test('argument evidence must explicitly select both endpoints and remains original', () => {
  const source = resolveQuote({ source_id: 'Q1', original_quote: 'AI helped.' }, indexSources(groups));
  const nodes = ['N1', 'N2'].map(node_id => ({ node_id, normalized_statement: 'Reported help', primary_type: 'CLAIM', sources: [source] }));
  const edge = { source_node_id: 'N1', target_node_id: 'N2', relationship_type: 'SUPPORTS', justification: 'Original reasoning', evidence_refs: [{ node_id: 'N1', source_index: 0 }] };
  assert.throws(() => materializeEdges({ edges: [edge] }, nodes, groups), /Both edge endpoints/);
  edge.evidence_refs.push({ node_id: 'N2', source_index: 0 });
  assert.equal(materializeEdges({ edges: [edge] }, nodes, groups).edges[0].evidence[0].original_quote, 'AI helped.');
  const reverse = { ...edge, source_node_id: 'N2', target_node_id: 'N1' };
  assert.equal(materializeEdges({ edges: [edge, reverse] }, nodes, groups, { allowCandidateConflicts: true }).edges.length, 2);
  assert.throws(() => materializeEdges({ edges: [edge, reverse] }, nodes, groups), /Duplicate relationship/);
});
