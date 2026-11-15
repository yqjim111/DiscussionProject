'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getRoom, updateRoom, updateDiscussionTimer, type Room } from '@/lib/api';
import { readTimer, formatTimer } from '@/lib/discussionTimer';
import { getSocket } from '@/lib/socket';

export default function DiscussionInstructions({ roomCode, editable = false }: { roomCode: string; editable?: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [topic, setTopic] = useState('');
  const [instructions, setInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [timerBusy, setTimerBusy] = useState(false);
  const [error, setError] = useState('');
  const [fontSize, setFontSize] = useState(40);
  const [minutes, setMinutes] = useState('10');
  const [now, setNow] = useState(Date.now());
  const [fullscreen, setFullscreen] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const clockOffset = useRef(0);
  const timer = readTimer(room?.discussion_timer, now + clockOffset.current);

  function receive(next: Room) {
    if (typeof next.server_now === 'number') clockOffset.current = next.server_now - Date.now();
    setRoom(next); setNow(Date.now());
  }
  useEffect(() => {
    let cancelled = false;
    const refresh = () => { void getRoom(roomCode).then(data => { if (!cancelled) receive(data.room); }).catch(() => {}); };
    refresh();
    const socket = getSocket();
    const join = () => socket.emit('join:room', roomCode);
    const updated = ({ room: next }: { room: Room }) => { if (next.code === roomCode && !cancelled) receive(next); };
    join(); socket.on('connect', join); socket.on('room:updated', updated);
    const interval = setInterval(refresh, 15000);
    return () => { cancelled = true; clearInterval(interval); socket.off('connect', join); socket.off('room:updated', updated); };
  }, [roomCode]);

  useEffect(() => {
    try { const stored = Number(localStorage.getItem('classdiscuss:instruction-font:' + roomCode)); if (stored >= 24 && stored <= 96) setFontSize(stored); } catch { /* presentation still works without local storage */ }
  }, [roomCode]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; closeButton.current?.focus();
    const tick = setInterval(() => setNow(Date.now()), 250);
    const changed = () => setFullscreen(document.fullscreenElement === screen.current);
    document.addEventListener('fullscreenchange', changed);
    return () => { clearInterval(tick); document.body.style.overflow = previousOverflow; document.removeEventListener('fullscreenchange', changed); trigger.current?.focus(); };
  }, [open]);

  async function show() {
    setError(''); setEditing(false); setOpen(true);
    try {
      const { room: latest } = await getRoom(roomCode);
      receive(latest); setTopic(latest.teacher_topic || ''); setInstructions(latest.discussion_instructions || '');
      setMinutes(String(Math.round(readTimer(latest.discussion_timer).durationSeconds / 60 * 100) / 100));
    } catch { setError('Unable to load discussion instructions. Close and try again.'); }
  }
  async function close() {
    if (document.fullscreenElement === screen.current) await document.exitFullscreen().catch(() => {});
    setOpen(false); setFullscreen(false);
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === screen.current) await document.exitFullscreen();
      else if (screen.current?.requestFullscreen) await screen.current.requestFullscreen();
      else setError('Browser fullscreen is unavailable. The presentation already fills this browser window.');
    } catch { setError('Browser fullscreen could not start. The presentation still fills this browser window.'); }
  }
  function changeFont(delta: number) {
    const next = Math.max(24, Math.min(96, fontSize + delta)); setFontSize(next);
    try { localStorage.setItem('classdiscuss:instruction-font:' + roomCode, String(next)); } catch { /* font size remains usable */ }
  }
  function edit() { setTopic(room?.teacher_topic || ''); setInstructions(room?.discussion_instructions || ''); setEditing(true); setError(''); }
  async function save() {
    setSaving(true); setError('');
    try {
      const { room: updated } = await updateRoom(roomCode, { teacher_topic: topic, discussion_instructions: instructions });
      receive(updated); setEditing(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to save instructions.'); }
    finally { setSaving(false); }
  }
  async function controlTimer(action: 'start' | 'pause' | 'resume' | 'reset') {
    const seconds = Math.round(Number(minutes) * 60);
    if ((action === 'start' || action === 'reset') && (!Number.isFinite(seconds) || seconds < 1 || !Number.isSafeInteger(seconds))) { setError('Enter a positive number of minutes.'); return; }
    setTimerBusy(true); setError('');
    try { const { room: updated } = await updateDiscussionTimer(roomCode, action, action === 'start' || action === 'reset' ? seconds : undefined); receive(updated); }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to update the countdown.'); }
    finally { setTimerBusy(false); }
  }
  function keyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') { event.preventDefault(); void close(); }
    if (event.key !== 'Tab' || !screen.current) return;
    const focusable = Array.from(screen.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [tabindex="0"]'));
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <>
    <button ref={trigger} onClick={() => void show()} className="rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700">Discussion Instruction</button>
    {open && createPortal(<div ref={screen} role="dialog" aria-modal="true" aria-labelledby="discussion-instruction-heading" onKeyDown={keyboard}
      className={'discussion-screen role-theme ' + (editable ? 'role-instructor' : 'role-student')}>
      <header className="instruction-header">
        <div className="instruction-toolbar">
          <div><p className="instruction-room">ClassDiscuss · Room {roomCode}</p><h2 id="discussion-instruction-heading">Discussion Instruction</h2></div>
          <div className="instruction-actions">
            {editable && <div className="instruction-font-controls" role="group" aria-label="Instruction font size">
              <button aria-label="Decrease instruction font size" disabled={fontSize <= 24} onClick={() => changeFont(-4)}>−</button>
              <span aria-label="Current instruction font size">{fontSize}px</span>
              <button aria-label="Increase instruction font size" disabled={fontSize >= 96} onClick={() => changeFont(4)}>＋</button>
            </div>}
            {editable && !editing && <button onClick={edit}>Edit discussion</button>}
            {editable && editing && <><button disabled={saving} onClick={() => setEditing(false)}>Cancel edit</button><button className="instruction-primary" disabled={saving || !room || !topic.trim()} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Changes'}</button></>}
            <button onClick={() => void toggleFullscreen()}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
            <button ref={closeButton} disabled={saving} onClick={() => void close()}>Close</button>
          </div>
        </div>
        <div className="instruction-timer-bar">
          <div className="instruction-countdown" data-status={timer.status}>
            <span className="instruction-timer-label">{timer.status === 'finished' ? "Time’s up" : timer.status === 'paused' ? 'Paused' : timer.status === 'running' ? 'Time remaining' : 'Discussion timer'}</span>
            <span role="timer" aria-label="Discussion countdown" aria-live="off">{formatTimer(timer.remainingMs)}</span>
          </div>
          {editable && <form className="instruction-timer-controls" onSubmit={e => { e.preventDefault(); void controlTimer('start'); }}>
            <label>Minutes<input aria-label="Countdown minutes" type="number" inputMode="decimal" min="0.02" step="any" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
            <button className="instruction-primary" type="submit" disabled={timerBusy || !room}>{timer.status === 'idle' ? 'Start countdown' : 'Restart countdown'}</button>
            <button type="button" disabled={timerBusy || !['running', 'paused'].includes(timer.status)} onClick={() => void controlTimer(timer.status === 'paused' ? 'resume' : 'pause')}>{timer.status === 'paused' ? 'Resume' : 'Pause'}</button>
            <button type="button" disabled={timerBusy || !room} onClick={() => void controlTimer('reset')}>Reset</button>
          </form>}
        </div>
      </header>
      {error && <p role="alert" className="instruction-error">{error}</p>}
      <main className="instruction-content" style={{ fontSize }}>
        {editing ? <>
          <label className="instruction-section-label">Discussion Topic<textarea aria-label="Discussion Topic" value={topic} onChange={e => setTopic(e.target.value)} maxLength={1500} rows={2} style={{ fontSize }} /></label>
          <label className="instruction-section-label">Discussion Instructions<textarea aria-label="Discussion Instructions" value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={5000} rows={7} style={{ fontSize }} /></label>
        </> : <>
          <section><h3 className="instruction-section-label">Discussion Topic</h3><p className="instruction-topic">{room?.teacher_topic || 'No topic provided.'}</p></section>
          <section><h3 className="instruction-section-label">Discussion Instructions</h3><p className="instruction-body">{room?.discussion_instructions || 'No additional instructions.'}</p></section>
        </>}
      </main>
    </div>, document.body)}
  </>;
}
