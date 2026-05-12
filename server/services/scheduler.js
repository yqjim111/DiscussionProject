const pool = require('../db/pool');
const redis = require('./redis');
const { summarizeTranscript } = require('./summarize');

let io = null;

function setIO(socketIO) {
  io = socketIO;
}

async function runSummarizationCycle() {
  try {
    const result = await pool.query(
      `SELECT g.id, g.name, r.code AS room_code
       FROM groups g
       JOIN rooms r ON g.room_id = r.id`
    );

    for (const group of result.rows) {
      const lastUpdated = await redis.getLastUpdated(group.id);
      const lastSummaryTime = await redis.getLastSummaryTime(group.id);

      if (lastUpdated === 0 || lastUpdated <= lastSummaryTime) continue;

      const transcript = await redis.getTranscript(group.id);
      if (!transcript || transcript.trim().length < 20) continue;

      const summary = await summarizeTranscript(transcript);
      if (!summary) continue;

      await redis.setSummary(group.id, summary);

      if (io) {
        io.to(group.room_code).emit('group:summary:update', {
          groupId: group.id,
          groupName: group.name,
          summary,
        });
      }

      console.log(`Summarized group ${group.name} in room ${group.room_code}`);
    }
  } catch (err) {
    console.error('Summarization cycle error:', err.message);
  }
}

// Delete rooms older than 24 hours and clean their Redis keys
async function cleanupOldRooms() {
  try {
    const { rows: groups } = await pool.query(
      `SELECT g.id FROM groups g
       JOIN rooms r ON g.room_id = r.id
       WHERE r.created_at < NOW() - INTERVAL '24 hours'`
    );

    const { rows: rooms } = await pool.query(
      `DELETE FROM rooms WHERE created_at < NOW() - INTERVAL '24 hours' RETURNING code`
    );

    if (rooms.length === 0) return;

    const redisClient = await redis.getClient();
    for (const g of groups) {
      await redisClient.del(`group:${g.id}:transcript`);
      await redisClient.del(`group:${g.id}:summary`);
      await redisClient.del(`group:${g.id}:lastUpdated`);
      await redisClient.del(`group:${g.id}:lastSummaryTime`);
    }

    console.log(`Auto-cleaned ${rooms.length} expired room(s)`);
  } catch (err) {
    console.error('Room cleanup error:', err.message);
  }
}

function startScheduler() {
  setInterval(runSummarizationCycle, 30_000);
  setInterval(cleanupOldRooms, 60 * 60 * 1000); // run every hour
  console.log('Summarization scheduler started — running every 30s');
}

module.exports = { setIO, startScheduler };
