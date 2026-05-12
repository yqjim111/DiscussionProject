const express = require('express');
const router = express.Router();
const multer = require('multer');
const { default: OpenAI, toFile } = require('openai');
const redis = require('../services/redis');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// POST /api/transcribe — receive a webm audio chunk, transcribe via Whisper, append to Redis
router.post('/', upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file provided' });

  const { groupId } = req.body;
  if (!groupId) return res.status(400).json({ error: 'groupId is required' });

  try {
    const audioFile = await toFile(req.file.buffer, 'chunk.webm', {
      type: req.file.mimetype || 'audio/webm',
    });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
    });

    const text = transcription.text?.trim() || '';

    if (text.length > 0) {
      await redis.appendTranscript(groupId, text);
    }

    res.json({ transcript: text });
  } catch (err) {
    console.error('POST /api/transcribe', err.message);
    res.status(500).json({ error: 'Transcription failed', details: err.message });
  }
});

module.exports = router;
