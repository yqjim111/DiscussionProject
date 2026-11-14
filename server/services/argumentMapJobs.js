'use strict';

const pool = require('../db/pool');
const redis = require('./redis');
const { analyzeArgumentMap } = require('./argumentMap');
let working = null;
let interval = null;

function publicJob(job) {
  return job ? { id: job.id, status: job.status, stage: job.stage, error: job.error, updated_at: job.updated_at } : null;
}

async function getJob(code) {
  const { rows } = await pool.query('SELECT * FROM argument_map_jobs WHERE room_code = $1', [code]);
  return rows[0] || null;
}

async function enqueue(code, input) {
  const { rows } = await pool.query(`
    INSERT INTO argument_map_jobs (room_code, input) VALUES ($1, $2::jsonb)
    ON CONFLICT (room_code) DO UPDATE SET id = gen_random_uuid(), status = 'queued',
      stage = 'Queued', input = EXCLUDED.input, error = NULL, lease_until = NULL, updated_at = NOW()
    WHERE argument_map_jobs.status NOT IN ('queued', 'running')
    RETURNING *`, [code, JSON.stringify(input)]);
  return rows[0] || getJob(code);
}

async function drain() {
  for (;;) {
    // Expired leases recover interrupted jobs after a backend restart. SKIP LOCKED
    // prevents two Railway replicas from analyzing the same job concurrently.
    const { rows } = await pool.query(`
      UPDATE argument_map_jobs SET status = 'running', stage = 'Preparing original transcripts',
        lease_until = NOW() + INTERVAL '15 minutes', updated_at = NOW()
      WHERE room_code = (
        SELECT room_code FROM argument_map_jobs
        WHERE status = 'queued' OR (status = 'running' AND lease_until < NOW())
        ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1
      ) RETURNING *`);
    const job = rows[0];
    if (!job) return;
    try {
      const input = job.input;
      const graph = await analyzeArgumentMap({ ...input, onProgress: async stage => {
        await pool.query("UPDATE argument_map_jobs SET stage = $1, updated_at = NOW() WHERE id = $2 AND status = 'running'", [stage, job.id]);
      } });
      const payload = {
        ...graph, groups: input.groups.map(g => ({ id: g.id, name: g.name })),
        input: { source: 'original_transcripts', generated_at: new Date().toISOString(), topic: input.topic, instructions: input.instructions,
          groups: input.groups.map(g => ({ id: g.id, name: g.name, characters: g.transcript.length })) }
      };
      const completed = await pool.query(`UPDATE argument_map_jobs SET status = 'succeeded', stage = 'Complete',
        result = $1::jsonb, error = NULL, lease_until = NULL, updated_at = NOW() WHERE id = $2 AND status = 'running' RETURNING room_code`, [JSON.stringify(payload), job.id]);
      if (completed.rows.length) {
        // PostgreSQL is authoritative; a cache failure cannot discard a completed map.
        try { await (await redis.getClient()).set('room:' + job.room_code + ':argumentMap', JSON.stringify(payload)); }
        catch (error) { console.error('Map cache:', error.message); }
      }
    } catch (error) {
      console.error('Argument map background job:', error.message);
      await pool.query("UPDATE argument_map_jobs SET status = 'failed', stage = 'Failed', error = $1, lease_until = NULL, updated_at = NOW() WHERE id = $2 AND status = 'running'", ['Unable to finish the job. Your original transcripts and previous map are preserved. Please retry.', job.id]);
    }
  }
}

function wakeWorker() {
  if (!working) {
    working = drain().catch(error => console.error('Map worker:', error.message)).finally(() => { working = null; });
  }
  return working;
}

function startWorker() {
  if (interval) return;
  void wakeWorker();
  interval = setInterval(wakeWorker, 2000);
  interval.unref();
}

module.exports = { enqueue, getJob, publicJob, wakeWorker, startWorker };
