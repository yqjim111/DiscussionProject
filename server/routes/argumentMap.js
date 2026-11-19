'use strict';

const express = require('express');
const pool = require('../db/pool');
const redis = require('../services/redis');
const jobs = require('../services/argumentMapJobs');
const { requireInstructor } = require('../services/instructorAuth');
const { getManualPoints } = require('../services/manualPoints');
const { readSession } = require('../services/reportStore');
const { publicClaimGraph } = require('../services/claimReportAnalysis');

const router = express.Router();

// Reuse the map's original input and durable worker; never re-extract its nodes
// just to add thematic analysis. Concurrent map/report requests share the job.
router.post('/:code/thematic-analysis', requireInstructor, async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid room code' });
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const previous = await jobs.getJob(code);
      const cached = previous?.result ? null : await (await redis.getClient()).get('room:' + code + ':argumentMap');
      const graph = previous?.result || (cached ? JSON.parse(cached) : null);
      let job;
      if (['queued', 'running'].includes(previous?.status)) {
        job = await jobs.requestThematic(code);
      } else {
        const current = await readSession(code);
        if (!current) return res.status(404).json({ error: 'Room not found' });
        const source = graph?.source_snapshot || (previous?.status === 'succeeded' ? previous.input : null) || {
          topic: current.room.teacher_topic, instructions: current.room.discussion_instructions, groups: current.groups,
        };
        if (graph && !graph.source_snapshot && previous?.status !== 'succeeded') return res.status(409).json({ error: 'Regenerate this older map first to capture a matching original input snapshot.' });
        await jobs.enqueue(code, { ...source, reuseSavedMap: Boolean(graph), reuseGraph: graph, reportRequested: false, refreshSummary: false, thematicRequested: true });
        job = await jobs.requestThematic(code);
      }
      if (!job) continue;
      res.status(202).json({ job: jobs.publicJob(job), graph: publicClaimGraph(job.result || graph || null) });
      setImmediate(() => { void jobs.wakeWorker(); }); return;
    }
    res.status(409).json({ error: 'Generation state changed. Please retry.' });
  } catch (error) { console.error('Thematic queue:', error.message); res.status(500).json({ error: 'Unable to queue thematic analysis.' }); }
});

// POST /api/rooms/:code/argument-map â€” instructor-triggered analysis of raw group transcripts
router.post('/:code/argument-map', requireInstructor, async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid room code' });

  try {
    const roomResult = await pool.query(
      'SELECT teacher_topic, discussion_instructions FROM rooms WHERE code = $1',
      [code]
    );
    if (!roomResult.rows.length) return res.status(404).json({ error: 'Room not found' });
    const teacherTopic = roomResult.rows[0].teacher_topic;
    const instructions = roomResult.rows[0].discussion_instructions || '';
    const result = await pool.query(
      'SELECT g.id, g.name, g.members FROM groups g JOIN rooms r ON g.room_id = r.id WHERE r.code = $1 ORDER BY g.created_at ASC',
      [code]
    );
    const groups = await Promise.all(result.rows.map(async g => ({
      id: String(g.id),
      name: g.name,
      members: g.members || [],
      manualPoints: await getManualPoints(g.id),
      transcript: await redis.getTranscript(g.id)
    })));
    const previous = await jobs.getJob(code);
    const job = await jobs.enqueue(code, { topic: teacherTopic || '', instructions, groups, pipelineCheckpoints: previous?.input?.pipelineCheckpoints || {} });
    res.status(202).json({ job: jobs.publicJob(job), graph: job.result?.generation?.mode === 'extractive_fallback' ? null : publicClaimGraph(job.result || null) });
    // Detached from the HTTP request: navigation does not cancel the worker.
    setImmediate(() => { void jobs.wakeWorker(); });
  } catch (error) {
    console.error('POST argument-map:', error.message);
    res.status(500).json({ error: 'Unable to queue Argument Map generation. Check backend database connectivity.' });
  }
});

router.get('/:code/argument-map', requireInstructor, async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid room code' });
  try {
    const job = await jobs.getJob(code);
    const cached = job?.result ? null : await (await redis.getClient()).get('room:' + code + ':argumentMap');
    res.set('Cache-Control', 'no-store');
    const graph = job?.result || (cached ? JSON.parse(cached) : null);
    res.json({ job: jobs.publicJob(job), graph: graph?.generation?.mode === 'extractive_fallback' ? null : publicClaimGraph(graph) });
  } catch (error) {
    console.error('GET argument-map job:', error.message);
    res.status(500).json({ error: 'Unable to load Argument Map status. Please retry.' });
  }
});

module.exports = router;
