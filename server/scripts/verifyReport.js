'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { validateCleanup } = require('../services/transcriptPreparation');
const { validateGraph } = require('../services/argumentMap');
const { analysisText } = require('../services/manualPoints');
const { materializeAnalysis } = require('../services/thematicAnalysis');

const input = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const folder = path.resolve(process.argv[3]);
const report = JSON.parse(fs.readFileSync(path.join(folder, 'report.json'), 'utf8'));
const graph = report.argumentMap;
assert.equal(graph.generation.mode, 'ai');
assert.equal(report.groups.length, input.groups.length);
for (const group of report.groups) {
  const original = input.groups.find(g => g.id === group.id);
  assert.equal(group.transcript, original.transcript, 'Original transcript changed: ' + group.name);
  assert.deepEqual(group.manualPoints, original.manualPoints, 'Original typed text changed');
  assert.equal(group.cleanup.status, 'completed');
  validateCleanup({ cleaned_transcript: group.cleanedTranscript, review_notes: group.cleanup.review_notes }, group.transcript);
}
validateGraph(graph, '', new Map(report.groups.map(g => [String(g.id), analysisText(g)])));
assert.ok(graph.argument_review, 'Explicit candidate-by-candidate review audit is required');
assert.equal(graph.argument_review.decisions.length, graph.argument_review.candidates);
assert.equal(graph.argument_review.decisions.filter(d => d.decision === 'KEEP').length, graph.edges.length);
const expected = new Set(graph.content_analysis.extracted_statements.map(s => s.statement_id));
const assigned = graph.nodes.flatMap(n => n.member_ids);
assert.equal(assigned.length, expected.size);
assert.deepEqual(new Set(assigned), expected);
for (const node of graph.nodes) assert.doesNotMatch(node.normalized_statement.trim(), /^(yeah|okay|ok|thank you|uh|um)[.!]?$/i);
const thematic = report.thematicAnalysis;
assert.equal(thematic.status, 'completed');
const sourceMap = new Map(thematic.codes.flatMap(c => c.sources).map(s => [s.source_id, s]));
materializeAnalysis(thematic, thematic.codes, [...sourceMap.values()]);
for (const source of sourceMap.values()) assert.ok(analysisText(report.groups.find(g => g.id === source.group_id)).includes(source.original_quote));
const html = fs.readFileSync(path.join(folder, 'report.html'), 'utf8');
const labels = [...html.matchAll(/<h4>(Original|Cleaned) Transcript<\/h4>/g)].map(m => m[1]);
assert.deepEqual(labels, report.groups.flatMap(() => ['Original', 'Cleaned']));
const summary = { original_groups_preserved: report.groups.length, cleaned_groups: report.groups.filter(g => g.cleanup.status === 'completed').length,
  statements: graph.nodes.length, relationships: graph.edges.length, themes: thematic.themes.length, codes: thematic.codes.length,
  statement_coverage: assigned.length + '/' + expected.size, paired_transcripts: labels.length / 2,
  reviewed_argument_candidates: graph.argument_review.candidates,
  source_checks: 'All quotations belong to original evidence. Structural checks do not prove every interpretation correct.' };
fs.writeFileSync(path.join(folder, 'verification.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
