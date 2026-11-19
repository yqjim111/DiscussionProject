'use strict';
const pool = require('../db/pool');
const redis = require('./redis');
const { reportFromMap } = require('./reportFromMap');
const { summarizeMap } = require('./reportSummary');
const { getManualPoints } = require('./manualPoints');

async function readSession(code) {
  const { rows } = await pool.query('SELECT code, teacher_topic, discussion_instructions, instructor_name, created_at FROM rooms WHERE code = $1', [code]);
  if (!rows.length) return null;
  const result = await pool.query('SELECT g.id, g.name, g.members FROM groups g JOIN rooms r ON g.room_id = r.id WHERE r.code = $1 ORDER BY g.created_at ASC', [code]);
  const groups = await Promise.all(result.rows.map(async g => ({ id: String(g.id), name: g.name, members: g.members || [], transcript: await redis.getTranscript(g.id), manualPoints: await getManualPoints(g.id) })));
  return { room: rows[0], groups };
}

async function finishReport(code, graph, refreshSummary, sourceInput) {
  const session = await readSession(code);
  if (!session) throw new Error('Room not found');
  const client = await redis.getClient();
  const saved = await client.get('room:' + code + ':reportSnapshot');
  const report = reportFromMap(session, graph, graph.source_snapshot || sourceInput, saved ? JSON.parse(saved) : null);
  if (!report.claimAnalysis && (!report.overallSummary || refreshSummary)) {
    try {
      report.overallSummary = await summarizeMap(report.room, graph.nodes, { thematic: graph.thematic_analysis });
      report.summaryWarning = '';
    } catch (error) {
      console.warn('Report summary:', error.status || error.message);
      report.summaryWarning = 'Overall Summary could not be generated. The saved statements, map and transcripts are available for export.';
    }
  }
  report.generatedAt = new Date().toISOString();
  await client.set('room:' + code + ':reportSnapshot', JSON.stringify(report));
}
module.exports = { readSession, finishReport };
