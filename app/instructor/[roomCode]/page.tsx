'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { getGroups, generateOverallSummary, type Group } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import GroupCard from '@/components/GroupCard';

export default function InstructorDashboard() {
  const params = useParams();
  const roomCode = params.roomCode as string;

  const [groups, setGroups] = useState<Group[]>([]);
  const [overallSummary, setOverallSummary] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [loadingOverall, setLoadingOverall] = useState(false);
  const [error, setError] = useState('');

  const loadGroups = useCallback(async () => {
    try {
      const { groups: data } = await getGroups(roomCode);
      setGroups(data);
    } catch {
      /* silently retry on next poll */
    }
  }, [roomCode]);

  useEffect(() => {
    loadGroups();
    const poll = setInterval(loadGroups, 10_000);

    const socket = getSocket();
    socket.emit('join:room', roomCode);

    socket.on('group:summary:update', ({ groupId, summary }: { groupId: string; summary: string }) => {
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, summary } : g)));
    });

    socket.on('group:created', ({ group }: { group: Group }) => {
      setGroups((prev) => {
        if (prev.find((g) => g.id === group.id)) return prev;
        return [...prev, group];
      });
    });

    return () => {
      clearInterval(poll);
      socket.off('group:summary:update');
      socket.off('group:created');
    };
  }, [roomCode, loadGroups]);

  async function handleGenerateOverall() {
    if (groups.length === 0) return;
    setLoadingOverall(true);
    setError('');
    try {
      const { summary } = await generateOverallSummary(roomCode);
      setOverallSummary(summary);
      setShowModal(true);
    } catch {
      setError('Failed to generate summary. Make sure groups have active discussions.');
    } finally {
      setLoadingOverall(false);
    }
  }

  function handleBroadcast(group: Group) {
    if (!group.summary) return;
    const socket = getSocket();
    socket.emit('broadcast:summary', {
      roomCode,
      groupId: group.id,
      groupName: group.name,
      summary: group.summary,
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-8 py-4 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Instructor Dashboard</h1>
            <p className="text-gray-500 text-sm">
              Share this code with students:{' '}
              <span className="font-mono font-bold text-indigo-600 text-xl tracking-widest">
                {roomCode}
              </span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={handleGenerateOverall}
              disabled={loadingOverall || groups.length === 0}
              className="px-6 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl
                         hover:bg-indigo-700 disabled:opacity-40 transition-colors text-sm"
            >
              {loadingOverall ? 'Generating…' : 'Generate Overall Summary'}
            </button>
            {error && <p className="text-red-500 text-xs">{error}</p>}
          </div>
        </div>
      </header>

      {/* Group grid */}
      <main className="max-w-7xl mx-auto px-8 py-8">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-28 text-center">
            <p className="text-5xl mb-4">📋</p>
            <p className="text-gray-400 text-lg">
              No groups yet. Students will appear here once they create groups.
            </p>
            <p className="text-gray-400 text-sm mt-1">
              Room code: <span className="font-mono font-bold">{roomCode}</span>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {groups.map((group) => (
              <GroupCard key={group.id} group={group} onBroadcast={() => handleBroadcast(group)} />
            ))}
          </div>
        )}
      </main>

      {/* Overall summary modal */}
      {showModal && overallSummary && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 max-h-[80vh] overflow-y-auto">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Overall Class Summary</h2>
            <div className="prose prose-sm text-gray-700 whitespace-pre-line">{overallSummary}</div>
            <button
              onClick={() => setShowModal(false)}
              className="mt-6 px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700
                         font-medium rounded-xl transition-colors text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
