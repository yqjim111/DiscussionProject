'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { originalQuote, validateGraph } = require('../services/argumentMap');
const { analysisText } = require('../services/manualPoints');
const { hash } = require('../services/analysisRequest');
const { hasInappropriate } = require('../services/transcriptCensor');
const folder = path.resolve(process.argv[2]);
const report = JSON.parse(fs.readFileSync(path.join(folder, 'report.json'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
assert.equal(report.schemaVersion, 3);
assert.equal(hasInappropriate(JSON.stringify(report)), false);
assert.equal('source_groups' in report.argumentMap, false);
assert.equal('source_snapshot' in report.argumentMap, false);
for (const group of report.groups) {
  assert.doesNotMatch(group.transcript, /[\r\n]/);
  assert.equal(group.censor.raw_hash, hash(raw.groups.find(g => g.id === group.id).transcript));
}
const words = report.overallSummary.match(/\S+/gu).length;
assert.ok(words >= 450 && words <= 550);
assert.doesNotMatch(report.overallSummary, /\bevidence\b|\b(?:claim|group)\s*\d+/iu);
const claims = [], seenNumbers = new Set(); let expected = 1;
const checkSources = sources => {
  for (const source of sources) {
    const g = report.groups.find(g => g.id === source.group_id);
    const text = source.source_kind === 'manual' ? g.manualPoints.find(p => p.id === source.contribution_id).text : g.transcript;
    assert.ok(originalQuote(text, source.original_quote), 'Citation not found in eligible displayed original');
    assert.equal(hasInappropriate(source.original_quote), false);
  }
};
for (const section of report.claimAnalysis.sections) for (const theme of section.themes) {
  const counts = theme.claims.map(c => c.group_count);
  assert.deepEqual(counts, [...counts].sort((a, b) => b - a));
  for (const claim of theme.claims) {
    assert.equal(claim.number, expected++); assert.equal(seenNumbers.has(claim.number), false); seenNumbers.add(claim.number);
    assert.equal(claim.group_count, new Set(claim.group_ids).size);
    assert.deepEqual(new Set(claim.group_ids), new Set(claim.original_sources.map(s => s.group_id)));
    const memberGroups = claim.member_ids.map(id => report.groups[Number(id.match(/^G(\d+):/)[1]) - 1].id);
    assert.deepEqual(new Set(memberGroups), new Set(claim.group_ids));
    checkSources(claim.original_sources);
    for (const [index, e] of claim.evidence.entries()) {
      assert.equal(e.number, claim.number + '.' + (index + 1)); assert.ok(claim.group_ids.includes(e.group_id));
      assert.ok(['experienced', 'retold'].includes(e.account_kind)); checkSources(e.original_sources);
    }
    claims.push(claim);
  }
}
validateGraph(report.argumentMap, '', new Map(report.groups.map(g => [String(g.id), analysisText(g)])));
assert.ok(report.argumentMap.edges.every(e => e.relationship_type === 'SUPPORTS'));
assert.equal(report.argumentMap.edges.length, claims.reduce((n, c) => n + c.evidence.length, 0));
const html = fs.readFileSync(path.join(folder, 'report.html'), 'utf8');
const overall = report.claimAnalysis.overall_map;
if (overall) {
  assert.deepEqual(new Set(overall.node_ids), new Set(claims.map(c => c.id)));
  require('../services/overallClaimRelations').validateRelations({ edges: overall.edges, rejected_ids: [] }, claims);
  assert.equal([...html.matchAll(/class="overall-node"/g)].length, claims.length);
  if (['overall-claims-v2', 'overall-claims-v3'].includes(overall.method_version)) {
    const inventory = report.claimAnalysis.sections.flatMap(s => s.themes.flatMap(t => t.claims.map(c => ({ ...c, polarity: s.polarity, original_quotes: c.original_sources }))));
    const cross = overall.edges.filter(e => e.relation !== 'SUPPORT' && (overall.method_version === 'overall-claims-v3' || inventory.find(c => c.id === e.source).polarity !== inventory.find(c => c.id === e.target).polarity));
    require('../services/overallClaimRelations').validateAxes({ axes: overall.tensions, excluded_relation_ids: [] }, inventory, cross);
    for (const axis of overall.tensions) { checkSources((axis.pole_a || axis.helpful_pole).original_sources); checkSources((axis.pole_b || axis.risk_pole).original_sources); }
    assert.equal([...html.matchAll(/class="overall-theme"/g)].length, report.claimAnalysis.sections.flatMap(s => s.themes).length);
    assert.equal([...html.matchAll(/data-theme-link="true"/g)].length, claims.length);
    assert.ok([...html.matchAll(/data-relation="([^"]+)"/g)].every(m => ['support', 'against', 'tension'].includes(m[1])));
    assert.equal([...html.matchAll(/class="tension-axis"/g)].length, overall.tensions.length);
  }
}
assert.equal([...html.matchAll(/<details class="transcript-group"/g)].length, report.groups.length);
assert.deepEqual([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map(m => m[1]), ['1. Summary', ...report.claimAnalysis.sections.map((s, i) => (i + 2) + '. ' + s.title), (report.claimAnalysis.sections.length + 2) + '. Overall Argument Map', (report.claimAnalysis.sections.length + 3) + '. Original and cleaned transcripts']);
assert.equal([...html.matchAll(/<h4>Original Transcript<\/h4>/g)].length, report.groups.length);
assert.equal([...html.matchAll(/<h4>Cleaned Transcript<\/h4>/g)].length, report.groups.length);
assert.doesNotMatch(html, /Statement \d+/);
for (const name of ['report.html', 'report.md', 'report.json', 'argument-map.svg', 'argument-maps.html']) assert.equal(hasInappropriate(fs.readFileSync(path.join(folder, name), 'utf8')), false, name);
const result = { sections: report.claimAnalysis.sections.length + 3, summary_words: words, paired_group_transcripts: report.groups.length,
  discussion_sections: report.claimAnalysis.sections.map(s => ({ title: s.title, claims: s.themes.reduce((n, t) => n + t.claims.length, 0) })),
  claims: claims.length, overall_claim_relations: overall?.edges.length || 0, tension_axes: overall?.tensions?.length || 0, evidence_support_links: report.argumentMap.edges.length, distinct_group_counts_and_sort: 'passed',
  censorship_and_private_source_exclusion: 'passed', citation_checks: 'passed' };
fs.writeFileSync(path.join(folder, 'verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
