'use strict';

// Whisper's context window is small. Keep a whole-character suffix bounded by
// UTF-8 bytes so even multilingual input stays below its 224-token prompt limit.
function contextTail(transcript) {
  const characters = Array.from(String(transcript || '').replace(/\s+/g, ' ').trim());
  let tail = '';
  for (let index = characters.length - 1; index >= 0; index--) {
    const next = characters[index] + tail;
    if (Buffer.byteLength(next, 'utf8') > 224) break;
    tail = next;
  }
  // Avoid feeding a sliced English word as a misleading spelling hint.
  if (tail.length < characters.join('').length && /^[A-Za-z]/.test(tail)) tail = tail.replace(/^[A-Za-z]+\s*/, '');
  return tail;
}

function transcriptionOptions(file, previousTranscript) {
  const language = process.env.TRANSCRIPTION_LANGUAGE || 'en';
  const prompt = contextTail(previousTranscript);
  return {
    file, model: process.env.TRANSCRIPTION_MODEL || 'whisper-1',
    ...(language === 'auto' ? {} : { language }),
    ...(prompt ? { prompt } : {})
  };
}

module.exports = { contextTail, transcriptionOptions };
