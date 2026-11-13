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
const scheduler = require('./services/scheduler');
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
app.use(express.json());

// Health check — used by Railway to confirm the server is alive
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.post('/api/instructor/login', login);

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/rooms', roomRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/transcribe', transcribeRoute);
app.use('/api/rooms', argumentMapRoute);

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

// GET /api/rooms/:code/report — read previously generated results; no new AI calls
app.get('/api/rooms/:code/report', requireInstructor, async (req, res) => {
  const { code } = req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Invalid room code' });
  try {
    const roomResult = await pool.query(
      'SELECT code, teacher_topic, discussion_instructions, duration_minutes, instructor_name, created_at FROM rooms WHERE code = $1',
      [code]
    );
    if (!roomResult.rows.length) return res.status(404).json({ error: 'Room not found' });
    const groupResult = await pool.query(
      'SELECT g.id, g.name FROM groups g JOIN rooms r ON g.room_id = r.id WHERE r.code = $1 ORDER BY g.created_at ASC',
      [code]
    );
    const client = await redis.getClient();
    const [graphRaw, summary] = await Promise.all([
      client.get(`room:${code}:argumentMap`),
      client.get(`room:${code}:overallSummary`)
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      room: roomResult.rows[0],
      groups: groupResult.rows.map(g => ({ id: String(g.id), name: g.name })),
      overallSummary: summary || null,
      argumentMap: graphRaw ? JSON.parse(graphRaw) : null
    });
  } catch (error) {
    console.error('GET report:', error.message);
    res.status(500).json({ error: 'Unable to load saved report data' });
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

  socket.on('disconnect', () => {});
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
  scheduler.setIO(io);
  scheduler.startScheduler();

  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
    console.log(`ClassDiscuss server running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Server startup failed:', err);
  process.exit(1);
});
