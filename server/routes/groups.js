const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const redis = require('../services/redis');

// POST /api/groups — create a group inside a room
router.post('/', async (req, res) => {
  const { roomCode, name, members } = req.body;
  if (!roomCode || !name || !members) {
    return res.status(400).json({ error: 'roomCode, name, and members are required' });
  }
  if (!/^\d{6}$/.test(roomCode)) return res.status(400).json({ error: 'Invalid room code' });

  try {
    const roomResult = await pool.query('SELECT id FROM rooms WHERE code = $1', [roomCode]);
    if (roomResult.rows.length === 0) return res.status(404).json({ error: 'Room not found' });

    const roomId = roomResult.rows[0].id;
    const memberArray = Array.isArray(members)
      ? members.map((m) => m.trim()).filter(Boolean)
      : String(members)
          .split(/[\n,]/)
          .map((m) => m.trim())
          .filter(Boolean);

    const { rows } = await pool.query(
      'INSERT INTO groups (room_id, name, members) VALUES ($1, $2, $3) RETURNING id, name, members, created_at',
      [roomId, name.trim(), memberArray]
    );
    const group = rows[0];

    // Prime Redis key so lastUpdated = 0 (no transcript yet)
    const redisClient = await redis.getClient();
    await redisClient.set(`group:${group.id}:lastUpdated`, '0');

    // Notify everyone in the room a new group was created
    const io = req.app.get('io');
    if (io) {
      io.to(roomCode).emit('group:created', { group: { ...group, summary: '' } });
    }

    res.status(201).json({ group });
  } catch (err) {
    console.error('POST /api/groups', err.message);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// GET /api/groups/:roomCode — list all groups with their latest summaries
router.get('/:roomCode', async (req, res) => {
  const { roomCode } = req.params;
  if (!/^\d{6}$/.test(roomCode)) return res.status(400).json({ error: 'Invalid room code' });

  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.members, g.created_at
       FROM groups g
       JOIN rooms r ON g.room_id = r.id
       WHERE r.code = $1
       ORDER BY g.created_at ASC`,
      [roomCode]
    );

    const groups = await Promise.all(
      rows.map(async (g) => ({ ...g, summary: await redis.getSummary(g.id) }))
    );

    res.json({ groups });
  } catch (err) {
    console.error('GET /api/groups/:roomCode', err.message);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

module.exports = router;
