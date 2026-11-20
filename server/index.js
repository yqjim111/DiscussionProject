const path = require('path');
// Load .env.local first, then fall back to .env
require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const roomRoutes = require('./routes/rooms');
const groupRoutes = require('./routes/groups');
const transcribeRoute = require('./routes/transcribe');
const argumentMapRoute = require('./routes/argumentMap');
const reportRoutes = require('./routes/report');
const mapJobs = require('./services/argumentMapJobs');
const redis = require('./services/redis');
const { synthesizeAllSummaries } = require('./services/summarize');
const pool = require('./db/pool');
const { login, requireInstructor } = require('./services/instructorAuth');

const app = express();
const server = http.createServer(app);

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
// Restrict credentialed API calls to explicitly configured frontends.
const corsOrigin = [FRONTEND_URL, 'http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002'];

const io = new Server(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
});

// Make io accessible from route handlers
app.set('io', io);

app.use(cors({ origin: corsOrigin, credentials: true }));
// Reject cross-origin browser writes from sources outside the approved frontend list.
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !corsOrigin.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
  next();
});
// Typed contributions have no product-level length/count limit. Other API
// payloads keep their ordinary limits; audio uses its own multipart endpoint.
app.use('/api/groups/:groupId/points', express.json({ limit: Infinity }));
app.use(express.json());

// Health check — used by Railway to confirm the server is alive
app.get('/health', (_req, res) => res.json({ status: 'ok', report_pipeline: require('./services/claimReportAnalysis').METHOD_VERSION, argument_map_pipeline: require('./services/simpleArgumentAnalysis').METHOD_VERSION }));
app.post('/api/instructor/login', login);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/rooms', roomRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/transcribe', transcribeRoute);
app.use('/api/rooms', argumentMapRoute);
app.use('/api/rooms', reportRoutes);

// POST /api/rooms/:code/summary — synthesize all group summaries for a room
app.post('/api/rooms/:code/summary', requireInstructor, async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid room code' });

  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.name FROM groups g JOIN rooms r ON g.room_id = r.id WHERE r.code = $1`,
      [code]
    );

    const summaries = await Promise.all(
      rows.map(async (g) => ({ groupName: g.name, summary: await redis.getSummary(g.id) }))
    );
    const valid = summaries.filter((s) => s.summary && s.summary.trim().length > 0);
    const overall = await synthesizeAllSummaries(valid);

    const client = await redis.getClient();
    await client.set(`room:${code}:overallSummary`, overall);
    res.json({ summary: overall });
  } catch (err) {
    console.error('POST /api/rooms/:code/summary', err.message);
    res.status(500).json({ error: 'Failed to generate overall summary' });
  }
});

// ── Socket.io ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join:room', (roomCode) => {
    if (/^\d{6}$/.test(roomCode)) {
      socket.join(roomCode);
    }
  });

  // Instructor broadcasts a group summary to all students in the room
  socket.on('broadcast:summary', ({ roomCode, groupId, groupName, summary }) => {
    if (!/^\d{6}$/.test(roomCode)) return;
    // socket.to() excludes the sender so the instructor doesn't see the overlay
    socket.to(roomCode).emit('broadcast:received', { groupId, groupName, summary });
  });

  // Socket-backed presence, with multiple tabs counted independently.
  async function publishPresence(roomCode, groupId) {
    const sockets = await io.in(roomCode).fetchSockets();
    io.to(roomCode).emit('group:presence', {
      groupId, online: sockets.some(s => s.data.groupId === groupId)
    });
  }
  let presenceQueue = Promise.resolve();
  socket.on('group:join', ({ roomCode, groupId } = {}, ack) => {
    presenceQueue = presenceQueue.then(async () => {
      if (!/^\d{6}$/.test(roomCode || '') || !/^[a-f0-9-]{36}$/i.test(groupId || '')) {
        return ack?.({ error: 'Invalid room or group' });
      }
      const { rows } = await pool.query(
        'SELECT g.id FROM groups g JOIN rooms r ON r.id = g.room_id WHERE g.id = $1 AND r.code = $2',
        [groupId, roomCode]
      );
      if (!rows.length) return ack?.({ error: 'Group not found' });
      if (!socket.connected) return;
      const previous = { ...socket.data };
      socket.data = { groupId, roomCode };
      await socket.join(roomCode);
      if (previous.groupId) await publishPresence(previous.roomCode, previous.groupId);
      await publishPresence(roomCode, groupId);
      ack?.({ ok: true });
    }).catch(error => { console.error('Group presence:', error.message); ack?.({ error: 'Unable to join group' }); });
  });
  socket.on('group:leave', (ack) => {
    presenceQueue = presenceQueue.then(async () => {
      const { groupId, roomCode } = socket.data;
      // Leave only the group. Keep receiving classroom events and instructions.
      socket.data = { roomCode };
      if (groupId) await publishPresence(roomCode, groupId);
      ack?.({ ok: true });
    }).catch(error => { console.error('Leave group:', error.message); ack?.({ error: 'Unable to leave' }); });
  });
  socket.on('disconnect', () => {
    const { groupId, roomCode } = socket.data;
    if (groupId) void publishPresence(roomCode, groupId).catch(error => console.error('Presence:', error.message));
  });
});

// ── Startup ───────────────────────────────────────────────────────────────────
async function applySchema() {
  const fs = require('fs');
  const schemaPath = path.join(__dirname, 'db', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const sql = fs.readFileSync(schemaPath, 'utf8');
    await pool.query(sql);
    console.log('Database schema applied');
  }
}

async function start() {
  await applySchema();               // create tables if they don't exist yet
  await redis.getClient();           // ensure Redis is connected
  mapJobs.startWorker();
  // No automatic summaries or room expiry. Students request summaries explicitly;
  // data remains until an instructor deliberately ends the session.

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`ClassDiscuss server running on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  start().catch((err) => {
    console.error('Server startup failed:', err);
    process.exit(1);
  });
}

module.exports = { app, server, io, start };
