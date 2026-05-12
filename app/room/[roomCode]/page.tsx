'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { getGroups, type Group } from '@/lib/api';
import { getSocket } from '@/lib/socket';
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
    const poll = setInterval(loadGroups, 15_000);

    const socket = getSocket();
    socket.emit('join:room', roomCode);

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
    };
  }, [roomCode, loadGroups]);

  function handleGroupCreated(group: Group) {
    setGroups((prev) => {
      if (prev.find((g) => g.id === group.id)) return prev;
      return [...prev, { ...group, summary: '' }];
    });
    setMyGroupId(group.id);
    setActiveGroupId(group.id);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Slim header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold text-gray-900">
            Class<span className="text-emerald-600">Discuss</span>
          </span>
          <span className="text-gray-400 text-sm">
            Room&nbsp;
            <span className="font-mono font-semibold text-gray-700 tracking-widest">{roomCode}</span>
          </span>
        </div>
      </header>

      {/* Two-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — discussion summary (2/3) */}
        <div className="flex-1 p-6 overflow-y-auto" style={{ flexBasis: '66.666%' }}>
          {activeGroup ? (
            <EditableSummary group={activeGroup} isEditable={activeGroup.id === myGroupId} />
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
