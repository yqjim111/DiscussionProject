'use strict';
function createFixture() {
let scenario = 'project', dropSecondGroup = false;

function fixtureItems() {
  return scenario === 'community' ? [
    { id: 'ACCESS', title: 'Access and travel choices', quote: 'Walking to school reduced our traffic.', text: 'Walking reduced school-run traffic.', evidence: 'Participants walked to school and reported reduced traffic.' },
    { id: 'SAFETY', title: 'Crossing safety', quote: 'The crossing felt unsafe after dark.', text: 'The crossing felt unsafe after dark.', evidence: 'Participants reported feeling unsafe at the crossing after dark.' },
    { id: 'COORDINATION', title: 'Community coordination', quote: 'Parents organized a supervised walking group.', text: 'Parents coordinated a supervised walking group.', evidence: 'Parents organized supervision for a walking group.' },
  ] : [
    { id: 'IMPLEMENTATION', title: 'Implementation support', quote: 'AI helped build the prototype.', text: 'AI can help build prototypes.', evidence: 'A student used AI to build a prototype.' },
    { id: 'REWORK', title: 'Requirements and rework', quote: 'AI ignored my requirements and caused rework.', text: 'AI can cause rework when it ignores requirements.', evidence: 'A student had to rework output that ignored requirements.' },
  ];
}
function fixtureResponse(name, data) {
  const items = fixtureItems();
  if (name === 'transcript_cleanup') return { cleaned_transcript: data.original_transcript, review_notes: [] };
  if (name === 'transcript_cleanup_review') return data.candidate;
  if (name === 'transcript_censor') return { redactions: [] };
  if (name === 'discussion_report_plan') return { report_title: scenario === 'community' ? 'Walking to school: access, safety and coordination' : 'Developing project prototypes', research_focus: 'Participant experiences and conditions expressed in the discussion.', sections: items.map(i => ({ id: i.id, title: i.title, focus: i.title, questions: ['What experiences and views concern ' + i.title + '?'] })) };
  if (name === 'group_claim_coding') {
    const source = data.original_sources[0], q = original_quote => [{ source_id: source.source_id, original_quote }];
    return { claims: items.flatMap((item, i) => {
      const c = { local_id: 'C' + i, polarity: item.id, text: item.text, conditions: '', mentions: q(item.quote), evidence_ids: ['E' + i] };
      return i === 0 && data.group_key === 'G1' ? [c, { ...c, local_id: 'C_duplicate' }] : [c];
    }), evidence: items.map((item, i) => ({ local_id: 'E' + i, description: item.evidence, account_kind: 'experienced', quotes: q(item.quote) })), exclusions: [] };
  }
  if (name === 'claim_semantic_synthesis') return { themes: items.map((item, i) => ({ theme_id: 'T' + i, polarity: item.id, title: item.title, description: 'A shared meaning supported by participant accounts.', claims: [{ claim_key: 'K' + i, text: item.text, conditions: '', member_ids: data.group_claims.filter(c => c.polarity === item.id).map(c => c.member_id) }] })), excluded_members: [] };
  if (name === 'claim_semantic_review') return data.candidate;
  if (name === 'claim_support_review') return { claim_text: data.claim.text, conditions: data.claim.conditions,
    member_decisions: data.members.map(m => ({ member_id: m.member_id, decision: dropSecondGroup && m.group_id === 'g2' ? 'REMOVE' : 'KEEP', reason: 'The original account expresses this meaning.' })),
    evidence_decisions: data.evidence.map(e => ({ evidence_id: e.evidence_id, decision: dropSecondGroup && e.group_id === 'g2' ? 'REMOVE' : 'KEEP', reason: 'The reported case supports the claim.' })) };
  if (name === 'claim_report_summary') return { summary: Array(50).fill('Participants compare practical choices while preserving their goals and judgment.').join(' ') };
  if (name === 'overall_claim_relations_v3') return { edges: scenario === 'community' ? [{ id: 'R1', source: 'claim-1', target: 'claim-2', relation: 'TENSION', rationale: 'Walking reduced traffic, while the route involved a crossing experienced as unsafe after dark.' }] : [] };
  if (name === 'overall_claim_relations_decisions_v3') return { decisions: data.candidate_edges.map(e => ({ candidate_id: e.id, decision: 'KEEP', relation: e.relation, direction: 'UNCHANGED', rationale: e.rationale })) };
  if (name === 'tension_axes') return { axes: [{ id: 'A1', title: 'Less traffic and crossing safety', dimension: 'Choosing a school travel arrangement',
    pole_a: { label: 'Reduced traffic', claim_ids: ['claim-1'], conditions: 'Participants reported less traffic when walking.', source_refs: [{ claim_id: 'claim-1', source_index: 0 }] },
    pole_b: { label: 'Crossing safety', claim_ids: ['claim-2'], conditions: 'The crossing felt unsafe after dark.', source_refs: [{ claim_id: 'claim-2', source_index: 0 }] },
    analysis: 'The accounts suggest a tradeoff between reducing traffic and feeling safe along the route.', relation_ids: ['R1'] }], excluded_relation_ids: [] };
  if (name === 'tension_axes_review') return data.candidate;
  if (name === 'tension_axis_labels') return { labels: [{ axis_id: 'A1', pole_a_label: 'Reduced school-run traffic', pole_b_label: 'Unsafe crossings after dark' }] };
  throw new Error('Unexpected discussion-report request ' + name);
}

return { response: fixtureResponse, items: fixtureItems, setScenario: value => { scenario = value; }, setDropSecondGroup: value => { dropSecondGroup = value; } };
}
module.exports = { createFixture };
