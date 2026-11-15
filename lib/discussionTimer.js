const DEFAULT_SECONDS = 600;
function readTimer(value, now = Date.now()) {
  const durationSeconds = Number.isSafeInteger(value?.durationSeconds) && value.durationSeconds > 0 ? value.durationSeconds : DEFAULT_SECONDS;
  const durationMs = durationSeconds * 1000;
  if (value?.status === 'running' && Number.isFinite(value.endsAt)) {
    const remainingMs = Math.max(0, value.endsAt - now);
    return { status: remainingMs ? 'running' : 'finished', durationSeconds, remainingMs, endsAt: remainingMs ? value.endsAt : null };
  }
  if (value?.status === 'paused' && Number.isFinite(value.remainingMs)) {
    const remainingMs = Math.max(0, value.remainingMs);
    return { status: remainingMs ? 'paused' : 'finished', durationSeconds, remainingMs, endsAt: null };
  }
  if (value?.status === 'finished') return { status: 'finished', durationSeconds, remainingMs: 0, endsAt: null };
  return { status: 'idle', durationSeconds, remainingMs: durationMs, endsAt: null };
}
function transitionTimer(value, action, seconds, now = Date.now()) {
  const current = readTimer(value, now);
  if (action === 'start' || action === 'reset') {
    const durationSeconds = seconds ?? current.durationSeconds;
    if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || !Number.isSafeInteger(now + durationSeconds * 1000)) throw new Error('Enter a valid positive duration.');
    return { status: action === 'start' ? 'running' : 'idle', durationSeconds, remainingMs: durationSeconds * 1000, endsAt: action === 'start' ? now + durationSeconds * 1000 : null };
  }
  if (action === 'pause') return current.status === 'running' ? { ...current, status: 'paused', endsAt: null } : current;
  if (action === 'resume') {
    if (current.status !== 'paused') throw new Error('Only a paused countdown can be resumed.');
    return { ...current, status: 'running', endsAt: now + current.remainingMs };
  }
  throw new Error('Invalid timer action.');
}
function formatTimer(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds / 60) % 60, rest = seconds % 60;
  return (hours ? String(hours).padStart(2, '0') + ':' : '') + String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
}
module.exports = { readTimer, transitionTimer, formatTimer };
