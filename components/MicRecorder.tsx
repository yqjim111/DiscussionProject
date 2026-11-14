'use client';

import { forwardRef, useState, useRef, useEffect, useImperativeHandle } from 'react';
import { transcribeAudio } from '@/lib/api';

export interface RecorderHandle { flush: (stop?: boolean) => Promise<void> }
const CHUNK_MS = 4000;

const MicRecorder = forwardRef<RecorderHandle, { groupId: string; disabled?: boolean }>(function MicRecorder({ groupId, disabled }, ref) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const active = useRef(false);
  const mounted = useRef(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const failed = useRef<{ blob: Blob; id: string }[]>([]);
  const stopped = useRef<Promise<void>>(Promise.resolve());

  async function retryUploads() {
    while (failed.current.length) {
      const item = failed.current[0];
      const form = new FormData();
      form.append('audio', item.blob, item.blob.type.includes('mp4') ? 'chunk.mp4' : 'chunk.webm');
      form.append('groupId', groupId);
      form.append('chunkId', item.id);
      await transcribeAudio(form);
      failed.current.shift();
    }
  }

  function upload(blob: Blob) {
    if (!blob.size) return;
    if (mounted.current) setPending(n => n + 1);
    queue.current = queue.current.then(async () => {
      failed.current.push({ blob, id: crypto.randomUUID() });
      await retryUploads();
      if (mounted.current) setError('');
    }).catch(() => {
      if (mounted.current) setError('Some audio has not been saved. Keep this page open; Stop Recording or Leave Group will retry.');
    }).finally(() => { if (mounted.current) setPending(n => n - 1); });
  }

  // A fresh recorder creates a complete decodable file for every segment.
  function recordChunk() {
    if (!active.current || !stream.current) return;
    const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    const current = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
    const pieces: Blob[] = [];
    let resolveStop!: () => void;
    stopped.current = new Promise<void>(resolve => { resolveStop = resolve; });
    current.ondataavailable = event => { if (event.data.size) pieces.push(event.data); };
    current.onstop = () => {
      upload(new Blob(pieces, { type: current.mimeType }));
      resolveStop();
      if (active.current) recordChunk();
    };
    current.onerror = () => {
      active.current = false;
      stream.current?.getTracks().forEach(track => track.stop());
      if (mounted.current) { setRecording(false); setError('Recording stopped unexpectedly. Please start recording again.'); }
      resolveStop();
    };
    recorder.current = current;
    current.start();
    timer.current = setTimeout(() => { if (current.state === 'recording') current.stop(); }, CHUNK_MS);
  }

  async function flush(stop = false) {
    if (stop) { active.current = false; setRecording(false); }
    if (timer.current) clearTimeout(timer.current);
    const finalChunk = stopped.current;
    if (recorder.current?.state === 'recording') recorder.current.stop();
    await finalChunk;
    if (stop) { stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; }
    await queue.current;
    // Retry in the same ordered queue to avoid concurrent duplicate uploads.
    queue.current = queue.current.then(retryUploads);
    const result = queue.current;
    queue.current = result.catch(() => {});
    await result;
    if (mounted.current) setError('');
  }

  useImperativeHandle(ref, () => ({ flush }));

  async function start() {
    setStarting(true); setError('');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }
      } });
      if (!mounted.current) { stream.current.getTracks().forEach(track => track.stop()); return; }
      active.current = true; setRecording(true); recordChunk();
    } catch (err) {
      active.current = false; setRecording(false);
      stream.current?.getTracks().forEach(track => track.stop());
      setError(err instanceof Error ? err.message : 'Unable to start the microphone.');
    } finally { if (mounted.current) setStarting(false); }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; active.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach(track => track.stop());
    };
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (active.current || pending > 0 || failed.current.length) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending, recording, error]);

  return <div className="mt-3 space-y-2">
    <button disabled={starting || disabled} onClick={() => recording ? void flush(true).catch(() => setError('Audio could not be saved. Keep this page open and try again.')) : void start()}
      className={`w-full py-2.5 rounded-lg text-sm font-semibold ${recording ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
      {starting ? 'Opening microphone…' : recording ? 'Stop Recording' : 'Start Recording'}
    </button>
    <p className="text-xs text-gray-500">{recording ? 'Recording · transcript updates about every 4 seconds plus processing time.' : 'Microphone stopped.'}{pending > 0 && ` Saving ${pending} audio segment(s)…`}</p>
    {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
    {error && !recording && <button disabled={disabled} onClick={() => void flush(true).catch(() => setError('Unable to save audio. Check your connection and retry.'))} className="text-xs font-semibold underline">Retry Saving Audio</button>}
  </div>;
});

export default MicRecorder;
