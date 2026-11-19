'use strict';
const fs = require('fs');
const path = require('path');
const { object, text, strings, createAnalysisRequest, mapGroups } = require('./analysisRequest');
const { prepareGroups, indexSources, resolveQuote } = require('./transcriptPreparation');
const { validateGraph, originalQuote } = require('./argumentMap');
const { analysisText } = require('./manualPoints');
const METHOD_VERSION = 'cleaned-discussion-v2';
const prompt = name => fs.readFileSync(path.join(__dirname, '../prompts/' + name + '_prompt.txt'), 'utf8');
const array = items => ({ type: 'array', items });
const nullable = { type: ['string', 'null'] };
const quote = object({ source_id: text, original_quote: text });
const kinds = { type: 'string', enum: ['experienced', 'planned', 'hypothetical', 'general_opinion', 'retold'] };
const types = { type: 'string', enum: ['CLAIM', 'EVIDENCE', 'EXAMPLE', 'PROPOSAL', 'QUESTION'] };
const positions = { type: 'string', enum: ['POSITIVE', 'NEGATIVE', 'OFF_TOPIC', 'NEUTRAL'] };
const episode = object({ episode_id: text, description: text, project_goal: nullable, task: nullable, ai_interaction: nullable,
  student_action: nullable, reported_outcome: nullable, conditions: nullable, limitations: nullable, account_kind: kinds, quotes: array(quote) });
const statement = object({ normalized_statement: text, primary_type: types, topic_position: positions, account_kind: kinds, episode_ids: strings, quotes: array(quote) });
const extractionSchema = object({ episodes: array(episode), statements: array(statement), exclusions: array(object({ original_excerpt: text, reason: text })) });
const mergeSchema = object({ clusters: array(object({ member_ids: strings, normalized_statement: text, primary_type: types, topic_position: positions, account_kind: kinds })),
  retellings: array(object({ episode_ids: strings, status: { type: 'string', enum: ['confirmed_retelling', 'suspected_retelling'] }, reason: text })) });
const retellingSchema = object({ retellings: mergeSchema.properties.retellings });
const edgeSchema = object({ edges: array(object({ source_node_id: text, target_node_id: text,
  relationship_type: { type: 'string', enum: ['SUPPORTS', 'ATTACKS', 'SIMILAR_TO'] }, justification: text,
  evidence_refs: array(object({ node_id: text, source_index: { type: 'integer' } })) })) });
const edgeReviewSchema = object({ decisions: array(object({ candidate_id: text, decision: { type: 'string', enum: ['KEEP', 'REMOVE'] }, reason: text,
  source_node_id: nullable, target_node_id: nullable,
  relationship_type: { type: ['string', 'null'], enum: ['SUPPORTS', 'ATTACKS', 'SIMILAR_TO', null] },
  evidence_refs: array(object({ node_id: text, source_index: { type: 'integer' } })) })) });

function materializeEdges(candidate, nodes, groups, { allowCandidateConflicts = false } = {}) {
  if (!Array.isArray(candidate?.edges)) throw new Error('Missing edges');
  const byNode = new Map(nodes.map(n => [n.node_id, n]));
  const edges = candidate.edges.map((edge, i) => {
    const evidence = (edge.evidence_refs || []).map(ref => {
      const source = byNode.get(ref.node_id)?.sources[ref.source_index];
      if (!source) throw new Error('Unknown edge evidence reference');
      return { node_id: ref.node_id, original_quote: source.original_quote };
    });
    if (![edge.source_node_id, edge.target_node_id].every(id => evidence.some(e => e.node_id === id))) throw new Error('Both edge endpoints require selected evidence');
    return { ...edge, edge_id: 'E' + (i + 1), evidence };
  });
  const allowed = new Map(groups.map(g => [String(g.id), analysisText(g)]));
  if (allowCandidateConflicts) {
    // Identification is a proposal stage: independently validate every proposed
    // edge, but let the verification pass resolve conflicting pair directions.
    const pairs = new Set(), unique = [], conflicts = [];
    for (const edge of edges) {
      const pair = [edge.source_node_id, edge.target_node_id].sort().join('|');
      if (pairs.has(pair)) conflicts.push(edge); else { pairs.add(pair); unique.push(edge); }
    }
    validateGraph({ nodes, edges: unique }, '', allowed);
    for (const edge of conflicts) validateGraph({ nodes, edges: [edge] }, '', allowed);
    return { nodes, edges };
  }
  return validateGraph({ nodes, edges }, '', allowed);
}

async function reviewArgumentEdges({ candidates, nodes, groups, request, onProgress = async () => {} }) {
  const pairGroups = new Map();
  candidates.forEach((edge, i) => {
    const pair = [edge.source_node_id, edge.target_node_id].sort().join('|');
    if (!pairGroups.has(pair)) pairGroups.set(pair, []);
    pairGroups.get(pair).push({ ...edge, candidate_id: 'C' + (i + 1) });
  });
  const pairs = [...pairGroups.values()], batches = [];
  for (let i = 0; i < pairs.length; i += 12) batches.push(pairs.slice(i, i + 12).flat());
  const results = await mapGroups(batches, async (batch, index) => {
    await onProgress('Reviewing individual argument candidates · ' + (index + 1) + '/' + batches.length);
    const ids = new Set(batch.flatMap(e => [e.source_node_id, e.target_node_id]));
    const selected = nodes.filter(n => ids.has(n.node_id));
    const groupIds = new Set(selected.flatMap(n => n.sources.map(s => s.group_id)));
    const data = { candidates: batch, nodes: selected.map(n => ({ node_id: n.node_id, normalized_statement: n.normalized_statement,
      account_kind: n.account_kind, sources: n.sources.map(s => ({ group_id: s.group_id, original_quote: s.original_quote })) })),
      group_context: groups.filter(g => groupIds.has(String(g.id))).map(g => ({ group_id: String(g.id), cleaned_transcript: g.cleanedTranscript })) };
    const byCandidate = new Map(batch.map(e => [e.candidate_id, e]));
    const keptEdges = result => result.decisions.filter(d => d.decision === 'KEEP').map(d => ({
      source_node_id: d.source_node_id, target_node_id: d.target_node_id, relationship_type: d.relationship_type, justification: d.reason, evidence_refs: d.evidence_refs }));
    const result = await request('argument_edge_review', edgeReviewSchema, prompt('argument_edge_review'), data, result => {
      const seen = new Set();
      if (!Array.isArray(result?.decisions)) throw new Error('Every candidate needs a review decision');
      for (const decision of result.decisions) {
        const candidate = byCandidate.get(decision.candidate_id);
        if (!candidate || seen.has(decision.candidate_id) || !decision.reason?.trim()) throw new Error('Unknown, duplicated or unexplained review decision');
        seen.add(decision.candidate_id);
        if (decision.decision === 'KEEP' && [candidate.source_node_id, candidate.target_node_id].sort().join('|') !== [decision.source_node_id, decision.target_node_id].sort().join('|')) throw new Error('Review cannot change the candidate endpoint pair');
      }
      if (seen.size !== batch.length) throw new Error('Review must explicitly KEEP or REMOVE every candidate');
      materializeEdges({ edges: keptEdges(result) }, nodes, groups);
    }, 8000);
    return { edges: keptEdges(result), decisions: result.decisions.map(d => ({ ...d, candidate: byCandidate.get(d.candidate_id) })) };
  });
  return { graph: materializeEdges({ edges: results.flatMap(r => r.edges) }, nodes, groups), decisions: results.flatMap(r => r.decisions) };
}

async function analyzeDiscussion({ groups, onProgress = async () => {}, checkpoints, onCheckpoint, request: suppliedRequest }) {
  const request = suppliedRequest || createAnalysisRequest({ checkpoints, onCheckpoint });
  const cleanedGroups = await prepareGroups(groups, { request, onProgress });
  const sources = indexSources(cleanedGroups), extracted = [], episodes = [], exclusions = [];
  await mapGroups(cleanedGroups, async (group, i) => {
    const groupSources = sources.filter(s => s.group_id === String(group.id));
    if (!groupSources.length) return;
    await onProgress('Extracting complete experiences and statements · ' + (i + 1) + '/' + groups.length + ' · ' + group.name);
    const data = { group_id: String(group.id), group_name: group.name, cleaned_transcript: group.cleanedTranscript, original_sources: groupSources };
    const validate = result => {
      if (!Array.isArray(result?.statements) || !Array.isArray(result.episodes) || !Array.isArray(result.exclusions)) throw new Error('Invalid content extraction');
      const ids = new Set();
      for (const ep of result.episodes) { if (!ep.episode_id || ids.has(ep.episode_id)) throw new Error('Duplicate episode ID'); ids.add(ep.episode_id); }
      for (const record of [...result.episodes, ...result.statements]) {
        if (!record.quotes?.length) throw new Error('Every substantive record needs original evidence');
        record.quotes.forEach(q => resolveQuote(q, groupSources));
      }
      for (const item of result.statements) if (!item.normalized_statement?.trim() || item.episode_ids.some(id => !ids.has(id))) throw new Error('Invalid statement or episode reference');
      for (const item of result.exclusions) {
        if (item.citation_status === 'unverified' && item.original_excerpt === null) continue;
        const exact = groupSources.map(s => originalQuote(s.original_quote, item.original_excerpt)).find(Boolean);
        // Coverage annotations are not student evidence. Keep a nonverbatim
        // diagnostic explicitly unverified; it cannot ground any node or edge.
        if (!exact) {
          item.unverified_excerpt = item.original_excerpt;
          item.original_excerpt = null;
          item.citation_status = 'unverified';
        } else { item.original_excerpt = exact; item.citation_status = 'exact'; }
      }
    };
    const candidate = await request('group_content', extractionSchema, prompt('content_extraction'), data, validate);
    const result = await request('group_content_review', extractionSchema,
      prompt('content_extraction') + '\nINDEPENDENT REVIEW: Compare every candidate with the complete original and cleaned group. Correct invented meanings, missing qualifiers, hypothetical/experienced confusion and fragmented propositions. Check all substantive original passages for omissions and restore them. Return the complete corrected extraction, not a review verdict.',
      { ...data, candidate }, validate);
    const prefix = 'G' + (i + 1) + ':';
    episodes.push(...result.episodes.map(ep => ({ ...ep, episode_id: prefix + ep.episode_id, group_id: String(group.id), sources: ep.quotes.map(q => resolveQuote(q, groupSources)) })));
    extracted.push(...result.statements.map((s, j) => ({ ...s, statement_id: prefix + 'S' + (j + 1), episode_ids: s.episode_ids.map(id => prefix + id), sources: s.quotes.map(q => resolveQuote(q, groupSources)) })));
    exclusions.push(...result.exclusions.map(item => ({ ...item, group_id: String(group.id) })));
  });
  extracted.sort((a, b) => a.statement_id.localeCompare(b.statement_id, undefined, { numeric: true }));
  episodes.sort((a, b) => a.episode_id.localeCompare(b.episode_id, undefined, { numeric: true }));
  exclusions.sort((a, b) => a.group_id.localeCompare(b.group_id));
  if (!extracted.length) return { nodes: [], edges: [], cleaned_groups: cleanedGroups,
    content_analysis: { episodes, exclusions, retellings: [], extracted_statements: [] }, generation: { mode: 'ai', method_version: METHOD_VERSION, warning: 'No substantive statements were identified.' } };
  await onProgress('Consolidating all groups and tracing snowball retellings');
  // Transmit each selected original quotation once. Repeating full provenance
  // and the same episode quotations in every record inflated the global request.
  const originalEvidence = [], evidenceIds = new Map();
  const packSources = sources => [...new Set(sources.map(source => {
    const key = JSON.stringify([source.group_id, source.original_quote, source.source_kind, source.contribution_id]);
    if (!evidenceIds.has(key)) {
      const evidence_id = 'R' + (originalEvidence.length + 1);
      evidenceIds.set(key, evidence_id);
      originalEvidence.push({ evidence_id, group_id: source.group_id, original_quote: source.original_quote,
        source_kind: source.source_kind, duplicate_of: source.duplicate_of });
    }
    return evidenceIds.get(key);
  }))];
  const inventory = extracted.map(({ quotes, sources, ...item }) => ({ ...item, evidence_ids: packSources(sources) }));
  const episodeInventory = episodes.map(({ quotes, sources, ...item }) => ({ ...item, evidence_ids: packSources(sources) }));
  const validateRetellings = result => {
    const episodeIds = new Set(episodes.map(e => e.episode_id));
    const retained = [];
    for (const item of result.retellings || []) {
      const ids = [...new Set(item.episode_ids)];
      if (ids.length < 2 || ids.some(id => !episodeIds.has(id))) {
        (result.rejected_retellings ||= []).push({ ...item, validation_issue: 'References do not identify at least two distinct supplied episodes; not accepted as a retelling link.' });
      } else retained.push({ ...item, episode_ids: ids });
    }
    result.retellings = retained;
  };
  const validateMerge = result => {
    const ids = new Set(extracted.map(s => s.statement_id)), seen = new Set();
    for (const cluster of result.clusters || []) {
      if (!cluster.member_ids?.length || !cluster.normalized_statement?.trim()) throw new Error('Empty statement cluster');
      for (const id of cluster.member_ids) { if (!ids.has(id) || seen.has(id)) throw new Error('Unknown or multiply assigned statement ' + id); seen.add(id); }
    }
    if (seen.size !== ids.size) throw new Error('Every original statement must be represented exactly once');
    validateRetellings(result);
  };
  const mergeData = { statements: inventory, episodes: episodeInventory, original_evidence: originalEvidence };
  const candidateMerge = await request('content_merge', mergeSchema, prompt('content_merge'), mergeData, validateMerge, 24000);
  const consolidated = await request('content_merge_review', mergeSchema,
    prompt('content_merge') + '\nINDEPENDENT REVIEW: Check each cluster against its complete original member statements and evidence. Split false equivalents, restore lost qualifications, correct unsupported normalized wording and overconfident retelling identity. Preserve every member exactly once. Return the complete corrected consolidation.',
    { ...mergeData, candidate: candidateMerge }, validateMerge, 24000);
  const byId = new Map(extracted.map(s => [s.statement_id, s]));
  const nodes = consolidated.clusters.map((c, i) => ({ node_id: 'N' + (i + 1), normalized_statement: c.normalized_statement,
    primary_type: c.primary_type, topic_position: c.topic_position, account_kind: c.account_kind, member_ids: c.member_ids,
    episode_ids: [...new Set(c.member_ids.flatMap(id => byId.get(id).episode_ids))],
    sources: [...new Map(c.member_ids.flatMap(id => byId.get(id).sources).map(s => [JSON.stringify(s), s])).values()] }));
  validateGraph({ nodes, edges: [] }, '', new Map(cleanedGroups.map(g => [String(g.id), analysisText(g)])));
  const context = cleanedGroups.map(g => ({ group_id: String(g.id), cleaned_transcript: g.cleanedTranscript }));
  const relationNodes = nodes.map(n => ({ node_id: n.node_id, normalized_statement: n.normalized_statement,
    primary_type: n.primary_type, topic_position: n.topic_position, account_kind: n.account_kind,
    sources: n.sources.map(s => ({ group_id: s.group_id, original_quote: s.original_quote })) }));
  await onProgress('Identifying evidence-grounded argument relationships');
  const relations = await request('argument_relations', edgeSchema, prompt('argument_relations'), { nodes: relationNodes, groups: context }, r => materializeEdges(r, nodes, cleanedGroups, { allowCandidateConflicts: true }));
  const reviewedEdges = await reviewArgumentEdges({ candidates: relations.edges, nodes, groups: cleanedGroups, request, onProgress });
  let retellingAnalysis = consolidated;
  if (episodes.length >= 2) {
    const usedEvidence = new Set(episodeInventory.flatMap(ep => ep.evidence_ids));
    const retellingData = { episodes: episodeInventory, original_evidence: originalEvidence.filter(e => usedEvidence.has(e.evidence_id)),
      group_metadata: cleanedGroups.map(g => ({ group_id: String(g.id), group_name: g.name, members: g.members || [] })) };
    await onProgress('Tracing snowball experiences with available group metadata');
    const candidate = await request('snowball_retellings', retellingSchema, prompt('snowball_retelling'), retellingData, validateRetellings, 8000);
    await onProgress('Reviewing confirmed and uncertain snowball links');
    retellingAnalysis = await request('snowball_review', retellingSchema, prompt('snowball_retelling') + '\nPerform the independent review task. Shared membership is never sufficient proof.',
      { ...retellingData, candidate }, validateRetellings, 8000);
  }
  return { ...reviewedEdges.graph, cleaned_groups: cleanedGroups,
    argument_review: { candidates: relations.edges.length, kept: reviewedEdges.graph.edges.length, decisions: reviewedEdges.decisions },
    content_analysis: { episodes, exclusions, retellings: retellingAnalysis.retellings, retelling_review_notes: retellingAnalysis.rejected_retellings || [], extracted_statements: extracted },
    generation: { mode: 'ai', method_version: METHOD_VERSION, warning: '' } };
}
module.exports = { analyzeDiscussion, materializeEdges, reviewArgumentEdges, METHOD_VERSION };
