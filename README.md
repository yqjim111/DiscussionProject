# ClassDiscuss

Real-time AI-powered classroom discussion summarization. Students record their group discussions; Whisper transcribes the audio; Claude summarizes it into live bullet points visible to both students and instructors.

---

## Architecture

```
Browser (Next.js 14)
  ├─ Socket.io-client  ←→  Express + Socket.io server (port 3001)
  └─ fetch /api/*      ←→  Express REST routes
                              ├─ PostgreSQL  (rooms, groups)
                              └─ Redis       (transcripts, summaries)
                              └─ OpenAI Whisper  (audio → text)
                              └─ Anthropic Claude (text → bullets)
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 18 or 20 |
| Docker + Docker Compose | any recent version |
| npm | 9+ |

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd classdiscuss
npm install
```

### 2. Start PostgreSQL and Redis

```bash
docker compose up -d
```

This starts:
- PostgreSQL on `localhost:5432` with the schema auto-applied
- Redis on `localhost:6379`

### 3. Configure environment variables

Copy the example file and fill in your API keys:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# Database (matches docker-compose defaults — no change needed for local dev)
DATABASE_URL=postgresql://classroom:classroom_pass@localhost:5432/classroom_db

# Redis (matches docker-compose defaults)
REDIS_URL=redis://localhost:6379

# OpenAI — used for Whisper speech-to-text
OPENAI_API_KEY=sk-...

# Anthropic — used for Claude summarization
ANTHROPIC_API_KEY=sk-ant-...

# Express server port
PORT=3001

# URL the browser uses to reach the Express/Socket.io server
NEXT_PUBLIC_SOCKET_URL=http://localhost:3001

# CORS — restrict to your Next.js dev origin
FRONTEND_URL=http://localhost:3000
```

### 4. Run both servers

```bash
npm run dev
```

This uses `concurrently` to start:
- **Next.js** dev server on `http://localhost:3000`
- **Express + Socket.io** server on `http://localhost:3001`

Open `http://localhost:3000` in your browser.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `REDIS_URL` | Yes | Redis connection URL |
| `OPENAI_API_KEY` | Yes | OpenAI key for Whisper transcription |
| `ANTHROPIC_API_KEY` | Yes | Anthropic key for Claude summarization |
| `PORT` | No | Express server port (default: `3001`) |
| `NEXT_PUBLIC_SOCKET_URL` | Yes | Full URL of the Express server, visible to the browser |
| `FRONTEND_URL` | No | Allowed CORS origin (default: `http://localhost:3000`) |

---

## User Flows

### Instructor

1. Visit `/` → click **I am an Instructor**
2. Click **Create Room** → get a 6-digit code (e.g. `482910`)
3. Share the code with students
4. Watch group cards appear and update in real time
5. Click **Broadcast to Class** on any card to push its summary to all students
6. Click **Generate Overall Summary** for a Claude-synthesized class-wide view

### Student

1. Visit `/` → click **I am a Student**
2. Enter the 6-digit room code → **Join Room**
3. Click **+ Create Group**, enter group name and member names → **Start Session**
4. Allow microphone access when prompted
5. Click **Start Recording** — audio is sent in 10-second chunks to Whisper
6. Watch the left panel update with live bullet-point summaries
7. Click any bullet to edit/correct transcription errors (edits are preserved across AI updates)
8. Click **View Summary** on any group in the sidebar to view their live summary

---

## Project Structure

```
/app                            Next.js 14 App Router pages
  page.tsx                      Landing page (Instructor / Student)
  /instructor
    /create/page.tsx            Create room + display code
    /[roomCode]/page.tsx        Instructor dashboard (group cards, overall summary)
  /student
    /join/page.tsx              Room code entry
  /room
    /[roomCode]/page.tsx        Student split-panel view

/components
  GroupCard.tsx                 Instructor group summary card with Broadcast button
  MicRecorder.tsx               10-second chunked audio capture + Whisper upload
  EditableSummary.tsx           Editable bullet-point summary (preserves student edits)
  GroupSidebar.tsx              Right panel: create group form + group list
  BroadcastOverlay.tsx          Full-screen overlay for instructor broadcasts

/lib
  socket.ts                     Socket.io client singleton
  api.ts                        Typed fetch helpers for all REST endpoints

/server
  index.js                      Express + Socket.io entry point
  /db
    schema.sql                  PostgreSQL schema (auto-applied by Docker)
    pool.js                     pg Pool singleton
  /routes
    rooms.js                    POST /api/rooms, GET /api/rooms/:code
    groups.js                   POST /api/groups, GET /api/groups/:roomCode
    transcribe.js               POST /api/transcribe (Whisper)
  /services
    redis.js                    Redis client + transcript/summary helpers
    summarize.js                Claude API calls (group + overall summaries)
    scheduler.js                30-second summarization loop

docker-compose.yml              Local PostgreSQL + Redis
.env.example                    Environment variable template
```

---

## Socket.io Events

All events are scoped by `roomCode` to prevent cross-room leakage.

| Event | Direction | Payload | Description |
|-------|-----------|---------|-------------|
| `join:room` | client → server | `roomCode` | Join a Socket.io room |
| `group:created` | server → clients | `{ group }` | A new group was created |
| `group:summary:update` | server → clients | `{ groupId, groupName, summary }` | Scheduler emitted a new summary |
| `broadcast:summary` | instructor → server | `{ roomCode, groupId, groupName, summary }` | Instructor broadcasts a group's summary |
| `broadcast:received` | server → students | `{ groupId, groupName, summary }` | Students receive the broadcast overlay |

---

## How Summarization Works

1. Student records audio in **10-second chunks** via `MediaRecorder`
2. Each chunk is POSTed as `multipart/form-data` to `POST /api/transcribe`
3. The server forwards it to **OpenAI Whisper** and gets back text
4. The text is **appended** to `group:<id>:transcript` in Redis; `lastUpdated` is stamped
5. Every **30 seconds**, the scheduler checks all groups where `lastUpdated > lastSummaryTime`
6. For those groups, it reads the full rolling transcript and calls **Claude** with the system prompt:
   > *"Summarize the following student group discussion into 3–5 concise bullet points…"*
7. The summary is stored in `group:<id>:summary` in Redis
8. The server emits `group:summary:update` via Socket.io to all clients in the room

---

## Development Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js + Express concurrently |
| `npm run dev:next` | Next.js only |
| `npm run dev:server` | Express server only (with nodemon) |
| `npm run build` | Production Next.js build |
| `npm run server` | Run Express server (production) |

---

## Stopping Docker

```bash
docker compose down          # stop containers, keep volumes
docker compose down -v       # stop + delete all data
```
