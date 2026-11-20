'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeArgumentMap } = require('../services/argumentMapIndexed');
const { publicSimpleGraph } = require('../services/simpleArgumentAnalysis');
const { graphElements } = require('../../lib/argumentMapView');
test('map workflow only cleans, extracts claims, groups themes and analyzes support/against, with exact sources', async () => {
  const correct = 'All generated calculations were correct.', wrong = 'One generated calculation was wrong.', verified = 'A hand check confirmed that generated calculation was wrong.';
  const groups = [{ id: 'g1', name: 'One', members: ['Anna'], transcript: 'A retard sentence.\n' + correct, manualPoints: [] },
    { id: 'g2', name: 'Two', members: ['Bo'], transcript: wrong + '\n' + verified, manualPoints: [] }];
  const untouched = structuredClone(groups), calls = [];
  const request = async (name, _schema, _prompt, data, validate) => {
    calls.push(name); let result;
    if (name === 'transcript_cleanup') result = { cleaned_transcript: data.original_transcript, review_notes: [] };
    else if (name === 'transcript_cleanup_review') result = data.candidate;
    else if (name === 'transcript_censor') result = { redactions: [] };
    else if (name === 'map_claims') result = { claims: (data.group_key === 'G1' ? [{ id: 'A', text: correct, position: 'POSITIVE' }] : [{ id: 'B', text: wrong, position: 'NEGATIVE' }, { id: 'V', text: verified, position: 'NEUTRAL' }]).map(c => ({ local_id: c.id, text: c.text, conditions: '', position: c.position, quotes: [{ source_id: 'T', original_quote: c.text }] })) };
    else if (name === 'map_themes') result = { themes: [{ id: 'T', title: 'Calculation reliability', description: 'Accuracy and checking.', claims: data.claims.map(c => ({ id: c.member_id.slice(-1), text: c.text, conditions: '', position: c.position, member_ids: [c.member_id] })) }], excluded: [] };
    else if (name === 'map_relations') result = { edges: [{ id: 'E1', source: 'V', target: 'B', relation: 'SUPPORT', rationale: 'The hand check corroborates the incorrect result.', source_quote_index: 0, target_quote_index: 0 }, { id: 'E2', source: 'B', target: 'A', relation: 'AGAINST', rationale: 'An incorrect result challenges the universal accuracy assertion.', source_quote_index: 0, target_quote_index: 0 }] };
    else throw Error('Unexpected extra workflow stage: ' + name);
    validate(result); return result;
  };
  const graph = await analyzeArgumentMap({ workflow: 'simple-map', groups, request });
  assert.deepEqual(groups, untouched); assert.equal(graph.generation.method_version, 'simple-argument-map-v1');
  assert.equal(graph.nodes.length, 3); assert.equal(graph.themes.length, 1);
  assert.deepEqual(graph.edges.map(e => e.relationship_type), ['SUPPORTS', 'ATTACKS']);
  assert.equal('claim_analysis' in graph, false); assert.equal('thematic_analysis' in graph, false);
  assert.ok(!calls.some(name => /report|tension|evidence|plan/.test(name)));
  const safe = publicSimpleGraph({ ...graph, source_snapshot: { groups } });
  assert.equal('source_groups' in safe, false); assert.equal('source_snapshot' in safe, false);
  assert.doesNotMatch(JSON.stringify(safe), /retard/);
  assert.equal(graphElements(safe).filter(e => e.data.type === 'THEME').length, 1);
});
