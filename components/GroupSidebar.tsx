'use client';

import { useState } from 'react';
import { createGroup, type Group } from '@/lib/api';
import MicRecorder from './MicRecorder';

interface Props {
  roomCode: string;
  groups: Group[];
  myGroupId: string | null;
  activeGroupId: string | null;
  onGroupCreated: (group: Group) => void;
  onViewGroup: (id: string) => void;
}

export default function GroupSidebar({
  roomCode,
  groups,
  myGroupId,
  activeGroupId,
  onGroupCreated,
  onViewGroup,
}: Props) {
  const [showForm, setShowForm] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [members, setMembers] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const myGroup = groups.find((g) => g.id === myGroupId);

  async function handleCreate() {
    if (!groupName.trim()) {
      setError('Please enter a group name.');
      return;
    }
    if (!members.trim()) {
      setError('Please enter at least one member name.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { group } = await createGroup({
        roomCode,
        name: groupName.trim(),
        members: members.trim(),
      });
      onGroupCreated({ ...group, summary: '' });
      setGroupName('');
      setMembers('');
      setShowForm(false);
    } catch {
      setError('Failed to create group. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <h2 className="text-base font-bold text-gray-900">Groups</h2>

      {/* Create group — only if not already in a group */}
      {!myGroupId && (
        <div className="space-y-2">
          <button
            onClick={() => setShowForm((v) => !v)}
            className="w-full py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg
                       hover:bg-emerald-700 transition-colors"
          >
            {showForm ? 'Cancel' : '+ Create Group'}
          </button>

          {showForm && (
            <div className="bg-gray-50 rounded-xl p-4 space-y-3 border border-gray-100">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Group Name</label>
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Group A"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:border-emerald-500 focus:outline-none bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Member Names
                  <span className="font-normal text-gray-400 ml-1">(comma or line separated)</span>
                </label>
                <textarea
                  value={members}
                  onChange={(e) => setMembers(e.target.value)}
                  placeholder={'Alice, Bob, Charlie'}
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
                             focus:border-emerald-500 focus:outline-none resize-none bg-white"
                />
              </div>

              {error && <p className="text-red-500 text-xs">{error}</p>}

              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full py-2 bg-emerald-600 text-white text-sm font-semibold rounded-lg
                           hover:bg-emerald-700 disabled:opacity-40 transition-colors"
              >
                {loading ? 'Creating…' : 'Start Session'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* My group + recorder */}
      {myGroup && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
          <p className="text-xs font-semibold text-emerald-600 mb-0.5">Your group</p>
          <p className="font-semibold text-gray-900 text-sm">{myGroup.name}</p>
          <p className="text-xs text-gray-500 truncate">{myGroup.members.join(', ')}</p>
          <MicRecorder groupId={myGroup.id} />
        </div>
      )}

      {/* Group list */}
      <div className="space-y-2">
        {groups.length === 0 && !myGroupId && (
          <p className="text-xs text-gray-400 text-center py-6">
            No groups yet. Be the first to create one!
          </p>
        )}

        {groups.map((group) => (
          <div
            key={group.id}
            className={`rounded-xl border p-3 transition-colors ${
              activeGroupId === group.id
                ? 'border-emerald-400 bg-emerald-50'
                : 'border-gray-100 bg-white'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{group.name}</p>
                <p className="text-xs text-gray-400">
                  {group.members.length} member{group.members.length !== 1 ? 's' : ''}
                </p>
              </div>

              {group.id !== myGroupId ? (
                <button
                  onClick={() => onViewGroup(group.id)}
                  className="flex-shrink-0 text-xs text-emerald-600 hover:text-emerald-700
                             font-semibold transition-colors"
                >
                  View Summary
                </button>
              ) : (
                <span className="flex-shrink-0 text-xs text-emerald-500 font-medium">You</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
