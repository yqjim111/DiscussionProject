'use strict';
const fs = require('fs');
const path = require('path');
const { createAnalysisRequest, object, text, strings, mapGroups, hash } = require('./analysisRequest');
const { prepareGroups } = require('./transcriptPreparation');
const { censorGroups, hasInappropriate } = require('./transcriptCensor');
const { originalSources, resolveMention, uniqueSources } = require('./claimReportAnalysis');
const { validateGraph } = require('./argumentMap');
const { analysisText } = require('./manualPoints');
const { TEXT_MODEL } = require('./textModel');
const METHOD_VERSION = 'simple-argument-map-v1';
const array = items => ({ type: 'array', items });
const position = { type: 'string', enum: ['POSITIVE', 'NEGATIVE', 'NEUTRAL'] };
const groupSchema = object({ claims: array(object({ local_id: text, text, conditions: text, position, quotes: array(object({ source_id: text, original_quote: text })) })) });
const themeSchema = object({ themes: array(object({ id: text, title: text, description: text, claims: array(object({ id: text, text, conditions: text, position, member_ids: strings })) })), excluded: array(object({ member_id: text, reason: text })) });
const index = { type: 'integer', minimum: 0 };
const relationSchema = object({ edges: array(object({ id: text, source: text, target: text, relation: { type: 'string', enum: ['SUPPORT', 'AGAINST'] }, rationale: text, source_quote_index: index, target_quote_index: index })) });
const prompt = name => fs.readFileSync(path.join(__dirname, '../prompts/' + name + '_prompt.txt'), 'utf8');
async function analyzeSimpleArgumentMap({ groups, request: supplied, checkpoints, onCheckpoint, onProgress = async () => {} }) {
  const request = supplied || createAnalysisRequest({ checkpoints, onCheckpoint });
  const prepared = await prepareGroups(groups, { request, onProgress });
  const censored = await censorGroups(prepared, { request, onProgress });
  const coded = await mapGroups(censored, async (record, i) => {
    const sources = originalSources(record);
    if (!sources.length) return [];
    await onProgress('Extracting claims · ' + (i + 1) + '/' + groups.length);
    const result = await request('map_claims', groupSchema, prompt('map_claims'), { group_key: 'G' + (i + 1), cleaned_transcript: record.analysisGroup.cleanedTranscript, original_sources: sources.map(({ raw, ...s }) => s) }, r => {
      const ids = new Set();
      for (const c of r.claims) {
        if (!c.local_id.trim() || ids.has(c.local_id) || !c.text.trim() || !c.quotes.length) throw Error('Claims need unique IDs and original quotations');
        ids.add(c.local_id); c.quotes.forEach(q => resolveMention(q, sources, groups[i].id));
      }
      if (hasInappropriate(JSON.stringify(r))) throw Error('Inappropriate transcript text must not be reproduced');
    }, 10000);
    return result.claims.map(c => ({ member_id: 'G' + (i + 1) + ':' + c.local_id, group_id: String(groups[i].id), text: c.text, conditions: c.conditions, position: c.position, sources: uniqueSources(c.quotes.map(q => resolveMention(q, sources, groups[i].id))) }));
  });
  const members = coded.flat(), byMember = new Map(members.map(m => [m.member_id, m]));
  await onProgress('Grouping claims into themes');
  const thematic = members.length ? await request('map_themes', themeSchema, prompt('map_themes'), { claims: members }, r => {
    const assigned = new Set(), ids = new Set(), themeIds = new Set();
    for (const t of r.themes) {
      if (!t.title.trim() || themeIds.has(t.id)) throw Error('Themes need unique IDs and titles'); themeIds.add(t.id);
      for (const c of t.claims) {
        if (!c.text.trim() || ids.has(c.id) || !c.member_ids.length) throw Error('Canonical claims need unique IDs and source members'); ids.add(c.id);
        for (const id of c.member_ids) { if (!byMember.has(id)) throw Error('Unknown source claim ' + id); assigned.add(id); }
      }
    }
    for (const e of r.excluded) { if (!byMember.has(e.member_id) || assigned.has(e.member_id) || !e.reason.trim()) throw Error('Invalid excluded source claim'); assigned.add(e.member_id); }
    const missing = members.filter(m => !assigned.has(m.member_id));
    if (missing.length) throw Error('Missing claim assignments: ' + missing.map(m => m.member_id).join(', '));
    if (hasInappropriate(JSON.stringify(r))) throw Error('Inappropriate theme text');
  }, 15000) : { themes: [], excluded: [] };
  const nodes = [], themes = [];
  for (const [i, t] of thematic.themes.entries()) {
    const claimIds = [];
    for (const c of t.claims) {
      const sources = uniqueSources(c.member_ids.flatMap(id => byMember.get(id).sources));
      const groupIds = [...new Set(c.member_ids.map(id => byMember.get(id).group_id))];
      nodes.push({ node_id: c.id, normalized_statement: c.text, conditions: c.conditions, primary_type: 'CLAIM', topic_position: c.position, sources, group_count: groupIds.length, group_ids: groupIds, theme_id: t.id }); claimIds.push(c.id);
    }
    themes.push({ id: t.id, title: 'Theme ' + (i + 1) + '. ' + t.title, description: t.description, claim_ids: claimIds });
  }
  await onProgress('Analyzing support and against relationships');
  const byId = new Map(nodes.map(n => [n.node_id, n]));
  const related = nodes.length > 1 ? await request('map_relations', relationSchema, prompt('map_relations'), { claims: nodes }, r => {
    const ids = new Set(), pairs = new Set();
    for (const e of r.edges) {
      const pair = [e.source, e.target].sort().join('|'), a = byId.get(e.source), b = byId.get(e.target);
      if (!a || !b || a === b || ids.has(e.id) || pairs.has(pair) || !['SUPPORT', 'AGAINST'].includes(e.relation) || !e.rationale.trim() || !a.sources[e.source_quote_index] || !b.sources[e.target_quote_index]) throw Error('Relationships require unique claim pairs and valid original-quotation indices');
      ids.add(e.id); pairs.add(pair);
    }
    if (hasInappropriate(JSON.stringify(r))) throw Error('Inappropriate relationship text');
  }, 12000) : { edges: [] };
  const edges = related.edges.map(e => ({ edge_id: e.id, source_node_id: e.source, target_node_id: e.target, relationship_type: e.relation === 'SUPPORT' ? 'SUPPORTS' : 'ATTACKS', justification: e.rationale,
    evidence: [{ node_id: e.source, original_quote: byId.get(e.source).sources[e.source_quote_index].original_quote }, { node_id: e.target, original_quote: byId.get(e.target).sources[e.target_quote_index].original_quote }] }));
  validateGraph({ nodes, edges }, '', new Map(censored.map(r => [String(r.analysisGroup.id), analysisText(r.analysisGroup)])));
  return { nodes, edges, themes, cleaned_groups: censored.map(r => r.publicGroup), source_groups: prepared,
    groups: groups.map(g => ({ id: String(g.id), name: g.name, members: g.members || [] })),
    generation: { mode: 'ai', method_version: METHOD_VERSION, model: TEXT_MODEL, warning: '' },
    input: { generated_at: new Date().toISOString(), source: 'whole_group_cleaned_transcripts', input_hash: hash(groups) } };
}
function publicSimpleGraph(graph) {
  if (!graph) return null;
  const { source_groups, source_snapshot, ...safe } = graph;
  return safe;
}
module.exports = { analyzeSimpleArgumentMap, publicSimpleGraph, METHOD_VERSION };
