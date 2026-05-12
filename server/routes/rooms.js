const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

function generateRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/rooms — create a room and return its 6-digit code
router.post('/', async (req, res) => {
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
      'INSERT INTO rooms (code) VALUES ($1) RETURNING id, code, created_at',
      [code]
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
      'SELECT id, code, created_at FROM rooms WHERE code = $1',
      [code]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Room not found' });
    res.json({ room: rows[0] });
  } catch (err) {
    console.error('GET /api/rooms/:code', err.message);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

module.exports = router;
