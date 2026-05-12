'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom } from '@/lib/api';

export default function InstructorCreate() {
  const router = useRouter();
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    setLoading(true);
    setError('');
    try {
      const { room } = await createRoom();
      setRoomCode(room.code);
      // Auto-redirect after 3 seconds
      setTimeout(() => router.push(`/instructor/${room.code}`), 3000);
    } catch {
      setError('Failed to create room. Is the server running?');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Instructor Portal</h1>
        <p className="text-gray-500 mb-10">Create a room and share the code with your students.</p>

        {!roomCode ? (
          <>
            <button
              onClick={handleCreate}
              disabled={loading}
              className="px-14 py-5 bg-indigo-600 text-white text-xl font-semibold rounded-2xl
                         hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-lg"
            >
              {loading ? 'Creating room…' : 'Create Room'}
            </button>
            {error && <p className="mt-4 text-red-500 text-sm">{error}</p>}
          </>
        ) : (
          <div className="bg-white rounded-2xl shadow-xl p-10">
            <p className="text-gray-500 mb-2 text-sm uppercase tracking-widest font-medium">
              Your Room Code
            </p>
            <p className="text-8xl font-extrabold text-indigo-600 tracking-widest mb-6 font-mono">
              {roomCode}
            </p>
            <button
              onClick={handleCopy}
              className="px-8 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl
                         transition-colors text-sm"
            >
              {copied ? '✓ Copied!' : 'Copy Code'}
            </button>
            <p className="mt-6 text-gray-400 text-sm">Redirecting to your dashboard…</p>
          </div>
        )}
      </div>
    </main>
  );
}
