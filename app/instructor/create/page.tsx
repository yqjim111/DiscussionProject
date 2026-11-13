'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom, loginInstructor } from '@/lib/api';


export default function InstructorCreate() {
  const router = useRouter();
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [topic, setTopic] = useState('');
  const [instructorName, setInstructorName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(15);
  const [authLoading, setAuthLoading] = useState(false);

  async function handlePinSubmit() {
    if (!pin.trim()) return;
    setAuthLoading(true);
    setPinError('');
    try {
      await loginInstructor(pin);
      setUnlocked(true);
      setPin('');
    } catch {
      setPinError('Incorrect PIN or unable to authenticate. Ask your administrator.');
      setPin('');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleCreate() {
    if (!topic.trim() || !instructorName.trim() || topic.length > 1500 || instructions.length > 5000 ||
      !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 180) {
      setError('Enter your instructor name, a topic and a valid duration between 1 and 180 minutes.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { room } = await createRoom({
        teacher_topic: topic.trim(),
        instructor_name: instructorName.trim(),
        discussion_instructions: instructions.trim(),
        duration_minutes: durationMinutes,
      });
      setRoomCode(room.code);
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

  // ── PIN gate ────────────────────────────────────────────────────────────────
  if (!unlocked) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex flex-col items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-xl p-10 w-full max-w-sm text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-1">Instructor Portal</h1>
          <p className="text-gray-500 text-sm mb-8">Enter your instructor PIN to continue.</p>

          <input
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => { setPin(e.target.value); setPinError(''); }}
            onKeyDown={(e) => e.key === 'Enter' && void handlePinSubmit()}
            placeholder="••••"
            className="w-full px-4 py-4 text-center text-2xl border-2 border-gray-200 rounded-xl
                       focus:border-indigo-500 focus:outline-none mb-4 tracking-widest"
          />

          {pinError && <p className="text-red-500 text-sm mb-4">{pinError}</p>}

          <button
            onClick={handlePinSubmit}
            disabled={pin.length === 0 || authLoading}
            className="w-full py-4 bg-indigo-600 text-white text-lg font-semibold rounded-xl
                       hover:bg-indigo-700 disabled:opacity-40 transition-colors"
          >
            {authLoading ? 'Signing in…' : 'Continue'}
          </button>
        </div>
      </main>
    );
  }

  // ── Create room ─────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex flex-col items-center justify-center px-4">
      <div className="text-center max-w-md w-full">
        <h1 className="text-3xl font-bold text-gray-900 mb-1">Instructor Portal</h1>
        <p className="text-gray-500 mb-10">Create a room and share the code with your students.</p>

        {!roomCode ? (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-lg p-6 text-left space-y-4">
            <label className="block text-sm font-semibold text-gray-700">
              Instructor Name *
              <input
                className="block w-full mt-2 p-3 border border-gray-300 rounded-lg text-sm"
                maxLength={255}
                placeholder="Name to include in the PDF report"
                value={instructorName}
                onChange={(e) => setInstructorName(e.target.value)}
              />
            </label>
            <label className="block text-sm font-semibold text-gray-700">
              Discussion Topic *
              <textarea
                className="block w-full mt-2 p-3 border border-gray-300 rounded-lg text-sm"
                rows={3}
                maxLength={1500}
                placeholder="Overall topic or discussion question"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              />
            </label>
            <label className="block text-sm font-semibold text-gray-700">
              Discussion Instructions (optional)
              <textarea
                className="block w-full mt-2 p-3 border border-gray-300 rounded-lg text-sm"
                rows={4}
                maxLength={5000}
                placeholder="Questions, subtopics, or ordered discussion tasks"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </label>
            <label className="block text-sm font-semibold text-gray-700">
              Duration (minutes) *
              <input
                type="number"
                min={1}
                max={180}
                className="block w-full mt-2 p-3 border border-gray-300 rounded-lg text-sm"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
              />
            </label>
            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full px-6 py-4 bg-indigo-600 text-white text-lg font-semibold rounded-xl
                         hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Creating room…' : 'Create Room'}
            </button>
            {error && <p className="mt-4 text-red-500 text-sm">{error}</p>}
          </div>
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
