const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireInstructor } = require('../services/instructorAuth');

function generateRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/rooms — create a room and return its 6-digit code
router.post('/', requireInstructor, async (req, res) => {
  const teacherTopic = typeof req.body?.teacher_topic === 'string' ? req.body.teacher_topic.trim() : '';
  const instructions = typeof req.body?.discussion_instructions === 'string' ? req.body.discussion_instructions.trim() : '';
  const duration = req.body?.duration_minutes;
  if (!teacherTopic || teacherTopic.length > 1500 || instructions.length > 5000
    || !Number.isInteger(duration) || duration < 1 || duration > 180) {
    return res.status(400).json({ error: 'A topic, optional instructions and duration (1-180 min) are required' });
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
      'INSERT INTO rooms (code, teacher_topic, discussion_instructions, duration_minutes) VALUES ($1, $2, $3, $4) RETURNING id, code, teacher_topic, discussion_instructions, duration_minutes, created_at',
      [code, teacherTopic, instructions, duration]
    );
    res.status(201).json({ room: rows[0] });
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
      'SELECT id, code, teacher_topic, discussion_instructions, duration_minutes, created_at FROM rooms WHERE code = $1',
      [code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    res.json({ room: rows[0] });
  } catch (err) {
    console.error('GET /api/rooms/:code', err.message);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

// DELETE /api/rooms/:code — end a session (deletes room + groups, clears Redis)
router.delete('/:code', async (req, res) => {
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
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/rooms/:code', err.message);
    res.status(500).json({ error: 'Failed to delete room' });
  }
});

module.exports = router;
