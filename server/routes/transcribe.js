const express = require('express');
const router = express.Router();
const multer = require('multer');
const { default: OpenAI, toFile } = require('openai');
const redis = require('../services/redis');
const pool = require('../db/pool');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/transcribe — receive a webm audio chunk, transcribe via Whisper, append to Redis
router.post('/', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

  const { groupId, chunkId } = req.body;
  if (!/^[a-f0-9-]{36}$/i.test(groupId || '')) return res.status(400).json({ error: 'Valid groupId is required' });
  if (chunkId && !/^[a-f0-9-]{36}$/i.test(chunkId)) return res.status(400).json({ error: 'Invalid chunk ID' });

  try {
    const { rows } = await pool.query(
      'SELECT r.code FROM groups g JOIN rooms r ON r.id = g.room_id WHERE g.id = $1', [groupId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Group not found' });
    if (chunkId) {
      const client = await redis.getClient();
      const saved = await client.hGet('group:' + groupId + ':audioChunks', chunkId);
      if (saved !== null) return res.json({ transcript: saved });
    }
    const extension = req.file.mimetype.includes('mp4') ? 'mp4' : req.file.mimetype.includes('ogg') ? 'ogg' : 'webm';
    const audioFile = await toFile(req.file.buffer, 'chunk.' + extension, {
      type: req.file.mimetype || 'audio/webm',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
    });

    const text = transcription.text?.trim() || '';

    if (text.length > 0) {
      await redis.appendTranscript(groupId, text, chunkId);
      const transcript = await redis.getTranscript(groupId);
      req.app.get('io').to(rows[0].code).emit('group:transcript:update', { groupId, transcript });
    }

    res.json({ transcript: text });
  } catch (err) {
    console.error('POST /api/transcribe', err.message);
    res.status(500).json({ error: 'Transcription failed', details: err.message });
  }
});

module.exports = router;
