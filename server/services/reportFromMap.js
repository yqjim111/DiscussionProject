'use strict';
const crypto = require('crypto');
const { snapshotHash } = require('./reportAnalysis');

function reportFromMap(current, graph, sourceInput, saved) {
  if (graph?.claim_analysis) {
    const { publicClaimGraph } = require('./claimReportAnalysis');
    const rawGroups = graph.source_groups || graph.source_snapshot?.groups || sourceInput?.groups || current.groups;
    const room = { ...current.room };
    const inputHash = snapshotHash(room, rawGroups);
    const mapVersion = crypto.createHash('sha256').update(JSON.stringify({ analysis: graph.claim_analysis, inputHash })).digest('hex');
    return { schemaVersion: 3, room, groups: graph.cleaned_groups, claimAnalysis: graph.claim_analysis,
      argumentMap: publicClaimGraph(graph), overallSummary: graph.claim_analysis.summary,
      thematicAnalysis: graph.thematic_analysis || null, mapVersion, inputHash,
      generatedAt: saved?.mapVersion === mapVersion ? saved.generatedAt : graph.input?.generated_at || new Date().toISOString(),
      stale: inputHash !== snapshotHash(current.room, current.groups), sourceSnapshotAvailable: true, summaryWarning: '' };
  }
  // Legacy excerpt fallbacks are source browsers, never completed analysis.
  if (graph?.generation?.mode === 'extractive_fallback') graph = null;
  const mapVersion = graph ? crypto.createHash('sha256').update(JSON.stringify({ nodes: graph.nodes, edges: graph.edges, input: graph.input })).digest('hex') : null;
  const same = saved?.schemaVersion === 2 && saved.mapVersion === mapVersion;
  const room = { ...current.room,
    teacher_topic: sourceInput?.topic ?? graph?.input?.topic ?? current.room.teacher_topic,
    discussion_instructions: sourceInput?.instructions ?? graph?.input?.instructions ?? current.room.discussion_instructions,
  };
  // Capture members and original transcripts from the graph's own input, so
  // speech recorded after generation never silently changes its appendix.
  const inputGroups = graph?.cleaned_groups || sourceInput?.groups;
  const groups = inputGroups ? inputGroups.map(group => ({ ...group,
    members: group.members || current.groups.find(g => g.id === group.id)?.members || [],
  })) : same ? saved.groups : current.groups;
  const inputHash = snapshotHash(room, groups);
  return {
    schemaVersion: 2, room, groups, argumentMap: graph, mapVersion, inputHash,
    thematicAnalysis: graph?.thematic_analysis || null,
    overallSummary: same ? saved.overallSummary : null,
    summaryWarning: same ? saved.summaryWarning || '' : '',
    contentAnalysis: graph ? { ...graph.content_analysis, statements: graph.nodes.map(node => ({
      statement_id: node.node_id, statement: node.normalized_statement,
      position: node.topic_position || null, sources: node.sources,
    })) } : null,
    generatedAt: same ? saved.generatedAt : graph?.input?.generated_at || null,
    stale: inputHash !== snapshotHash(current.room, current.groups),
    sourceSnapshotAvailable: Boolean(sourceInput?.groups || (same && saved.sourceSnapshotAvailable)),
  };
}
module.exports = { reportFromMap };
