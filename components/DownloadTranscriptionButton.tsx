'use client';
import { useState } from 'react';
const BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
export default function DownloadTranscriptionButton({ roomCode, className = '', onError }: { roomCode: string; className?: string; onError?: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setBusy(true); setError(''); onError?.('');
    try {
      const response = await fetch(BASE + '/api/rooms/' + encodeURIComponent(roomCode) + '/transcription', { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to download transcriptions.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'discussion-transcription-' + roomCode + '.txt';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { const message = e instanceof Error ? e.message : 'Unable to download transcriptions.'; setError(message); onError?.(message); }
    finally { setBusy(false); }
  }
  return <><button type="button" disabled={busy} onClick={() => void download()} className={className}>{busy ? 'Downloading…' : 'Download transcription'}</button>{error && !onError && <p role="alert" className="text-red-700 text-sm">{error}</p>}</>;
}
