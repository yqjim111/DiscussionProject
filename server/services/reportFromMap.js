'use strict';
const crypto = require('crypto');
const { snapshotHash } = require('./reportAnalysis');

function reportFromMap(current, graph, sourceInput, saved) {
  const mapVersion = graph ? crypto.createHash('sha256').update(JSON.stringify({ nodes: graph.nodes, edges: graph.edges, input: graph.input })).digest('hex') : null;
  const same = saved?.schemaVersion === 2 && saved.mapVersion === mapVersion;
  const room = { ...current.room,
    teacher_topic: sourceInput?.topic ?? graph?.input?.topic ?? current.room.teacher_topic,
    discussion_instructions: sourceInput?.instructions ?? graph?.input?.instructions ?? current.room.discussion_instructions,
  };
  // Capture members and original transcripts from the graph's own input, so
  // speech recorded after generation never silently changes its appendix.
  const groups = sourceInput?.groups ? sourceInput.groups.map(group => ({ ...group,
    members: group.members || current.groups.find(g => g.id === group.id)?.members || [],
  })) : same ? saved.groups : current.groups;
  const inputHash = snapshotHash(room, groups);
  return {
    schemaVersion: 2, room, groups, argumentMap: graph, mapVersion, inputHash,
    thematicAnalysis: graph?.thematic_analysis || null,
    overallSummary: same ? saved.overallSummary : null,
    summaryWarning: same ? saved.summaryWarning || '' : '',
    contentAnalysis: graph ? { statements: graph.nodes.map(node => ({
      statement_id: node.node_id, statement: node.normalized_statement,
      position: node.topic_position || null, sources: node.sources,
    })) } : null,
    generatedAt: same ? saved.generatedAt : graph?.input?.generated_at || null,
    stale: inputHash !== snapshotHash(current.room, current.groups),
    sourceSnapshotAvailable: Boolean(sourceInput?.groups || (same && saved.sourceSnapshotAvailable)),
  };
}
module.exports = { reportFromMap };
