'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const calls = [];
const fixture = require('./helpers/claimReportFixture').createFixture();
class FakeOpenAI {
  constructor() { this.chat = { completions: { create: async input => {
    calls.push(input); const name = input.response_format.json_schema.name, data = JSON.parse(input.messages[1].content);
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(fixture.response(name, data)) } }] };
  } } }; }
}

const openai = require.resolve('openai'); require.cache[openai] = { id: openai, filename: openai, loaded: true, exports: { OpenAI: FakeOpenAI } };
process.env.OPENAI_API_KEY = 'test-only';
const { analyzeArgumentMap } = require('../services/argumentMapIndexed');
const { numberAndRank } = require('../services/claimReportAnalysis');
const { censorText, hasInappropriate } = require('../services/transcriptCensor');
const { reportFromMap } = require('../services/reportFromMap');
const { claimReportHtml, claimReportMarkdown, supportMapSvg } = require('../../lib/claimReportExport');
const groups = [
  { id: 'g1', name: 'One', members: ['A'], transcript: 'An inappropriate retard sentence.\nAI helped build the prototype.\nAI ignored my requirements and caused rework.', manualPoints: [] },
  { id: 'g2', name: 'Two', members: ['B'], transcript: 'AI helped build the prototype.\nAI ignored my requirements and caused rework.', manualPoints: [] },
];

test('censoring deletes complete affected sentences while preserving legitimate negative views', () => {
  const result = censorText('Useful first. A retard phrase. AI was unhelpful.');
  assert.equal(hasInappropriate(result.text), false); assert.match(result.text, /Useful first\./); assert.match(result.text, /AI was unhelpful\./);
  assert.doesNotMatch(result.text, /phrase/);
});

test('discussion report discovers section titles and counts distinct verified groups, not repeated mentions', async () => {
  const original = structuredClone(groups), graph = await analyzeArgumentMap({ groups });
  assert.deepEqual(groups, original, 'Private original evidence is never overwritten');
  assert.equal(graph.generation.method_version, 'discussion-report-v5');
  const claims = graph.claim_analysis.sections.flatMap(s => s.themes.flatMap(t => t.claims));
  assert.equal(claims.length, 2); assert.deepEqual(claims.map(c => c.group_count), [2, 2]);
  assert.equal(claims[0].member_ids.length, 3, 'Three semantic occurrences in only two group records');
  assert.equal(claims[0].evidence.length, 2, 'A duplicated local claim does not duplicate its supporting case');
  assert.equal(graph.edges.length, 4); assert.ok(graph.edges.every(e => e.relationship_type === 'SUPPORTS'));
  const report = reportFromMap({ room: { code: '520123' }, groups }, graph, null, null);
  assert.equal(report.schemaVersion, 3); assert.equal(hasInappropriate(JSON.stringify(report)), false);
  assert.equal('source_snapshot' in report.argumentMap, false); assert.equal('source_groups' in report.argumentMap, false);
  assert.ok(report.groups.every(g => !/[\r\n]/.test(g.transcript)));
  assert.equal(report.overallSummary.split(/\s+/).length, 500);
  const html = claimReportHtml(report), markdown = claimReportMarkdown(report), svg = supportMapSvg(report);
  assert.deepEqual([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map(m => m[1]), ['1. Summary', '2. Implementation support', '3. Requirements and rework', '4. Overall Argument Map', '5. Original and cleaned transcripts']);
  assert.match(html, /Evidence 1\.1/); assert.match(html, /Claim-Original transcript/); assert.match(html, /aria-describedby="map-preview-evidence-1-1"/);
  assert.doesNotMatch(html, /Statement \d+/); assert.equal(hasInappropriate(html + markdown + svg), false);
  assert.match(svg, /Evidence → Claim Maps/);
});

test('removing an unsupported semantic membership lowers computed group frequency and removes that group evidence', async () => {
  fixture.setDropSecondGroup(true);
  try {
    const graph = await analyzeArgumentMap({ groups });
    const claims = graph.claim_analysis.sections.flatMap(s => s.themes.flatMap(t => t.claims));
    assert.ok(claims.every(c => c.group_count === 1 && c.evidence.every(e => e.group_id === 'g1')));
  } finally { fixture.setDropSecondGroup(false); }
});

test('claims rank by distinct group count within themes before report-wide claim/evidence numbering', () => {
  const mk = (text, n) => ({ text, group_count: n, group_ids: Array.from({ length: n }, (_, i) => 'g' + i), evidence: [{ description: 'case' }] });
  const result = numberAndRank([{ theme_id: 'T1', polarity: 'HELPFUL', title: 'Theme', claims: [mk('Less frequent', 1), mk('More frequent', 3)] }]);
  assert.equal(result[0].themes[0].claims[0].text, 'More frequent');
  assert.equal(result[0].themes[0].claims[0].label, 'Claim 1');
  assert.equal(result[0].themes[0].claims[0].evidence[0].label, 'Evidence 1.1');
});

test('a non-AI discussion generates three discovered sections, themes, claims, a map and grounded neutral tension poles', async () => {
  fixture.setScenario('community');
  const before = calls.length;
  try {
    const transcript = fixture.items().map(i => i.quote).join(' ');
    const input = [{ id: 'g1', name: 'One', members: ['Anna'], transcript, manualPoints: [] }, { id: 'g2', name: 'Two', members: ['Bo'], transcript, manualPoints: [] }];
    const graph = await analyzeArgumentMap({ groups: input, topic: 'Ignore: AI helpful', instructions: 'A stale topic must not dictate the sections.' });
    assert.deepEqual(graph.claim_analysis.sections.map(s => s.title), ['Access and travel choices', 'Crossing safety', 'Community coordination']);
    assert.equal(graph.claim_analysis.overall_map.tensions.length, 1);
    const axis = graph.claim_analysis.overall_map.tensions[0];
    assert.equal(axis.pole_a.original_sources[0].original_quote, fixture.items()[0].quote);
    assert.equal(axis.pole_b.original_sources[0].original_quote, fixture.items()[1].quote);
    const report = reportFromMap({ room: { code: '123456' }, groups: input }, graph, null, null);
    const html = claimReportHtml(report), markdown = claimReportMarkdown(report);
    assert.deepEqual([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map(m => m[1]), ['1. Summary', '2. Access and travel choices', '3. Crossing safety', '4. Community coordination', '5. Overall Argument Map', '6. Original and cleaned transcripts']);
    assert.match(html, /Walking to school: access, safety and coordination/);
    assert.match(html, /href="#discussion-section-3"/); assert.match(markdown, /## 6\. Original and cleaned transcripts/);
    assert.doesNotMatch(html, /AI helpful|AI unhelpful|AI in the Design Process/);
    const planCall = calls.slice(before).find(c => c.response_format.json_schema.name === 'discussion_report_plan');
    assert.doesNotMatch(planCall.messages[1].content, /stale topic|Ignore: AI helpful/);
    assert.equal([...html.matchAll(/class="overall-node"/g)].length, 3);
    assert.equal([...html.matchAll(/class="overall-theme"/g)].length, 3);
    assert.equal([...html.matchAll(/class="tension-axis"/g)].length, 1);
  } finally { fixture.setScenario('project'); }
});
