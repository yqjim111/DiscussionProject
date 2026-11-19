'use strict';
const fs = require('fs');
const path = require('path');
const { object, text } = require('./analysisRequest');
const { hasInappropriate } = require('./transcriptCensor');
const TYPES = ['SUPPORT', 'AGAINST', 'TENSION'];
const strings = { type: 'array', items: text };
const edge = object({ id: text, source: text, target: text, relation: { type: 'string', enum: TYPES }, rationale: text });
const schema = object({ edges: { type: 'array', items: edge } });
const reviewSchema = object({ decisions: { type: 'array', items: object({ candidate_id: text, decision: { type: 'string', enum: ['KEEP', 'REMOVE'] }, relation: { type: 'string', enum: TYPES }, direction: { type: 'string', enum: ['UNCHANGED', 'REVERSED'] }, rationale: text }) } });
const refs = { type: 'array', items: object({ claim_id: text, source_index: { type: 'integer', minimum: 0 } }) };
const axisSchema = object({ axes: { type: 'array', items: object({ id: text, title: text, dimension: text,
  pole_a: object({ label: text, claim_ids: strings, conditions: text, source_refs: refs }),
  pole_b: object({ label: text, claim_ids: strings, conditions: text, source_refs: refs }),
  analysis: text, relation_ids: strings }) }, excluded_relation_ids: strings });
function validateRelations(result, claims, candidates, allowAlternativePairs = false) {
  const byId = new Map(claims.map(c => [c.id, c])), seen = new Set(), edgeIds = new Set();
  for (const e of result.edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target || !TYPES.includes(e.relation) || !e.rationale.trim()) throw Error('Invalid claim relationship');
    const pair = [e.source, e.target].sort().join('|');
    if ((!allowAlternativePairs && seen.has(pair)) || edgeIds.has(e.id)) throw Error('Duplicate claim pair or relationship ID');
    seen.add(pair); edgeIds.add(e.id);
    if (hasInappropriate(e.rationale)) throw Error('Inappropriate relationship rationale');
    if (candidates) {
      const prior = candidates.find(p => p.id === e.id);
      if (!prior || [prior.source, prior.target].sort().join('|') !== pair) throw Error('Review introduced an unproposed pair');
    }
  }
  if (candidates) {
    const decisions = [...result.edges.map(e => e.id), ...(result.rejected_ids || [])];
    if (new Set(decisions).size !== decisions.length || decisions.length !== candidates.length || candidates.some(e => !decisions.includes(e.id))) throw Error('Every candidate relationship requires exactly one review decision');
  }
}
function validateAxes(result, claims, edges, draft = false, allowUnassigned = false) {
  const byId = new Map(claims.map(c => [c.id, c])), byEdge = new Map(edges.map(e => [e.id, e])), decisions = [...result.excluded_relation_ids], axisIds = new Set();
  for (const axis of result.axes) {
    if (axisIds.has(axis.id) || !axis.title.trim() || !axis.dimension.trim() || !axis.analysis.trim() || !axis.relation_ids.length) throw Error('Invalid tension axis');
    axisIds.add(axis.id);
    const poleA = axis.pole_a || axis.helpful_pole, poleB = axis.pole_b || axis.risk_pole;
    if (!poleA || !poleB || poleA.claim_ids.some(id => poleB.claim_ids.includes(id))) throw Error('A tension needs two distinct non-overlapping poles');
    for (const pole of [poleA, poleB]) {
      if (!pole.label.trim() || !pole.claim_ids.length || !pole.source_refs.length || new Set(pole.claim_ids).size !== pole.claim_ids.length) throw Error('Each tension pole requires claims and original quotations');
      for (const id of pole.claim_ids) if (!byId.has(id)) throw Error('Unknown tension pole claim');
      for (const ref of pole.source_refs) if (!pole.claim_ids.includes(ref.claim_id) || !Number.isInteger(ref.source_index) || !byId.get(ref.claim_id)?.original_quotes[ref.source_index]) throw Error('Tension citation must reference an actual original quote on its pole');
    }
    const endpoints = new Set();
    for (const id of axis.relation_ids) {
      const e = byEdge.get(id); if (!e) throw Error('Unknown tension relation');
      endpoints.add(e.source); endpoints.add(e.target); decisions.push(id);
      if (!draft && (poleA.claim_ids.includes(e.source) === poleA.claim_ids.includes(e.target))) throw Error('Axis ' + axis.id + ' must place relation ' + id + ' on opposite poles');
      if (!draft && (![...poleA.claim_ids, ...poleB.claim_ids].includes(e.source) || ![...poleA.claim_ids, ...poleB.claim_ids].includes(e.target))) throw Error('Axis ' + axis.id + ' must include endpoints ' + e.source + ', ' + e.target + ' for relation ' + id);
    }
    if (!draft && [...poleA.claim_ids, ...poleB.claim_ids].some(id => !endpoints.has(id))) throw Error('Axis ' + axis.id + ' added an unlinked claim');
    if (hasInappropriate(JSON.stringify(axis))) throw Error('Inappropriate axis text');
  }
  if (!draft && (new Set(decisions).size !== decisions.length || decisions.some(id => !byEdge.has(id)) || (!allowUnassigned && (decisions.length !== edges.length || edges.some(e => !decisions.includes(e.id)))))) throw Error('Assign each tension relationship to one axis or explicitly exclude it. Missing: ' + edges.filter(e => !decisions.includes(e.id)).map(e => e.id).join(', ') + '; duplicated: ' + [...new Set(decisions.filter((id, i) => decisions.indexOf(id) !== i))].join(', '));
}
function completePoleEndpoints(result, claims, edges) {
  // Restore omitted inventory IDs only when the other endpoint's pole is known.
  const byEdge = new Map(edges.map(e => [e.id, e]));
  for (const axis of result.axes) for (let pass = 0; pass < axis.relation_ids.length; pass++) {
    let changed = false;
    for (const id of axis.relation_ids) {
      const edge = byEdge.get(id); if (!edge) continue;
      const a = axis.pole_a.claim_ids, b = axis.pole_b.claim_ids;
      for (const [known, other] of [[edge.source, edge.target], [edge.target, edge.source]]) {
        if (a.includes(other) || b.includes(other)) continue;
        if (a.includes(known)) { b.push(other); changed = true; }
        else if (b.includes(known)) { a.push(other); changed = true; }
      }
    }
    if (!changed) break;
  }
}

async function analyzeOverallRelations(sections, { request, onProgress = async () => {} }) {
  const claims = sections.flatMap(s => s.themes.flatMap(t => t.claims.map(c => ({ id: c.id, number: c.number, section_id: s.polarity, section_title: s.title, section_focus: s.focus || '', theme: t.title, text: c.text, conditions: c.conditions,
    original_quotes: c.original_sources.map((q, source_index) => ({ source_index, group_id: q.group_id, quote: q.original_quote })) }))));
  const prompt = fs.readFileSync(path.join(__dirname, '../prompts/overall_claim_relations_prompt.txt'), 'utf8');
  await onProgress('Analyzing support, against and substantive tensions across all claims');
  const proposed = await request('overall_claim_relations_v3', schema, prompt, { claims }, r => validateRelations(r, claims, undefined, true), 18000);
  await onProgress('Reviewing all proposed support, against and tension links');
  const reviewPrompt = prompt + '\nReview every candidate edge exactly once in decisions. Copy candidate id verbatim into candidate_id. Do not renumber or introduce pairs. KEEP or REMOVE; correct relationship type or direction if needed. If alternative candidate relations share the same unordered pair, retain AT MOST ONE and explicitly remove every alternative for that pair. In particular, do not erase a meaningful conditional tradeoff or competing-priority TENSION simply because both accounts can be true: coexistence is what makes it a tension, while AGAINST requires incompatible scope. A conditional or possible outcome is not a universal assertion; a different outcome in another context does not automatically contradict it. Reject speculative tradeoffs lacking a shared activity/capability in the original accounts.';
  function retained(decisions) { return decisions.filter(d => d.decision === 'KEEP').map(d => { const e = proposed.edges.find(e => e.id === d.candidate_id); return { ...e, source: d.direction === 'REVERSED' ? e.target : e.source, target: d.direction === 'REVERSED' ? e.source : e.target, relation: d.relation, rationale: d.rationale }; }); }
  const reviewed = await request('overall_claim_relations_decisions_v3', reviewSchema, reviewPrompt, { claims, candidate_edges: proposed.edges }, r => {
    const ids = r.decisions.map(d => d.candidate_id);
    if (new Set(ids).size !== ids.length || ids.length !== proposed.edges.length || proposed.edges.some(e => !ids.includes(e.id))) throw Error('Review every candidate exactly once, preserving candidate IDs');
    validateRelations({ edges: retained(r.decisions), rejected_ids: r.decisions.filter(d => d.decision === 'REMOVE').map(d => d.candidate_id) }, claims, proposed.edges);
  }, 18000);
  let edges = retained(reviewed.decisions);
  const tensionEdges = edges.filter(e => e.relation !== 'SUPPORT');
  const tensionPrompt = fs.readFileSync(path.join(__dirname, '../prompts/tension_analysis_prompt.txt'), 'utf8');
  await onProgress('Developing grounded bipolar tension axes');
  const candidateAxes = tensionEdges.length ? await request('tension_axes', axisSchema, tensionPrompt, { claims, reviewed_relationships: tensionEdges }, r => validateAxes(r, claims, tensionEdges, true), 14000) : { axes: [], excluded_relation_ids: [] };
  await onProgress('Reviewing tension poles, conditions and original citations');
  const axisReviewPrompt = tensionPrompt + '\nREVIEW: The supplied axes are a draft. Resolve missing endpoints and duplicate/missing relation assignments. Group overlapping axes around a coherent shared mechanism; do not keep a separate near-duplicate axis for every claim pair. An axis may cover several closely connected claims representing competing positions or priorities. Each retained relation belongs to EXACTLY ONE final axis, and all of its endpoints must be listed on that axis. Candidate relation_ids may be reassigned between axes. Explicitly exclude any remaining unsupported links. Preserve source-index accuracy and distinguish reported conditions from interpretation.';
  const axes = tensionEdges.length ? await request('tension_axes_review', axisSchema, axisReviewPrompt, { claims, reviewed_relationships: tensionEdges, candidate: candidateAxes }, r => { completePoleEndpoints(r, claims, tensionEdges); validateAxes(r, claims, tensionEdges, false, true); }, 14000) : candidateAxes;
  const assigned = new Set([...axes.axes.flatMap(a => a.relation_ids), ...axes.excluded_relation_ids]);
  const missing = tensionEdges.filter(e => !assigned.has(e.id));
  if (missing.length) {
    await onProgress('Checking omitted tension links against the reviewed axes');
    const coverageSchema = object({ decisions: { type: 'array', items: object({ relation_id: text, decision: { type: 'string', enum: ['ASSIGN', 'EXCLUDE'] }, axis_id: text, rationale: text }) }, new_axes: axisSchema.properties.axes });
    const coverage = await request('tension_axis_coverage', coverageSchema,
      tensionPrompt + '\nCOVERAGE REVIEW: Return one ASSIGN or EXCLUDE decision for EACH supplied unassigned_relationship, preserving relation_id. ASSIGN to an existing axis only if it genuinely fits the shared process; use its exact axis_id. If a distinct valid tension is not captured by any existing axis, add a fully grounded new axis in new_axes and assign to it. If the link is merely successful versus unsuccessful output without a shared tradeoff or competing-priority mechanism, EXCLUDE it with a reason. Do not force weak links. new_axes contain only new axes, never rewrites of existing ones. Existing axis inventories are filled from edge endpoints by the program.',
      { claims, existing_axes: axes.axes, unassigned_relationships: missing }, r => {
        const ids = r.decisions.map(d => d.relation_id), axisIds = new Set([...axes.axes, ...r.new_axes].map(a => a.id));
        if (new Set(ids).size !== ids.length || ids.length !== missing.length || missing.some(e => !ids.includes(e.id))) throw Error('Decide every missing tension link exactly once');
        if (axisIds.size !== axes.axes.length + r.new_axes.length) throw Error('New axis IDs must be unique');
        for (const d of r.decisions) if (!d.rationale.trim() || (d.decision === 'ASSIGN' && !axisIds.has(d.axis_id))) throw Error('Coverage assignment requires a valid axis and rationale');
        const merged = structuredClone(axes); merged.axes.push(...structuredClone(r.new_axes));
        for (const d of r.decisions) if (d.decision === 'EXCLUDE') merged.excluded_relation_ids.push(d.relation_id); else {
          const a = merged.axes.find(a => a.id === d.axis_id); if (!a.relation_ids.includes(d.relation_id)) a.relation_ids.push(d.relation_id);
        }
        completePoleEndpoints(merged, claims, tensionEdges); validateAxes(merged, claims, tensionEdges);
      }, 7000);
    axes.axes.push(...coverage.new_axes);
    for (const d of coverage.decisions) if (d.decision === 'EXCLUDE') axes.excluded_relation_ids.push(d.relation_id); else {
      const a = axes.axes.find(a => a.id === d.axis_id); if (!a.relation_ids.includes(d.relation_id)) a.relation_ids.push(d.relation_id);

    }
    completePoleEndpoints(axes, claims, tensionEdges);
  }
  validateAxes(axes, claims, tensionEdges);
  if (axes.axes.length) {
    await onProgress('Preparing concise labels for both tension poles');
    const labelsSchema = object({ labels: { type: 'array', items: object({ axis_id: text, pole_a_label: text, pole_b_label: text }) } });
    const labelPrompt = fs.readFileSync(path.join(__dirname, '../prompts/tension_axis_labels_prompt.txt'), 'utf8');
    const labels = await request('tension_axis_labels', labelsSchema, labelPrompt, { axes: axes.axes.map(a => ({ axis_id: a.id, title: a.title, pole_a: a.pole_a.label, pole_b: a.pole_b.label, analysis: a.analysis })) }, r => {
      const ids = r.labels.map(l => l.axis_id);
      if (new Set(ids).size !== ids.length || ids.length !== axes.axes.length || axes.axes.some(a => !ids.includes(a.id))) throw Error('Label every accepted axis exactly once');
      for (const l of r.labels) for (const value of [l.pole_a_label, l.pole_b_label]) if (!value.trim() || value.trim().split(/\s+/).length > 12 || hasInappropriate(value)) throw Error('Pole labels must be concise and appropriate');
    }, 3500);
    for (const axis of axes.axes) {
      const pair = labels.labels.find(l => l.axis_id === axis.id);
      axis.pole_a.description = axis.pole_a.label; axis.pole_b.description = axis.pole_b.label;
      axis.pole_a.label = pair.pole_a_label; axis.pole_b.label = pair.pole_b_label;
    }
  }
  edges = edges.filter(e => !axes.excluded_relation_ids.includes(e.id));
  const original = new Map(sections.flatMap(s => s.themes.flatMap(t => t.claims)).map(c => [c.id, c]));
  const hydratePole = pole => ({ ...pole, original_sources: pole.source_refs.map(ref => ({ ...original.get(ref.claim_id).original_sources[ref.source_index], claim_id: ref.claim_id })) });
  return { method_version: 'overall-claims-v3', node_ids: claims.map(c => c.id), edges,
    tensions: axes.axes.map((axis, i) => ({ ...axis, label: 'Tension ' + (i + 1), pole_a: hydratePole(axis.pole_a), pole_b: hydratePole(axis.pole_b) })),
    review: { proposed_count: proposed.edges.length, rejected_ids: reviewed.decisions.filter(d => d.decision === 'REMOVE').map(d => d.candidate_id), excluded_tension_relation_ids: axes.excluded_relation_ids } };
}
module.exports = { analyzeOverallRelations, validateRelations, validateAxes };
