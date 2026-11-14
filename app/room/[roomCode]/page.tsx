'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { getGroups, generateGroupSummary, type Group } from '@/lib/api';
import { getSocket, disconnectSocket } from '@/lib/socket';
import type { RecorderHandle } from '@/components/MicRecorder';
import DiscussionInstructions from '@/components/DiscussionInstructions';
import Transcript from '@/components/Transcript';
import EditableSummary from '@/components/EditableSummary';
import GroupSidebar from '@/components/GroupSidebar';
import BroadcastOverlay from '@/components/BroadcastOverlay';

interface BroadcastData {
  groupId: string;
  groupName: string;
  summary: string;
}

export default function StudentRoom() {
  const params = useParams();
  const roomCode = params.roomCode as string;
  const router = useRouter();
  const recorderRef = useRef<RecorderHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [groups, setGroups] = useState<Group[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [myGroupId, setMyGroupId] = useState<string | null>(null);
  const [broadcast, setBroadcast] = useState<BroadcastData | null>(null);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;

  const loadGroups = useCallback(async () => {
    try {
      const { groups: data } = await getGroups(roomCode);
      setGroups(data);
    } catch {
      /* silently retry */
    }
  }, [roomCode]);

  useEffect(() => {
    loadGroups();
    const poll = setInterval(loadGroups, 5000);

    const socket = getSocket();
    const joinRoom = () => socket.emit('join:room', roomCode);
    joinRoom();
    socket.on('connect', joinRoom);
    const transcriptUpdated = ({ groupId, transcript }: { groupId: string; transcript: string }) => {
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, transcript } : g));
    };
    socket.on('group:transcript:update', transcriptUpdated);

    socket.on('group:summary:update', ({ groupId, summary }: { groupId: string; summary: string }) => {
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, summary } : g)));
    });

    socket.on('group:created', ({ group }: { group: Group }) => {
      setGroups((prev) => {
        if (prev.find((g) => g.id === group.id)) return prev;
        return [...prev, { ...group, summary: '' }];
      });
    });

    socket.on('broadcast:received', (data: BroadcastData) => {
      setBroadcast(data);
    });

    return () => {
      clearInterval(poll);
      socket.off('group:summary:update');
      socket.off('group:created');
      socket.off('broadcast:received');
      socket.off('connect', joinRoom);
      socket.off('group:transcript:update', transcriptUpdated);
    };
  }, [roomCode, loadGroups]);

  // Resume the original group after leaving, refreshing, or opening this room again.
  useEffect(() => {
    const saved = localStorage.getItem('classdiscuss:group:' + roomCode);
    if (saved) { setMyGroupId(saved); setActiveGroupId(saved); }
  }, [roomCode]);

  useEffect(() => {
    if (!myGroupId) return;
    const socket = getSocket();
    const join = () => socket.emit('group:join', { roomCode, groupId: myGroupId }, (result: { error?: string }) => {
      if (result.error) {
        setError(result.error);
        if (result.error === 'Group not found') {
          localStorage.removeItem('classdiscuss:group:' + roomCode);
          setMyGroupId(null); setActiveGroupId(null);
        }
      }
    });
    join(); socket.on('connect', join);
    return () => { socket.off('connect', join); socket.emit('group:leave'); };
  }, [roomCode, myGroupId]);

  async function generateSummary() {
    if (!myGroupId) return;
    setBusy(true); setError('');
    try {
      await recorderRef.current?.flush();
      const { summary } = await generateGroupSummary(myGroupId);
      setGroups(prev => prev.map(g => g.id === myGroupId ? { ...g, summary } : g));
      setActiveGroupId(myGroupId);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to generate summary.'); }
    finally { setBusy(false); }
  }

  async function leaveRoom() {
    setBusy(true); setError('');
    try {
      await recorderRef.current?.flush(true);
      disconnectSocket();
      router.push('/student/join');
    } catch { setError('Some audio could not be saved. Keep this page open and try Leave Room again.'); setBusy(false); }
  }

  function handleGroupCreated(group: Group) {
    setGroups((prev) => {
      if (prev.find((g) => g.id === group.id)) return prev;
      return [...prev, { ...group, summary: '' }];
    });
    setMyGroupId(group.id);
    setActiveGroupId(group.id);
    localStorage.setItem('classdiscuss:group:' + roomCode, group.id);
  }

  return (
    <div className="h-dvh bg-gray-50 flex flex-col">
      {/* Slim header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-lg font-bold text-gray-900">
            Class<span className="text-emerald-600">Discuss</span>
          </span>
          <span className="text-gray-400 text-sm">
            Room&nbsp;
            <span className="font-mono font-semibold text-gray-700 tracking-widest">{roomCode}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            <DiscussionInstructions roomCode={roomCode} />
            <button disabled={!myGroupId || busy} onClick={() => void generateSummary()} className="bg-emerald-600 text-white px-4 py-2.5 rounded-xl font-semibold text-sm disabled:opacity-40">{busy ? 'Saving / processing…' : 'Generate AI Summary'}</button>
            <button disabled={busy} onClick={() => void leaveRoom()} className="border border-gray-300 px-4 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40">Leave Room</button>
          </div>
        </div>
        {error && <p role="alert" className="text-red-700 text-sm mt-2">{error}</p>}
      </header>

      {/* Two-panel layout */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left panel — discussion summary (2/3) */}
        <div className="flex-1 min-w-0 min-h-0 p-4 flex flex-col" style={{ flexBasis: '66.666%' }}>
          {activeGroup ? (
            <div className="grid grid-rows-2 gap-4 flex-1 min-h-0">
              <section className="overflow-y-auto rounded-xl border bg-white p-5 min-h-0">
                <h2 className="text-sm font-semibold text-emerald-700 mb-3">AI Summary</h2>
                <EditableSummary key={activeGroup.id} group={activeGroup} isEditable={activeGroup.id === myGroupId} />
              </section>
              <section className="flex flex-col min-h-0 rounded-xl border bg-white p-5">
                <h2 className="text-base font-bold mb-2">Original Transcription · {activeGroup.name}</h2>
                <Transcript key={activeGroup.id} text={activeGroup.transcript} />
              </section>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <p className="text-5xl mb-4">💬</p>
              <p className="text-gray-400 text-lg">Join or create a group to begin</p>
              <p className="text-gray-400 text-sm mt-1">
                Use the panel on the right to get started.
              </p>
            </div>
          )}
        </div>

        {/* Right panel — sidebar (1/3) */}
        <div
          className="border-l border-gray-200 bg-white overflow-y-auto p-4 flex-shrink-0"
          style={{ width: '320px' }}
        >
          <GroupSidebar
            roomCode={roomCode}
            groups={groups}
            myGroupId={myGroupId}
            activeGroupId={activeGroupId}
            onGroupCreated={handleGroupCreated}
            onViewGroup={setActiveGroupId}
            recorderRef={recorderRef}
            busy={busy}
          />
        </div>
      </div>

      {/* Broadcast overlay */}
      {broadcast && (
        <BroadcastOverlay data={broadcast} onDismiss={() => setBroadcast(null)} />
      )}
    </div>
  );
}
