'use client';

import { useEffect, useState } from 'react';
import { getRoom, updateRoom, type Room } from '@/lib/api';
import { getSocket } from '@/lib/socket';

export default function DiscussionInstructions({ roomCode, editable = false }: { roomCode: string; editable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [topic, setTopic] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const refresh = () => { void getRoom(roomCode).then(data => { if (!cancelled) setRoom(data.room); }).catch(() => {}); };
    refresh();
    const socket = getSocket();
    const updated = ({ room: next }: { room: Room }) => { if (next.code === roomCode) setRoom(next); };
    socket.on('room:updated', updated);
    const interval = setInterval(refresh, 15000);
    return () => { cancelled = true; clearInterval(interval); socket.off('room:updated', updated); };
  }, [roomCode]);

  async function show() {
    setError(''); setOpen(true);
    try {
      const { room: latest } = await getRoom(roomCode);
      setRoom(latest); setTopic(latest.teacher_topic || ''); setInstructions(latest.discussion_instructions || '');
    } catch { setError('Unable to load discussion instructions. Close and try again.'); }
  }

  async function save() {
    setSaving(true); setError('');
    try {
      const { room: updated } = await updateRoom(roomCode, { teacher_topic: topic, discussion_instructions: instructions });
      setRoom(updated); setOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save instructions.'); }
    finally { setSaving(false); }
  }

  return <>
    <button onClick={() => void show()} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700">Discussion Instruction</button>
    {open && <div role="dialog" aria-modal="true" aria-labelledby="discussion-instruction-heading" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-white p-6 space-y-5 text-gray-900">
        <h2 id="discussion-instruction-heading" className="text-xl font-bold">Discussion Instruction</h2>
        {editable ? <>
          <label className="block text-sm font-semibold">Discussion Topic
            <textarea value={topic} onChange={e => setTopic(e.target.value)} maxLength={1500} rows={3} className="mt-2 w-full border rounded-lg p-3 font-normal" />
          </label>
          <label className="block text-sm font-semibold">Discussion Instructions
            <textarea value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={5000} rows={6} className="mt-2 w-full border rounded-lg p-3 font-normal" />
          </label>
          <p className="text-xs text-gray-500">Saved changes are shared with everyone in this room immediately. There is no time limit.</p>
        </> : <>
          <div><h3 className="font-semibold">Discussion Topic</h3><p className="mt-2 whitespace-pre-wrap">{room?.teacher_topic || 'No topic provided.'}</p></div>
          <div><h3 className="font-semibold">Discussion Instructions</h3><p className="mt-2 whitespace-pre-wrap">{room?.discussion_instructions || 'No additional instructions.'}</p></div>
        </>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex gap-3 justify-end">
          <button disabled={saving} onClick={() => setOpen(false)} className="border rounded-lg px-4 py-2">Close</button>
          {editable && <button disabled={saving || !room || !topic.trim()} onClick={() => void save()} className="bg-indigo-600 text-white rounded-lg px-4 py-2 disabled:opacity-40">{saving ? 'Saving…' : 'Save Changes'}</button>}
        </div>
      </div>
    </div>}
  </>;
}
