'use strict';

// Deterministic provider fixture for pipeline orchestration/provenance tests.
// Semantic quality is assessed separately against the actual supplied transcripts.
function responseFor(input) {
  const name = input.response_format.json_schema.name, data = JSON.parse(input.messages[1].content);
  if (name === 'transcript_cleanup') return { cleaned_transcript: data.original_transcript, review_notes: [] };
  if (name === 'transcript_cleanup_review') return data.candidate;
  if (name === 'group_content_review') return data.candidate;
  if (name === 'group_content') return { episodes: [], exclusions: [], statements: data.original_sources.map(s => ({
    normalized_statement: s.original_quote, primary_type: 'CLAIM', topic_position: 'NEUTRAL', account_kind: 'experienced', episode_ids: [],
    quotes: [{ source_id: s.source_id, original_quote: s.original_quote }],
  })) };
  if (name === 'content_merge' || name === 'content_merge_review') return data.candidate || { clusters: data.statements.map(s => ({ member_ids: [s.statement_id],
    normalized_statement: s.normalized_statement, primary_type: s.primary_type, topic_position: s.topic_position, account_kind: s.account_kind })), retellings: [] };
  if (name === 'argument_relations' || name === 'argument_verification') return { edges: [] };
  if (name === 'argument_edge_review') return { decisions: data.candidates.map(c => ({ candidate_id: c.candidate_id, decision: 'REMOVE', reason: 'No reasoning connection in this fixture.', source_node_id: null, target_node_id: null, relationship_type: null, evidence_refs: [] })) };
  if (name === 'snowball_retellings' || name === 'snowball_review') return { retellings: [] };
  if (name === 'thematic_codes') return { codes: data.original_sources.flatMap(s => (s.original_quote.match(/[^.!?]+[.!?]?/g) || []).filter(q => q.trim()).map(q => ({
    label: 'Evidence-grounded meaning', meaning: q.trim(), quotes: [{ source_id: s.source_id, original_quote: q.trim() }],
  }))) };
  if (name === 'thematic_review') return data.candidate;
  if (name === 'thematic_synthesis') return { themes: [{ theme_id: 'T1', name: 'A context-grounded pattern', central_concept: 'Shared meaning', definition: 'Pattern in original discussion',
    inclusion: 'Relevant meanings', exclusion: 'Unrelated meanings', qualifications: 'Interpretive draft', topic_relevance: 'ON_TOPIC', code_ids: data.codes.map(c => c.code_id) }],
    axes: [], unassigned_code_ids: [], alternative_interpretations: [], limitations: ['No supported bipolar dimension in this fixture'], review_questions: ['Check original context.'] };
  if (name === 'report_overall_summary') return { overall_summary: 'High-level classroom synthesis.' };
  throw new Error('Unexpected analysis request ' + name);
}
module.exports = { responseFor };
