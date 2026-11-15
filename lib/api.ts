const BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, credentials: 'include', cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface Room {
  id: string;
  code: string;
  created_at: string;
  teacher_topic: string | null;
  instructor_name: string | null;
  discussion_instructions: string;
  duration_minutes: number | null;
  discussion_timer?: { status: string; durationSeconds: number; remainingMs: number; endsAt: number | null };
  server_now?: number;
}

export function updateDiscussionTimer(code: string, action: 'start' | 'pause' | 'resume' | 'reset', durationSeconds?: number): Promise<{ room: Room }> {
  return request(`/api/rooms/${code}/timer`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, durationSeconds }) });
}

export interface ManualPoint { id: string; text: string; replacesText?: string | null }
export interface Group {
  id: string;
  name: string;
  members: string[];
  summary: string;
  aiSummary?: string;
  manualPoints?: ManualPoint[];
  transcript?: string;
  online?: boolean;
  created_at?: string;
}

export function loginInstructor(pin: string): Promise<{ authenticated: boolean }> {
  return request('/api/instructor/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}

export function createRoom(data: {
  teacher_topic: string;
  instructor_name: string;
  discussion_instructions: string;
}): Promise<{ room: Room }> {
  return request('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function getRoom(code: string): Promise<{ room: Room }> {
  return request(`/api/rooms/${code}`);
}

export function updateRoom(code: string, data: { teacher_topic: string; discussion_instructions: string }): Promise<{ room: Room }> {
  return request(`/api/rooms/${code}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
}

export function generateGroupSummary(groupId: string): Promise<{ summary: string; aiSummary: string; manualPoints: ManualPoint[] }> {
  return request(`/api/groups/${groupId}/summary`, { method: 'POST' });
}

export function saveManualPoint(groupId: string, point: ManualPoint): Promise<{ groupId: string; summary: string; aiSummary: string; manualPoints: ManualPoint[] }> {
  return request(`/api/groups/${groupId}/points/${point.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(point) });
}

export function createGroup(data: {
  roomCode: string;
  name: string;
  members: string;
}): Promise<{ group: Group }> {
  return request('/api/groups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function getGroups(roomCode: string): Promise<{ groups: Group[] }> {
  return request(`/api/groups/${roomCode}`);
}

export function transcribeAudio(formData: FormData): Promise<{ transcript: string }> {
  return request('/api/transcribe', { method: 'POST', body: formData });
}

export function generateOverallSummary(roomCode: string): Promise<{ summary: string }> {
  return request(`/api/rooms/${roomCode}/summary`, { method: 'POST' });
}

export function deleteRoom(roomCode: string): Promise<{ ok: boolean }> {
  return request(`/api/rooms/${roomCode}`, { method: 'DELETE' });
}
