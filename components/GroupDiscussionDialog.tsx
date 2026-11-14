'use client';
import { useEffect, useRef } from 'react';
import { type Group } from '@/lib/api';
import EditableSummary from './EditableSummary';
import Transcript from './Transcript';

export default function GroupDiscussionDialog({ group, onClose }: { group: Group; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose} aria-labelledby="group-discussion-title"
    className="w-[min(960px,95vw)] h-[90dvh] max-h-[90dvh] p-0 rounded-2xl backdrop:bg-black/50 bg-white text-gray-900">
    <div className="h-full flex flex-col">
      <header className="flex items-center justify-between gap-4 p-5 border-b">
        <div><h2 id="group-discussion-title" className="text-xl font-bold">{group.name} · Live Discussion</h2>
          <p className="text-sm text-gray-500">{group.online ? 'Online' : 'Offline · saved content'} · {group.members.join(', ')}</p></div>
        <button autoFocus onClick={onClose} className="border rounded-xl px-4 py-2 font-semibold">Close</button>
      </header>
      <div className="flex-1 min-h-0 grid grid-rows-2 gap-4 p-5">
        <section className="min-h-0 overflow-y-auto rounded-xl border p-5"><h3 className="font-semibold mb-3 text-orange-700">Summary & Student Points</h3>
          <EditableSummary key={group.id} group={group} isEditable={false} /></section>
        <section className="flex flex-col min-h-0 rounded-xl border p-5"><h3 className="font-semibold mb-3 text-orange-700">Original Transcription</h3>
          <Transcript text={group.transcript} /></section>
      </div>
    </div>
  </dialog>;
}
