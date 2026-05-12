'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getRoom } from '@/lib/api';

export default function StudentJoin() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    if (!/^\d{6}$/.test(code)) {
      setError('Please enter a valid 6-digit room code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await getRoom(code);
      router.push(`/room/${code}`);
    } catch {
      setError('Room not found. Please check the code and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-emerald-50 flex flex-col items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-10 w-full max-w-sm text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Join a Class</h1>
        <p className="text-gray-500 text-sm mb-8">
          Enter the 6-digit code from your instructor.
        </p>

        <input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={(e) => {
            setCode(e.target.value.replace(/\D/g, ''));
            setError('');
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
          placeholder="000000"
          className="w-full px-4 py-4 text-center text-3xl font-mono border-2 border-gray-200
                     rounded-xl focus:border-emerald-500 focus:outline-none mb-4 tracking-[0.4em]"
        />

        {error && (
          <p className="text-red-500 text-sm mb-4">{error}</p>
        )}

        <button
          onClick={handleJoin}
          disabled={loading || code.length !== 6}
          className="w-full py-4 bg-emerald-600 text-white text-lg font-semibold rounded-xl
                     hover:bg-emerald-700 disabled:opacity-40 transition-colors"
        >
          {loading ? 'Joining…' : 'Join Room'}
        </button>
      </div>
    </main>
  );
}
