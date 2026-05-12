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

function startScheduler() {
  setInterval(runSummarizationCycle, 30_000);
  console.log('Summarization scheduler started — running every 30s');
}

module.exports = { setIO, startScheduler };
