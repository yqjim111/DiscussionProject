'use strict';

const router = require('express').Router();
const pool = require('../db/pool');
const redis = require('../services/redis');
const { requireInstructor } = require('../services/instructorAuth');
const { analyzeReport, snapshotHash } = require('../services/reportAnalysis');
const { analyzeArgumentMap } = require('../services/argumentMap');

async function readSession(code) {
  const { rows } = await pool.query(
    'SELECT code, teacher_topic, discussion_instructions, instructor_name, created_at FROM rooms WHERE code = $1', [code]
  );
  if (!rows.length) return null;
  const result = await pool.query(
    'SELECT g.id, g.name, g.members FROM groups g JOIN rooms r ON g.room_id = r.id WHERE r.code = $1 ORDER BY g.created_at ASC', [code]
  );
  const groups = await Promise.all(result.rows.map(async g => ({
    id: String(g.id), name: g.name, members: g.members || [], transcript: await redis.getTranscript(g.id)
  })));
  return { room: rows[0], groups };
}

router.use('/:code/report', requireInstructor, (req, res, next) => {
  if (!/^\d{6}$/.test(req.params.code)) return res.status(400).json({ error: 'Invalid room code' });
  next();
});

router.get('/:code/report', async (req, res) => {
  try {
    const current = await readSession(req.params.code);
    if (!current) return res.status(404).json({ error: 'Room not found' });
    const client = await redis.getClient();
    const saved = await client.get('room:' + req.params.code + ':reportSnapshot');
    res.set('Cache-Control', 'no-store');
    if (saved) {
      const snapshot = JSON.parse(saved);
      return res.json({ ...snapshot, stale: snapshot.inputHash !== snapshotHash(current.room, current.groups) });
    }
    const [graph, summary] = await Promise.all([
      client.get('room:' + req.params.code + ':argumentMap'), client.get('room:' + req.params.code + ':overallSummary')
    ]);
    res.json({ ...current, overallSummary: summary || null, contentAnalysis: null, argumentMap: graph ? JSON.parse(graph) : null, generatedAt: null, stale: false });
  } catch (error) {
    console.error('GET report:', error.message);
    res.status(500).json({ error: 'Unable to load report data.' });
  }
});

router.post('/:code/report/generate', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY is not configured on the backend.' });
    const session = await readSession(req.params.code);
    if (!session) return res.status(404).json({ error: 'Room not found' });
    const groups = session.groups.filter(g => g.transcript.trim());
    if (!groups.length) return res.status(422).json({ error: 'No original transcripts yet. Record a discussion first.' });
    if (!session.room.teacher_topic?.trim()) return res.status(422).json({ error: 'Set a discussion topic before generating the report.' });
    if (groups.reduce((sum, g) => sum + g.transcript.length, 0) > 180000) {
      return res.status(413).json({ error: 'Combined transcripts exceed 180,000 characters. No groups were omitted or text truncated.' });
    }
    // Both analyses use the same captured original texts, including offline groups.
    const analysis = await analyzeReport({ room: session.room, groups });
    const argumentMap = await analyzeArgumentMap({ topic: session.room.teacher_topic, instructions: session.room.discussion_instructions, groups });
    const snapshot = {
      ...session, overallSummary: analysis.overall_summary,
      contentAnalysis: { referenceProposition: analysis.reference_proposition, statements: analysis.statements },
      argumentMap, generatedAt: new Date().toISOString(), inputHash: snapshotHash(session.room, session.groups)
    };
    const client = await redis.getClient();
    // A single write publishes a coherent report; failed generation leaves the previous one intact.
    await client.set('room:' + req.params.code + ':reportSnapshot', JSON.stringify(snapshot));
    res.set('Cache-Control', 'no-store');
    res.json({ ...snapshot, stale: false });
  } catch (error) {
    console.error('POST report generation:', error.message);
    res.status(502).json({ error: error.status === 429 ? 'OpenAI quota or rate limit reached. Check billing or try again later.' : 'Unable to generate the full report. The previous report and original transcripts are preserved. Check server logs and try again.' });
  }
});

module.exports = router;
