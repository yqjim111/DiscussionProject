const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireInstructor } = require('../services/instructorAuth');
const { readTimer, transitionTimer } = require('../../lib/discussionTimer');

function roomPayload(room, now = Date.now()) {
  return { ...room, discussion_timer: readTimer(room.discussion_timer, now), server_now: now };
}

function generateRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/rooms — create a room and return its 6-digit code
router.post('/', requireInstructor, async (req, res) => {
  const instructorName = typeof req.body?.instructor_name === 'string' ? req.body.instructor_name.trim() : '';
  const teacherTopic = typeof req.body?.teacher_topic === 'string' ? req.body.teacher_topic.trim() : '';
  const instructions = typeof req.body?.discussion_instructions === 'string' ? req.body.discussion_instructions.trim() : '';
  if (!teacherTopic || teacherTopic.length > 1500 || !instructorName || instructorName.length > 255 || instructions.length > 5000) {
    return res.status(400).json({ error: 'Instructor name and topic are required; instructions are optional' });
  }
  try {
    let code;
    for (let i = 0; i < 10; i++) {
      code = generateRoomCode();
      const { rows } = await pool.query('SELECT id FROM rooms WHERE code = $1', [code]);
      if (rows.length === 0) break;
      code = null;
    }
    if (!code) return res.status(500).json({ error: 'Could not generate unique room code' });

    const { rows } = await pool.query(
      'INSERT INTO rooms (code, teacher_topic, discussion_instructions, duration_minutes, instructor_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, code, teacher_topic, discussion_instructions, duration_minutes, instructor_name, created_at',
      [code, teacherTopic, instructions, null, instructorName]
    );
    res.status(201).json({ room: roomPayload(rows[0]) });
  } catch (err) {
    console.error('POST /api/rooms', err.message);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// GET /api/rooms/:code — validate room exists
router.get('/:code', async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid room code' });

  try {
    const { rows } = await pool.query(
      'SELECT id, code, teacher_topic, discussion_instructions, duration_minutes, instructor_name, created_at, discussion_timer FROM rooms WHERE code = $1',
      [code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    res.json({ room: roomPayload(rows[0]) });
  } catch (err) {
    console.error('GET /api/rooms/:code', err.message);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

router.patch('/:code', requireInstructor, async (req, res) => {
  const topic = typeof req.body?.teacher_topic === 'string' ? req.body.teacher_topic.trim() : '';
  const instructions = typeof req.body?.discussion_instructions === 'string' ? req.body.discussion_instructions.trim() : '';
  if (!/^\d{6}$/.test(req.params.code) || !topic || topic.length > 1500 || instructions.length > 5000) {
    return res.status(400).json({ error: 'A topic (up to 1500 characters) and optional instructions (up to 5000 characters) are required.' });
  }
  try {
    const { rows } = await pool.query(
      'UPDATE rooms SET teacher_topic = $1, discussion_instructions = $2 WHERE code = $3 RETURNING *',
      [topic, instructions, req.params.code]
    );
    if (!rows.length) return res.status(404).json({ error: 'Room not found' });
    const room = roomPayload(rows[0]);
    req.app.get('io').to(req.params.code).emit('room:updated', { room });
    res.json({ room });
  } catch (error) {
    console.error('PATCH room:', error.message);
    res.status(500).json({ error: 'Unable to update discussion instructions.' });
  }
});

router.patch('/:code/timer', requireInstructor, async (req, res) => {
  if (!/^\d{6}$/.test(req.params.code)) return res.status(400).json({ error: 'Invalid room code' });
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { rows } = await pool.query('SELECT discussion_timer FROM rooms WHERE code = $1', [req.params.code]);
      if (!rows.length) return res.status(404).json({ error: 'Room not found' });
      let next;
      try { next = transitionTimer(rows[0].discussion_timer, req.body?.action, req.body?.durationSeconds); }
      catch (error) { return res.status(400).json({ error: error.message }); }
      // Compare-and-swap serializes actions from multiple instructor tabs.
      const updated = await pool.query(`UPDATE rooms SET discussion_timer = $1::jsonb
        WHERE code = $2 AND discussion_timer IS NOT DISTINCT FROM $3::jsonb RETURNING *`,
        [JSON.stringify(next), req.params.code, JSON.stringify(rows[0].discussion_timer ?? null)]);
      if (!updated.rows.length) continue;
      const room = roomPayload(updated.rows[0]);
      req.app.get('io').to(req.params.code).emit('room:updated', { room });
      return res.json({ room });
    }
    res.status(409).json({ error: 'The timer changed in another tab. Please retry.' });
  } catch (error) { console.error('Room timer:', error.message); res.status(500).json({ error: 'Unable to update the countdown.' }); }
});

// Only an instructor can permanently end a session.
router.delete('/:code', requireInstructor, async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid room code' });

  try {
    // Fetch groups so we can clean Redis keys
    const { rows: groups } = await pool.query(
      `SELECT g.id FROM groups g JOIN rooms r ON g.room_id = r.id WHERE r.code = $1`,
      [code]
    );

    // Delete room (cascades to groups via FK)
    await pool.query('DELETE FROM rooms WHERE code = $1', [code]);

    // Clean up Redis keys for each group
    const { getClient } = require('../services/redis');
    const redis = await getClient();
    for (const g of groups) {
      await redis.del(`group:${g.id}:transcript`);
      await redis.del(`group:${g.id}:summary`);
      await redis.del(`group:${g.id}:lastUpdated`);
      await redis.del(`group:${g.id}:lastSummaryTime`);
      await redis.del(`group:${g.id}:audioChunks`);
    }

    await redis.del(`room:${code}:argumentMap`);
    await redis.del(`room:${code}:overallSummary`);
    await redis.del(`room:${code}:reportSnapshot`);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/rooms/:code', err.message);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
