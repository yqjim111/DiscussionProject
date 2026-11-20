'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { getGroups, generateOverallSummary, deleteRoom, type Group } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import GroupCard from '@/components/GroupCard';
import DownloadTranscriptionButton from '@/components/DownloadTranscriptionButton';
import DiscussionInstructions from '@/components/DiscussionInstructions';
import ArgumentMapLink from '@/components/ArgumentMapLink';
import GroupDiscussionDialog from '@/components/GroupDiscussionDialog';

export default function InstructorDashboard() {
  const params = useParams();
  const router = useRouter();
  const roomCode = params.roomCode as string;

  const [groups, setGroups] = useState<Group[]>([]);
  const [viewGroupId, setViewGroupId] = useState<string | null>(null);
  const viewedGroup = groups.find(g => g.id === viewGroupId);
  const [overallSummary, setOverallSummary] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [loadingOverall, setLoadingOverall] = useState(false);
  const [loadingEnd, setLoadingEnd] = useState(false);
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
    const poll = setInterval(loadGroups, 3000);

    const socket = getSocket();
    const join = () => socket.emit('join:room', roomCode);
    join(); socket.on('connect', join);
    const presence = ({ groupId, online }: { groupId: string; online: boolean }) => {
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, online } : g));
    };
    const transcript = ({ groupId, transcript }: { groupId: string; transcript: string }) => {
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, transcript } : g));
    };
    socket.on('group:presence', presence);
    socket.on('group:transcript:update', transcript);

    const contentUpdated = (update: Partial<Group> & { groupId: string }) => {
      setGroups(prev => prev.map(g => g.id === update.groupId ? { ...g, ...update } : g));
    };
    socket.on('group:summary:update', contentUpdated);
    socket.on('group:points:update', contentUpdated);

    socket.on('group:created', ({ group }: { group: Group }) => {
      setGroups((prev) => {
        if (prev.find((g) => g.id === group.id)) return prev;
        return [...prev, group];
      });
    });

    // Warn before accidental browser close / tab close
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(poll);
      socket.off('group:summary:update', contentUpdated);
      socket.off('group:points:update', contentUpdated);
      socket.off('group:created');
      socket.off('connect', join);
      socket.off('group:presence', presence);
      socket.off('group:transcript:update', transcript);
      window.removeEventListener('beforeunload', handleBeforeUnload);
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

  async function handleEndSession() {
    setLoadingEnd(true);
    try {
      await deleteRoom(roomCode);
      // Remove the beforeunload warning so navigation is clean
      window.onbeforeunload = null;
      router.push('/instructor/create');
    } catch {
      setError('Failed to end session. Try again.');
      setLoadingEnd(false);
    }
    setShowEndConfirm(false);
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
          <div className="flex flex-wrap items-center gap-3">
            <DiscussionInstructions roomCode={roomCode} editable />
            <DownloadTranscriptionButton roomCode={roomCode} onError={setError}
              className="px-6 py-2.5 bg-emerald-700 text-white font-semibold rounded-xl hover:bg-emerald-800 transition-colors text-sm disabled:opacity-50" />
            <ArgumentMapLink roomCode={roomCode} />
            <button
              onClick={handleGenerateOverall}
              disabled={loadingOverall || groups.length === 0}
              className="px-6 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl
                         hover:bg-indigo-700 disabled:opacity-40 transition-colors text-sm"
            >
              {loadingOverall ? 'Generating…' : 'Generate Overall Summary'}
            </button>
            <button
              onClick={() => setShowEndConfirm(true)}
              className="px-6 py-2.5 bg-red-600 text-white font-semibold rounded-xl
                         hover:bg-red-700 transition-colors text-sm"
            >
              End Session
            </button>
          </div>
        </div>
        {error && <p className="text-center text-red-500 text-xs mt-1">{error}</p>}
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
              <GroupCard key={group.id} group={group} onView={() => setViewGroupId(group.id)} onBroadcast={() => handleBroadcast(group)} />
            ))}
          </div>
        )}
      </main>

      {viewedGroup && <GroupDiscussionDialog group={viewedGroup} onClose={() => setViewGroupId(null)} />}

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

      {/* End session confirmation */}
      {showEndConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full p-8 text-center">
            <p className="text-4xl mb-4">⚠️</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">End this session?</h2>
            <p className="text-gray-500 text-sm mb-6">
              This permanently deletes the room, all groups, and all transcripts.
              Students will no longer be able to use this room code.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700
                           font-semibold rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEndSession}
                disabled={loadingEnd}
                className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white
                           font-semibold rounded-xl transition-colors disabled:opacity-50"
              >
                {loadingEnd ? 'Ending…' : 'Yes, End Session'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
