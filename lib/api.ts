const BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
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
}

export interface Group {
  id: string;
  name: string;
  members: string[];
  summary: string;
  created_at?: string;
}

export function createRoom(): Promise<{ room: Room }> {
  return request('/api/rooms', { method: 'POST' });
}

export function getRoom(code: string): Promise<{ room: Room }> {
  return request(`/api/rooms/${code}`);
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
