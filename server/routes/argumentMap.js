'use strict';

const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const redis = require('../services/redis');
const { analyzeArgumentMap } = require('../services/argumentMap');

const router = express.Router();
const MAX_TRANSCRIPT_CHARS = 30000;

function tokenIsValid(input, expected) {
  if (typeof input !== 'string' || !expected || !input) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// POST /api/rooms/:code/argument-map — instructor-triggered analysis of raw group transcripts
router.post('/:code/argument-map', async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid room code' });

  // Demonstration-level protection for a paid AI endpoint. Production requires real auth.
  if (!process.env.ARGUMENT_MAP_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'ARGUMENT_MAP_ACCESS_TOKEN is not configured on the server' });
  }
  const supplied = req.get('x-argument-map-token');
  if (!tokenIsValid(supplied, process.env.ARGUMENT_MAP_ACCESS_TOKEN)) {
    return res.status(401).json({ error: 'Invalid Argument Map access token' });
  }
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY is not configured' });
  }

  const topic = typeof req.body?.teacher_topic === 'string' ? req.body.teacher_topic.trim() : '';
  const instructions = typeof req.body?.discussion_instructions === 'string'
    ? req.body.discussion_instructions.trim() : '';
  if (!topic || topic.length > 1500 || instructions.length > 5000) {
    return res.status(400).json({ error: 'Provide a topic (max 1500 characters) and optional instructions (max 5000)' });
  }

  try {
    const result = await pool.query(
      'SELECT g.id, g.name FROM groups g JOIN rooms r ON g.room_id = r.id WHERE r.code = $1 ORDER BY g.created_at ASC',
      [code]
    );
    const groups = await Promise.all(result.rows.map(async g => ({
      id: String(g.id),
      name: g.name,
      transcript: await redis.getTranscript(g.id)
    })));
    const usable = groups.filter(g => g.transcript.trim().length > 0);
    if (!usable.length) {
      return res.status(422).json({ error: 'No recorded transcripts in this room yet' });
    }
    if (usable.map(g => g.transcript.length).reduce((sum, n) => sum + n, 0) > MAX_TRANSCRIPT_CHARS) {
      return res.status(413).json({ error: 'Transcript too long for this demo. Use global chunking; do not truncate.' });
    }
    const graph = await analyzeArgumentMap({ topic, instructions, groups: usable });
    res.json({ ...graph, groups: usable.map(g => ({ id: g.id, name: g.name })) });
  } catch (error) {
    console.error('POST argument-map:', error.message);
    res.status(500).json({ error: 'Unable to generate a validated Argument Map. Check server logs.' });
  }
});

module.exports = router;
