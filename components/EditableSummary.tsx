'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { saveManualPoint, type Group, type ManualPoint } from '@/lib/api';

type Bullet = ManualPoint & { edited: boolean };
export interface EditableSummaryHandle { flush: () => Promise<void> }
type Saved = { summary: string; aiSummary: string; manualPoints: ManualPoint[] };
interface Props { group: Group; isEditable: boolean; onSaved?: (value: Saved) => void }
const parse = (summary: string) => summary.split('\n').map(s => s.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean);

const EditableSummary = forwardRef<EditableSummaryHandle, Props>(function EditableSummary({ group, isEditable, onSaved }, ref) {
  const ids = useRef(new Map<string, string>());
  const overrides = useRef(new Map<string, ManualPoint>());
  const dirty = useRef(new Map<string, ManualPoint>());
  const deleted = useRef(new Set<string>());
  const running = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const savedCallback = useRef(onSaved); savedCallback.current = onSaved;
  const storageKey = 'classdiscuss:points-draft:' + group.id;
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  function persistDraft() {
    // Browser draft quota must never become a length limit on server saves.
    try {
      if (dirty.current.size) localStorage.setItem(storageKey, JSON.stringify(Array.from(dirty.current.values())));
      else localStorage.removeItem(storageKey);
    } catch { /* dirty data stays in memory and is still sent to the server */ }
  }
  function mergedBullets(): Bullet[] {
    const points = new Map((group.manualPoints || []).map(p => [p.id, p]));
    overrides.current.forEach((p, id) => points.set(id, p));
    const replaced = new Set(Array.from(points.values()).map(p => p.replacesText).filter(Boolean));
    const manualTexts = new Set(Array.from(points.values()).map(p => p.text.trim()).filter(Boolean));
    const ai = parse(group.aiSummary ?? group.summary).filter(text => !replaced.has(text) && !manualTexts.has(text)).map(text => {
      if (!ids.current.has(text)) ids.current.set(text, crypto.randomUUID());
      return { id: ids.current.get(text)!, text, replacesText: text, edited: false };
    });
    return [...ai, ...Array.from(points.values()).filter(p => p.text.trim() || (overrides.current.has(p.id) && !deleted.current.has(p.id))).map(p => ({ ...p, edited: true }))];
  }
  async function flush() {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) { await running.current; if (dirty.current.size) return flush(); return; }
    const task = async () => {
      while (dirty.current.size) {
        const point = dirty.current.values().next().value!;
        if (mounted.current) { setStatus('Saving…'); setError(''); }
        try {
          const result = await saveManualPoint(group.id, point);
          if (dirty.current.get(point.id) === point) dirty.current.delete(point.id);
          persistDraft(); savedCallback.current?.(result);
        } catch (err) {
          if (mounted.current) { setError(err instanceof Error ? err.message : 'Unable to save. Your draft is retained.'); setStatus('Unsaved changes'); }
          throw err;
        }
      }
      if (mounted.current) setStatus('Saved');
    };
    running.current = task();
    try { await running.current; } finally { running.current = null; }
  }
  useImperativeHandle(ref, () => ({ flush }));
  useEffect(() => {
    mounted.current = true;
    if (isEditable) {
      try {
        const draft = JSON.parse(localStorage.getItem(storageKey) || '[]') as ManualPoint[];
        for (const p of draft) if (typeof p.text === 'string' && /^[a-f0-9-]{36}$/i.test(p.id)) { overrides.current.set(p.id, p); dirty.current.set(p.id, p); }
      } catch { /* malformed browser draft cannot replace the saved server data */ }
      if (dirty.current.size) void flush().catch(() => {});
    }
    return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); if (dirty.current.size) void flush().catch(() => {}); };
  }, []);
  useEffect(() => { setBullets(mergedBullets()); }, [group.aiSummary, group.summary, group.manualPoints]);

  function queue(point: ManualPoint) {
    overrides.current.set(point.id, point); dirty.current.set(point.id, point); persistDraft();
    setStatus('Unsaved changes');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => {}); }, 500);
  }
  function edit(bullet: Bullet, text: string) {
    const point = { id: bullet.id, text, replacesText: bullet.replacesText || null };
    setBullets(prev => prev.map(b => b.id === point.id ? { ...point, edited: true } : b)); queue(point);
  }
  function remove(bullet: Bullet) {
    deleted.current.add(bullet.id); setBullets(prev => prev.filter(b => b.id !== bullet.id));
    queue({ id: bullet.id, text: '', replacesText: bullet.replacesText || null });
  }
  function add() {
    const point = { id: crypto.randomUUID(), text: '', replacesText: null };
    overrides.current.set(point.id, point); setBullets(prev => [...prev, { ...point, edited: true }]);
  }
  function resize(el: HTMLTextAreaElement | null) { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }
  return <div className="w-full min-w-0">
    <div className="mb-4"><h2 className="text-xl font-bold text-gray-900">{group.name}</h2><p className="text-sm text-gray-500 mt-1">{group.members.join(', ')}</p></div>
    <div className="space-y-2">
      {!bullets.length && <p className="text-gray-500 italic text-sm">Add your own bullet points or select Generate AI Summary.</p>}
      {bullets.map((bullet, index) => <div key={bullet.id} className="group flex items-start gap-2 min-w-0">
        <span className="text-emerald-600 mt-2">•</span>
        {isEditable ? <textarea ref={resize} aria-label={'Bullet point ' + (index + 1)} value={bullet.text} rows={1} placeholder="Enter bullet point…"
          onChange={e => { edit(bullet, e.target.value); resize(e.target); }} onBlur={() => { void flush().catch(() => {}); }}
          className="flex-1 min-w-0 resize-none overflow-hidden bg-transparent text-sm py-1.5 border-b border-transparent focus:border-emerald-400 focus:outline-none leading-relaxed text-gray-800" />
          : <p className="flex-1 min-w-0 break-words whitespace-pre-wrap text-sm text-gray-800 py-1.5 leading-relaxed">{bullet.text}{bullet.edited && <span className="block text-xs text-gray-500">Student input</span>}</p>}
        {isEditable && <button onClick={() => remove(bullet)} aria-label="Delete bullet" className="text-gray-400 hover:text-red-600 p-1">×</button>}
      </div>)}
    </div>
    {isEditable && <div className="mt-4 flex flex-wrap items-center gap-3">
      <button onClick={add} className="text-sm text-emerald-700 font-semibold">+ Add bullet point</button>
      <button onClick={() => { void flush().catch(() => {}); }} className="text-sm border rounded-lg px-3 py-1.5">Save points</button>
      <span role="status" className="text-xs text-gray-500">{status}</span>
    </div>}
    {error && <p role="alert" className="text-red-700 text-sm mt-2">{error} Use Save points to retry.</p>}
  </div>;
});
export default EditableSummary;
