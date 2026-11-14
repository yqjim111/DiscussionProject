'use strict';

const express = require('express');
const pool = require('../db/pool');
const redis = require('../services/redis');
const { analyzeArgumentMap } = require('../services/argumentMap');
const { requireInstructor } = require('../services/instructorAuth');

const router = express.Router();
const MAX_TRANSCRIPT_CHARS = 180000;

// POST /api/rooms/:code/argument-map — instructor-triggered analysis of raw group transcripts
router.post('/:code/argument-map', requireInstructor, async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid room code' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: 'OPENAI_API_KEY is not configured' });
  }

  try {
    const roomResult = await pool.query(
      'SELECT teacher_topic, discussion_instructions FROM rooms WHERE code = $1',
      [code]
    );
    if (!roomResult.rows.length) return res.status(404).json({ error: 'Room not found' });
    const teacherTopic = roomResult.rows[0].teacher_topic;
    const instructions = roomResult.rows[0].discussion_instructions || '';
    if (!teacherTopic || !teacherTopic.trim()) {
      return res.status(422).json({ error: 'This room has no saved topic. Create a new session with a topic.' });
    }
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
      return res.status(413).json({ error: 'The combined original transcripts exceed the analysis capacity (180,000 characters). Nothing was truncated or analyzed partially.' });
    }
    const graph = await analyzeArgumentMap({ topic: teacherTopic, instructions, groups: usable });
    const payload = {
      ...graph, groups: groups.map(g => ({ id: g.id, name: g.name })),
      input: {
        source: 'original_transcripts', generated_at: new Date().toISOString(),
        topic: teacherTopic, instructions,
        groups: groups.map(g => ({ id: g.id, name: g.name, characters: g.transcript.length }))
      }
    };
    const client = await redis.getClient();
    await client.set(`room:${code}:argumentMap`, JSON.stringify(payload));
    res.json(payload);
  } catch (error) {
    console.error('POST argument-map:', error.message);
    if (error.code === 'GRAPH_VALIDATION') return res.status(422).json({ error: error.message });
    const status = error.status;
    const message = status === 401 ? 'The server OpenAI API key is invalid. Ask the instructor administrator to check Railway.'
      : status === 429 ? 'OpenAI quota or rate limit reached. Check API billing or try again later.'
      : status === 403 || status === 404 ? 'The configured AI model is unavailable to this API key. Check ARGUMENT_MAP_MODEL on Railway.'
      : 'Unable to generate the Argument Map. Your original transcripts are saved. Please try again or check server logs.';
    res.status(502).json({ error: message });
  }
});

module.exports = router;
