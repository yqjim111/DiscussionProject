'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function ArgumentMapLink({ roomCode }: { roomCode: string }) {
  const [status, setStatus] = useState('');
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch((process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001') + '/api/rooms/' + roomCode + '/argument-map', { credentials: 'include', cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) setStatus(data.job?.status || '');
      } catch { /* Link stays available while the backend reconnects. */ }
    };
    void refresh();
    const interval = setInterval(refresh, 3000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [roomCode]);
  return <Link href={`/instructor/${roomCode}/argument-map`} className="px-6 py-2.5 bg-violet-600 text-white font-semibold rounded-xl hover:bg-violet-700 transition-colors text-sm">
    Argument Map{status === 'running' || status === 'queued' ? ' · Generating…' : status === 'succeeded' ? ' · Ready' : status === 'failed' ? ' · Retry' : ''}
  </Link>;
}
