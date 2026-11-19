'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateRelations, validateAxes } = require('../services/overallClaimRelations');
const { overallMapSvg } = require('../../lib/overallMapView');
const claims = [{ id: 'a', polarity: 'HELPFUL', original_quotes: [{ quote: 'AI helped.' }] }, { id: 'b', polarity: 'UNHELPFUL', original_quotes: [{ quote: 'AI hindered.' }] }, { id: 'c', polarity: 'HELPFUL', original_quotes: [{ quote: 'Another benefit.' }] }];
const edge = (id, source, target) => ({ id, source, target, relation: 'SUPPORT', rationale: 'The source provides a reason for the target.' });
test('only support, against and tension relations are accepted; duplicate pairs and unknown types are rejected', () => {
  assert.throws(() => validateRelations({ edges: [{ ...edge('1', 'a', 'b'), relation: 'SPECIALIZES' }] }, claims), /Invalid/);
  assert.throws(() => validateRelations({ edges: [edge('1', 'a', 'b'), edge('2', 'b', 'a')] }, claims), /Duplicate/);
  assert.throws(() => validateRelations({ edges: [edge('1', 'a', 'missing')] }, claims), /Invalid/);
  assert.doesNotThrow(() => validateRelations({ edges: [{ ...edge('1', 'a', 'c'), relation: 'TENSION' }] }, claims));
  assert.doesNotThrow(() => validateRelations({ edges: [{ ...edge('1', 'a', 'b'), relation: 'TENSION' }] }, claims));
});

test('review cannot omit candidate relationships or introduce new claim pairs', () => {
  const candidates = [edge('1', 'a', 'b'), edge('2', 'b', 'c')];
  assert.throws(() => validateRelations({ edges: [candidates[0]], rejected_ids: [] }, claims, candidates), /Every candidate/);
  assert.throws(() => validateRelations({ edges: [edge('1', 'a', 'c')], rejected_ids: ['2'] }, claims, candidates), /unproposed/);
  assert.doesNotThrow(() => validateRelations({ edges: [candidates[0]], rejected_ids: ['2'] }, claims, candidates));
});
test('overall visualization retains every claim including isolated nodes and escapes source text', () => {
  const items = claims.map((c, i) => ({ ...c, label: 'Claim ' + (i + 1), text: i ? 'A distinct claim.' : '<script>untrusted</script>', conditions: '' }));
  const report = { claimAnalysis: { sections: [{ polarity: 'HELPFUL', themes: [{ claims: items }] }], overall_map: { edges: [edge('1', 'a', 'b')] } } };
  const svg = overallMapSvg(report);
  assert.equal([...svg.matchAll(/class="overall-node"/g)].length, 3);
  assert.match(svg, /data-node-id="c"/); assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
});

test('tension axes require both grounded poles, real citations and complete relationship coverage', () => {
  const link = { ...edge('t1', 'a', 'b'), relation: 'TENSION' };
  const axis = { id: 'axis1', title: 'Assistance and control', dimension: 'Delegating work', analysis: 'The accounts suggest a benefit-risk tradeoff.', relation_ids: ['t1'],
    helpful_pole: { label: 'Assistance', claim_ids: ['a'], conditions: 'With user direction', source_refs: [{ claim_id: 'a', source_index: 0 }] },
    risk_pole: { label: 'Lost control', claim_ids: ['b'], conditions: 'When direction is lost', source_refs: [{ claim_id: 'b', source_index: 0 }] } };
  assert.doesNotThrow(() => validateAxes({ axes: [axis], excluded_relation_ids: [] }, claims, [link]));
  const bad = structuredClone(axis); bad.risk_pole.source_refs[0].source_index = 20;
  assert.throws(() => validateAxes({ axes: [bad], excluded_relation_ids: [] }, claims, [link]), /actual original quote/);
  assert.throws(() => validateAxes({ axes: [], excluded_relation_ids: [] }, claims, [link]), /Assign each tension/);
  assert.doesNotThrow(() => validateAxes({ axes: [], excluded_relation_ids: ['t1'] }, claims, [link]));
});
