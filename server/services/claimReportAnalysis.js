'use strict';
const fs = require('fs');
const path = require('path');
const { createAnalysisRequest, object, text, strings, mapGroups, hash } = require('./analysisRequest');
const { prepareGroups } = require('./transcriptPreparation');
const { censorGroups, hasInappropriate } = require('./transcriptCensor');
const { originalQuote, validateGraph } = require('./argumentMap');
const { analysisText } = require('./manualPoints');
const { TEXT_MODEL } = require('./textModel');
const { REPORT_PIPELINE_VERSION: METHOD_VERSION } = require('../../lib/reportVersion');
const prompt = name => fs.readFileSync(path.join(__dirname, '../prompts/' + name + '_prompt.txt'), 'utf8');
const array = items => ({ type: 'array', items });
const quote = object({ source_id: text, original_quote: text });
function analysisSchemas(sectionIds) {
const polarity = { type: 'string', enum: sectionIds };

const groupSchema = object({
  claims: array(object({ local_id: text, polarity, text, conditions: text, mentions: array(quote), evidence_ids: strings })),
  evidence: array(object({ local_id: text, description: text, account_kind: { type: 'string', enum: ['experienced', 'retold', 'planned', 'hypothetical', 'unclear'] }, quotes: array(quote) })),
  exclusions: array(object({ reason: text })),
});
const hierarchySchema = object({ themes: array(object({ theme_id: text, polarity, title: text, description: text,
  claims: array(object({ claim_key: text, text, conditions: text, member_ids: strings })) })),
  excluded_members: array(object({ member_id: text, reason: text })) });
return { groupSchema, hierarchySchema };
}
const decision = { type: 'string', enum: ['KEEP', 'REMOVE'] };
const supportSchema = object({ claim_text: text, conditions: text,
  member_decisions: array(object({ member_id: text, decision, reason: text })),
  evidence_decisions: array(object({ evidence_id: text, decision, reason: text })) });
const uniqueSources = sources => [...new Map(sources.map(s => [JSON.stringify([s.group_id, s.source_kind, s.contribution_id, s.original_quote]), s])).values()];

function originalSources(record) {
  const g = record.analysisGroup, raw = record.privateGroup;
  return [{ source_id: 'T', text: g.transcript, raw: raw.transcript, source_kind: 'transcript', contribution_id: null },
    ...(g.manualPoints || []).map((p, i) => ({ source_id: 'M' + (i + 1), text: p.text, raw: raw.manualPoints?.find(r => r.id === p.id)?.text || '', source_kind: 'manual', contribution_id: p.id }))]
    .filter(s => s.text?.trim());
}
function resolveMention(q, available, groupId) {
  const source = available.find(s => s.source_id === q.source_id);
  let eligible = source && originalQuote(source.text, q.original_quote);
  // Restore capitalization-only quotation differences to the real source text;
  // changed words or punctuation still cannot pass this match.
  if (!eligible && source && q.original_quote?.trim().length >= 20) {
    const pattern = q.original_quote.trim().split(/\s+/u).map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    eligible = source.text.match(new RegExp(pattern, 'iu'))?.[0];
  }
  const raw = eligible && originalQuote(source.raw, eligible);
  const exact = raw || eligible;
  if (!exact || hasInappropriate(exact)) throw new Error('Quote must match an eligible original passage without changed wording or punctuation: ' + String(q.original_quote).slice(0, 160));
  q.original_quote = exact;
  return { group_id: String(groupId), original_quote: exact, source_kind: source.source_kind, contribution_id: source.contribution_id,
    speaker_id: null, timestamp: null, source_location: null, citation_basis: raw ? 'original' : 'censored_original' };
}
function validateHierarchy(result, members, requireCoverage = false) {
  const byId = new Map(members.map(m => [m.member_id, m])), seen = new Set(), themes = new Set(), claims = new Set(), texts = new Set();
  for (const theme of result.themes) {
    if (!theme.title?.trim() || themes.has(theme.theme_id)) throw new Error('Invalid or duplicate theme'); themes.add(theme.theme_id);
    for (const claim of theme.claims) {
      if (!claim.text?.trim() || claims.has(claim.claim_key) || !claim.member_ids.length) throw new Error('Invalid or duplicate canonical claim'); claims.add(claim.claim_key);
      const key = theme.polarity + ':' + claim.text.trim().toLowerCase() + ':' + claim.conditions.trim().toLowerCase();
      if (texts.has(key)) throw new Error('Identical canonical claims must be merged'); texts.add(key);
      claim.member_ids = [...new Set(claim.member_ids)];
      for (const id of claim.member_ids) {
        if (!byId.has(id) || byId.get(id).polarity !== theme.polarity) throw new Error('Unknown or cross-polarity member ' + id);
        seen.add(id);
      }
    }
  }
  for (const item of result.excluded_members) {
    if (!byId.has(item.member_id) || seen.has(item.member_id) || !item.reason?.trim()) throw new Error('Invalid excluded claim member');
    seen.add(item.member_id);
  }
  result.unassigned_member_ids = members.filter(m => !seen.has(m.member_id)).map(m => m.member_id);
  if (requireCoverage && result.unassigned_member_ids.length) throw new Error('Missing semantic assignments for: ' + result.unassigned_member_ids.join(', '));
  if (hasInappropriate(JSON.stringify(result))) throw new Error('Do not reproduce inappropriate transcription content in analysis');
}
function reviewDecisions(items, records, idKey) {
  const ids = new Set(records.map(r => r[idKey])), seen = new Set();
  for (const item of items) {
    if (!ids.has(item[idKey]) || seen.has(item[idKey]) || !item.reason?.trim()) throw new Error('Unknown, duplicate or unexplained support review ID');
    seen.add(item[idKey]);
  }
  if (seen.size !== ids.size) throw new Error('Every proposed membership/evidence link requires an explicit review decision');
}
function numberAndRank(themes, definitions) {
  const configured = definitions || [...new Set(themes.map(t => t.polarity))].map(id => ({ id, title: id }));
  const sections = configured.map((definition, color_index) => {
    const polarity = definition.id;
    const selected = themes.filter(t => t.polarity === polarity && t.claims.length).map(theme => {
      theme.claims.sort((a, b) => b.group_count - a.group_count || a.text.localeCompare(b.text));
      return { ...theme, group_ids: [...new Set(theme.claims.flatMap(c => c.group_ids))] };
    });
    selected.sort((a, b) => (b.claims[0]?.group_count || 0) - (a.claims[0]?.group_count || 0) || b.group_ids.length - a.group_ids.length || a.title.localeCompare(b.title));
    return { polarity, title: definition.title, focus: definition.focus || '', color_index, themes: selected };
  }).filter(s => s.themes.length);
  let number = 0;
  for (const section of sections) for (const theme of section.themes) for (const claim of theme.claims) {
    claim.number = ++number; claim.id = 'claim-' + number; claim.label = 'Claim ' + number;
    claim.evidence = claim.evidence.map((e, i) => ({ ...e, id: 'evidence-' + number + '-' + (i + 1), number: number + '.' + (i + 1), label: 'Evidence ' + number + '.' + (i + 1) }));
  }
  return sections;
}
function supportGraph(analysis, groups) {
  const nodes = [], edges = [];
  for (const section of analysis.sections) for (const theme of section.themes) for (const claim of theme.claims) {
    const claimId = 'C' + claim.number, position = section.polarity === 'HELPFUL' ? 'POSITIVE' : section.polarity === 'UNHELPFUL' ? 'NEGATIVE' : 'NEUTRAL';
    nodes.push({ node_id: claimId, normalized_statement: claim.text, primary_type: 'CLAIM', topic_position: position,
      theme_id: theme.theme_id, claim_number: claim.number, group_count: claim.group_count, sources: claim.original_sources });
    for (const [i, evidence] of claim.evidence.entries()) {
      const id = 'E' + claim.number + '_' + (i + 1);
      nodes.push({ node_id: id, normalized_statement: evidence.description, primary_type: 'EXAMPLE', topic_position: position,
        theme_id: theme.theme_id, claim_number: claim.number, evidence_number: evidence.number, sources: evidence.original_sources });
      const targetSource = claim.original_sources.find(s => s.group_id === evidence.group_id) || claim.original_sources[0];
      edges.push({ edge_id: 'L' + (edges.length + 1), source_node_id: id, target_node_id: claimId, relationship_type: 'SUPPORTS', justification: evidence.support_reason,
        evidence: [{ node_id: id, original_quote: evidence.original_sources[0].original_quote }, { node_id: claimId, original_quote: targetSource.original_quote }] });
    }
  }
  validateGraph({ nodes, edges }, '', new Map(groups.map(g => [String(g.id), analysisText(g)])));
  return { nodes, edges };
}

async function analyzeClaimReport({ groups, baseGraph, request: suppliedRequest, checkpoints, onCheckpoint, onProgress = async () => {} }) {
  const request = suppliedRequest || createAnalysisRequest({ checkpoints, onCheckpoint });
  const prepared = await prepareGroups(groups, { request, onProgress });
  const censored = await censorGroups(prepared, { request, onProgress });
  const { discoverReportPlan } = require('./discussionReportPlan');
  const plan = await discoverReportPlan(censored, { request, onProgress });
  const sectionIds = plan.sections.map(s => s.id);
  const { groupSchema, hierarchySchema } = analysisSchemas(sectionIds);
  const analyticQuestions = Object.fromEntries(plan.sections.map(s => [s.id, s.questions]));
  const coded = await mapGroups(censored, async (record, i) => {
    const group = record.analysisGroup, available = originalSources(record);
    if (!available.length) return { members: [], cases: [], exclusions: [] };
    await onProgress('Coding discussion claims and supporting cases · ' + (i + 1) + '/' + groups.length);
    const prior = (baseGraph?.nodes || []).filter(n => n.sources?.some(s => s.group_id === String(group.id)) && !hasInappropriate(n.normalized_statement)).map(n => n.normalized_statement);
    const data = { group_key: 'G' + (i + 1), analysis_plan: plan, analytic_questions: analyticQuestions, cleaned_transcript: group.cleanedTranscript,
      original_sources: available.map(({ raw, ...s }) => s), prior_ideas: prior };
    const validate = result => {
      const claimIds = new Set(), evidenceIds = new Set();
      for (const evidence of result.evidence) {
        if (!evidence.local_id || evidenceIds.has(evidence.local_id) || !evidence.quotes.length || !evidence.description?.trim()) throw new Error('Invalid supporting case');
        evidenceIds.add(evidence.local_id); evidence.quotes.forEach(q => resolveMention(q, available, group.id));
      }
      for (const claim of result.claims) {
        if (!sectionIds.includes(claim.polarity) || !claim.local_id || claimIds.has(claim.local_id) || !claim.mentions.length || !claim.text?.trim() || claim.evidence_ids.some(id => !evidenceIds.has(id))) throw new Error('Invalid group-level claim');
        claimIds.add(claim.local_id); claim.mentions.forEach(q => resolveMention(q, available, group.id));
      }
      if (hasInappropriate(JSON.stringify(result))) throw new Error('Inappropriate transcription text must not appear in claims or evidence');
    };
    const result = await request('group_claim_coding', groupSchema, prompt('claim_group_coding'), data, validate, 12000);
    const prefix = 'G' + (i + 1) + ':';
    return {
      members: result.claims.map(c => ({ member_id: prefix + c.local_id, group_id: String(group.id), group_key: 'G' + (i + 1), polarity: c.polarity,
        text: c.text, conditions: c.conditions, original_sources: uniqueSources(c.mentions.map(q => resolveMention(q, available, group.id))), evidence_ids: c.evidence_ids.map(id => prefix + id) })),
      cases: result.evidence.map(e => ({ evidence_id: prefix + e.local_id, group_id: String(group.id), description: e.description, account_kind: e.account_kind,
        original_sources: uniqueSources(e.quotes.map(q => resolveMention(q, available, group.id))) })),
      exclusions: result.exclusions.map(e => ({ group_id: String(group.id), reason: e.reason })),
    };
  });
  const members = coded.flatMap(c => c.members), cases = coded.flatMap(c => c.cases);
  const byMember = new Map(members.map(m => [m.member_id, m])), byCase = new Map(cases.map(e => [e.evidence_id, e]));
  const inventory = members.map(m => ({ member_id: m.member_id, group_key: m.group_key, polarity: m.polarity, text: m.text, conditions: m.conditions,
    original_quotes: m.original_sources.map(s => s.original_quote) }));
  await onProgress('Developing semantic themes and shared claims within discovered sections');
  const synthesisData = { analysis_plan: plan, analytic_questions: analyticQuestions, group_claims: inventory };
  const candidate = members.length ? await request('claim_semantic_synthesis', hierarchySchema, prompt('claim_semantic_synthesis'), synthesisData, r => validateHierarchy(r, members), 18000) : { themes: [], excluded_members: [] };
  await onProgress('Reviewing canonical claim meanings, conditions and group membership');
  const hierarchy = members.length ? await request('claim_semantic_review', hierarchySchema, prompt('claim_semantic_synthesis'), { ...synthesisData, candidate }, r => validateHierarchy(r, members), 18000) : candidate;
  if (hierarchy.unassigned_member_ids?.length) {
    await onProgress('Checking omitted group mentions before computing frequencies');
    const missing = hierarchy.unassigned_member_ids.map(id => byMember.get(id));
    const existing = new Map(hierarchy.themes.flatMap(t => t.claims.map(c => [c.claim_key, { theme: t, claim: c }])));
    const supplements = await mapGroups(missing, async member => request('claim_semantic_coverage', hierarchySchema,
      prompt('claim_semantic_synthesis') + '\nCOVERAGE REPAIR: Return ONLY assignments for the supplied missing_members, not the full previous hierarchy. Reuse an existing theme_id and claim_key when that claim genuinely matches; include ONLY the missing member IDs in its member_ids. If no existing claim fits, add a distinct grounded claim under a suitable existing/new theme. Explicitly exclude only content outside the analytic questions or unclear content, with a real reason. Do not omit any supplied missing member.',
      { analysis_plan: plan, analytic_questions: analyticQuestions, existing_hierarchy: hierarchy.themes.map(t => ({ theme_id: t.theme_id, polarity: t.polarity, title: t.title, description: t.description, claims: t.claims.map(c => ({ claim_key: c.claim_key, text: c.text, conditions: c.conditions })) })),
        missing_members: [member] }, r => {
        validateHierarchy(r, [member], true);
        for (const theme of r.themes) for (const claim of theme.claims) {
          const prior = existing.get(claim.claim_key);
          if (prior && (prior.theme.theme_id !== theme.theme_id || prior.theme.polarity !== theme.polarity)) throw new Error('A reused canonical claim key must retain its theme and polarity');
        }
      }, 5000));
    for (const supplement of supplements) {
    for (const addition of supplement.themes) {
      let theme = hierarchy.themes.find(t => t.theme_id === addition.theme_id);
      if (!theme) { theme = { ...addition, claims: [] }; hierarchy.themes.push(theme); }
      for (const claim of addition.claims) {
        const prior = theme.claims.find(c => c.claim_key === claim.claim_key);
        if (prior) prior.member_ids = [...new Set([...prior.member_ids, ...claim.member_ids])]; else theme.claims.push(claim);
      }
    }
    hierarchy.excluded_members.push(...supplement.excluded_members);
    }
  }
  validateHierarchy(hierarchy, members, true);
  const assignments = hierarchy.themes.flatMap(theme => theme.claims.map(claim => ({ theme, claim })));
  const audits = [];
  const reviewed = await mapGroups(assignments, async ({ theme, claim }, i) => {
    await onProgress('Verifying claim frequency and supporting cases · ' + (i + 1) + '/' + assignments.length);
    const proposedMembers = claim.member_ids.map(id => byMember.get(id));
    const proposedCases = [...new Set(proposedMembers.flatMap(m => m.evidence_ids))].map(id => byCase.get(id));
    const data = { analysis_plan: plan, analytic_questions: analyticQuestions[theme.polarity], polarity: theme.polarity, claim: { text: claim.text, conditions: claim.conditions },
      members: proposedMembers, evidence: proposedCases };
    const result = await request('claim_support_review', supportSchema, prompt('claim_support_review'), data, result => {
      if (!result.claim_text?.trim()) throw new Error('Reviewed claim text is required');
      reviewDecisions(result.member_decisions, proposedMembers, 'member_id'); reviewDecisions(result.evidence_decisions, proposedCases, 'evidence_id');
      const keptGroups = new Set(result.member_decisions.filter(d => d.decision === 'KEEP').map(d => byMember.get(d.member_id).group_id));
      for (const item of result.evidence_decisions.filter(d => d.decision === 'KEEP')) {
        const e = byCase.get(item.evidence_id);
        if (!keptGroups.has(e.group_id) || !['experienced', 'retold'].includes(e.account_kind)) throw new Error('Supporting evidence needs a matching retained group and an experienced/retold account');
      }
      if (hasInappropriate(JSON.stringify(result))) throw new Error('Inappropriate text must not be reproduced in review');
    }, 9000);
    audits.push({ claim_key: claim.claim_key, ...result });
    const retainedMembers = result.member_decisions.filter(d => d.decision === 'KEEP').map(d => byMember.get(d.member_id));
    if (!retainedMembers.length) return null;
    const groupIds = [...new Set(retainedMembers.map(m => m.group_id))];
    const evidence = result.evidence_decisions.filter(d => d.decision === 'KEEP').map(d => {
      const source = byCase.get(d.evidence_id);
      return { case_id: source.evidence_id, description: source.description, group_id: source.group_id, account_kind: source.account_kind,
        support_reason: d.reason, original_sources: source.original_sources };
    });
    // Preserve source order and avoid counting a copied typed/spoken case twice.
    const uniqueEvidence = [...new Map(evidence.map(e => [JSON.stringify([e.group_id, e.original_sources.map(s => s.original_quote.replace(/\s+/gu, ' ').trim()).sort()]), e])).values()];
    return { theme_id: theme.theme_id, polarity: theme.polarity, claim_key: claim.claim_key, text: result.claim_text, conditions: result.conditions,
      group_ids: groupIds, group_count: groupIds.length, member_ids: retainedMembers.map(m => m.member_id),
      original_sources: uniqueSources(retainedMembers.flatMap(m => m.original_sources)), evidence: uniqueEvidence };
  });
  const themes = hierarchy.themes.map(theme => ({ theme_id: theme.theme_id, polarity: theme.polarity, title: theme.title, description: theme.description,
    claims: reviewed.filter(c => c && c.theme_id === theme.theme_id) }));
  const sections = numberAndRank(themes, plan.sections);
  if (!sections.length) throw new Error('No supported substantive claims remain after original-source review.');
  const analysis = { method_version: METHOD_VERSION, report_title: plan.report_title, research_focus: plan.research_focus, plan, questions: analyticQuestions, sections,
    frequency_unit: 'distinct group recordings with a verified semantic mention; not independent students, votes or independent experiences',
    audit: { coded_group_claims: members.length, excluded_members: hierarchy.excluded_members, group_exclusions: coded.flatMap(c => c.exclusions), claim_reviews: audits.sort((a, b) => a.claim_key.localeCompare(b.claim_key, undefined, { numeric: true })) } };
  await onProgress('Writing an approximately 500-word synthesis of the discussion');
  const summary = await request('claim_report_summary', object({ summary: text }), prompt('claim_report_summary'), {
    report_title: plan.report_title, research_focus: plan.research_focus, sections: sections.map(s => ({ title: s.title, themes: s.themes.map(t => ({ title: t.title, description: t.description, claims: t.claims.map(c => ({ text: c.text, conditions: c.conditions })) })) })),
  }, r => {
    const words = r.summary?.match(/\S+/gu)?.length || 0;
    if (words < 450 || words > 550 || /\bevidence\b|\b(?:claim|group)\s*\d+/iu.test(r.summary) || hasInappropriate(r.summary)) throw new Error('Summary must be approximately 500 English words (450–550), without evidence, citation IDs or inappropriate text. Received ' + words + ' words.');
  }, 2200);
  analysis.summary = summary.summary;
  const { analyzeOverallRelations } = require('./overallClaimRelations');
  analysis.overall_map = await analyzeOverallRelations(sections, { request, onProgress });
  const publicGroups = censored.map(r => r.publicGroup);
  const graph = supportGraph(analysis, censored.map(r => r.analysisGroup));
  const allThemes = sections.flatMap(s => s.themes);
  const thematic = { status: 'completed', method_version: METHOD_VERSION, review_status: 'AI_DRAFT', generated_at: new Date().toISOString(), codes: [], axes: [],
    unassigned_code_ids: [], alternative_interpretations: [], limitations: [], review_questions: [],
    themes: allThemes.map(t => ({ theme_id: t.theme_id, name: t.title, definition: t.description, central_concept: t.title, inclusion: '', exclusion: '', qualifications: '', topic_relevance: 'ON_TOPIC', development: 'CANDIDATE',
      code_ids: [], group_ids: t.group_ids, sources: uniqueSources(t.claims.flatMap(c => c.original_sources)) })) };
  const result = { ...graph, cleaned_groups: publicGroups, source_groups: prepared, groups: publicGroups.map(g => ({ id: g.id, name: g.name })),
    claim_analysis: analysis, thematic_analysis: thematic, generation: { mode: 'ai', method_version: METHOD_VERSION, model: TEXT_MODEL, warning: '' },
    input: { source: 'whole_group_cleaned_transcripts', generated_at: new Date().toISOString(), raw_input_hash: hash(groups.map(g => ({ id: g.id, transcript: g.transcript, manualPoints: g.manualPoints || [] }))) } };
  if (hasInappropriate(JSON.stringify(publicClaimGraph(result)))) throw new Error('Public claim report contains inappropriate text');
  return result;
}
function publicClaimGraph(graph) {
  if (!graph?.claim_analysis) return graph;
  return { nodes: graph.nodes, edges: graph.edges, groups: graph.groups, claim_analysis: graph.claim_analysis,
    thematic_analysis: graph.thematic_analysis, generation: graph.generation, input: graph.input };
}
module.exports = { analyzeClaimReport, publicClaimGraph, numberAndRank, supportGraph, METHOD_VERSION, analysisSchemas };
