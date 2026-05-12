'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { transcribeAudio } from '@/lib/api';

interface Props {
  groupId: string;
  onTranscript?: (text: string) => void;
}

const CHUNK_DURATION_MS = 10_000;

export default function MicRecorder({ groupId, onTranscript }: Props) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState('');
  const [chunkCount, setChunkCount] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);
  const isRecordingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sendChunk = useCallback(
    async (blob: Blob) => {
      if (blob.size < 1000) return;
      try {
        const fd = new FormData();
        fd.append('audio', blob, 'chunk.webm');
        fd.append('groupId', groupId);
        const { transcript } = await transcribeAudio(fd);
        if (transcript && onTranscript) onTranscript(transcript);
        setChunkCount((c) => c + 1);
      } catch (err) {
        console.error('Chunk transcription error:', err);
      }
    },
    [groupId, onTranscript]
  );

  // Records one 10-second chunk, sends it, then restarts if still recording
  const recordChunk = useCallback(() => {
    if (!streamRef.current || !isRecordingRef.current) return;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      void sendChunk(blob);
      // Chain the next chunk
      if (isRecordingRef.current) {
        chunkTimerRef.current = setTimeout(recordChunk, 0);
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start();

    // Stop this recorder after CHUNK_DURATION_MS to trigger onstop
    chunkTimerRef.current = setTimeout(() => {
      if (recorder.state === 'recording') recorder.stop();
    }, CHUNK_DURATION_MS);
  }, [sendChunk]);

  async function startRecording() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      isRecordingRef.current = true;
      setRecording(true);
      setChunkCount(0);
      recordChunk();
    } catch (err: unknown) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setError('Microphone access is required to record your discussion');
      } else {
        setError('Could not start recording: ' + (err instanceof Error ? err.message : String(err)));
      }
    }
  }

  function stopRecording() {
    isRecordingRef.current = false;
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setRecording(false);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isRecordingRef.current = false;
      if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="mt-3 space-y-2">
      {error && (
        <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <button
        onClick={recording ? stopRecording : startRecording}
        className={`w-full py-2.5 rounded-lg text-sm font-semibold transition-colors flex items-center justify-center gap-2 ${
          recording
            ? 'bg-red-100 text-red-700 hover:bg-red-200'
            : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
        }`}
      >
        {recording ? (
          <>
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            Stop Recording
          </>
        ) : (
          <>
            <span>🎙</span>
            Start Recording
          </>
        )}
      </button>

      {recording && (
        <p className="text-xs text-gray-400 text-center">
          Sending 10-second chunks to Whisper
          {chunkCount > 0 && ` · ${chunkCount} transcribed`}
        </p>
      )}
    </div>
  );
}
