'use strict';

const pool = require('../db/pool');
const redis = require('./redis');
const { analyzeArgumentMap } = require('./argumentMap');
const { finishReport } = require('./reportStore');
const { analysisText } = require('./manualPoints');
const { analyzeThematic } = require('./thematicAnalysis');
const { createAnalysisRequest } = require('./analysisRequest');
const { METHOD_VERSION } = require('./claimReportAnalysis');
let working = null;
let interval = null;

function publicJob(job) {
  return job ? { id: job.id, status: job.status, stage: job.stage, error: job.error, updated_at: job.updated_at, thematic_requested: Boolean(job.input?.thematicRequested) } : null;
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

async function requestReport(code, refreshSummary = false, needsThematic = false) {
  const { rows } = await pool.query(`UPDATE argument_map_jobs
    SET input = input || jsonb_build_object('reportRequested', true,
      'refreshSummary', COALESCE((input->>'refreshSummary')::boolean, false) OR $2::boolean,
      'thematicRequested', COALESCE((input->>'thematicRequested')::boolean, false) OR $3::boolean
        OR NOT COALESCE((input->>'reuseSavedMap')::boolean, false)), updated_at = NOW()
    WHERE room_code = $1 AND status IN ('queued', 'running') RETURNING *`, [code, refreshSummary, needsThematic]);
  return rows[0] || null;
}

async function requestThematic(code) {
  const { rows } = await pool.query(`UPDATE argument_map_jobs
    SET input = input || jsonb_build_object('thematicRequested', true), updated_at = NOW()
    WHERE room_code = $1 AND status IN ('queued', 'running') RETURNING *`, [code]);
  return rows[0] || null;
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
      const checkpoints = input.pipelineCheckpoints || {};
      const onCheckpoint = async saved => {
        await pool.query("UPDATE argument_map_jobs SET input = jsonb_set(input, '{pipelineCheckpoints}', $1::jsonb), lease_until = NOW() + INTERVAL '15 minutes', updated_at = NOW() WHERE id = $2 AND status = 'running'", [JSON.stringify(saved), job.id]);
      };
      const request = createAnalysisRequest({ checkpoints, onCheckpoint });
      const reuseGraph = input.reuseGraph || job.result;
      const canReuse = input.reuseSavedMap && reuseGraph?.generation?.method_version === METHOD_VERSION;
      const graph = canReuse ? reuseGraph : await analyzeArgumentMap({ ...input, request, onProgress: async stage => {
        await pool.query("UPDATE argument_map_jobs SET stage = $1, lease_until = NOW() + INTERVAL '15 minutes', updated_at = NOW() WHERE id = $2 AND status = 'running'", [stage, job.id]);
      } });
      const snapshot = { topic: input.topic || '', instructions: input.instructions || '' };
      let payload = canReuse ? graph : {
        ...graph, source_snapshot: { ...snapshot, groups: graph.source_groups || graph.cleaned_groups || input.groups }, groups: input.groups.map(g => ({ id: g.id, name: g.name, members: g.members || [] })),
        input: { ...graph.input, source: 'original_transcripts', generated_at: new Date().toISOString(), topic: input.topic, instructions: input.instructions,
          groups: input.groups.map(g => ({ id: g.id, name: g.name, characters: analysisText(g).length, transcript_characters: g.transcript.length, manual_characters: (g.manualPoints || []).reduce((sum, p) => sum + p.text.length, 0) })) }
      };
      if (!payload) throw new Error('Missing saved map');
      // Publish the shared graph before generating the report summary. Both
      // pages can read it even while the final summary is still running.
      const published = await pool.query(`UPDATE argument_map_jobs SET result = $1::jsonb,
        updated_at = NOW() WHERE id = $2 AND status = 'running' RETURNING room_code`, [JSON.stringify(payload), job.id]);
      if (published.rows.length) {
        // PostgreSQL is authoritative; a cache failure cannot discard a completed map.
        try { await (await redis.getClient()).set('room:' + job.room_code + ':argumentMap', JSON.stringify(payload)); }
        catch (error) { console.error('Map cache:', error.message); }
      }
      const simplified = payload.generation?.method_version?.startsWith('simple-argument-map-');
      let thematicHandled = Boolean(simplified);
      let reportHandled = Boolean(simplified);
      for (;;) {
        const latest = await getJob(job.room_code);
        if (!latest || latest.id !== job.id || latest.status !== 'running') break;
        if (latest.input.thematicRequested && !thematicHandled && payload.claim_analysis) thematicHandled = true;
        if (latest.input.thematicRequested && !thematicHandled) {
          const source = payload.source_snapshot || latest.input;
          const thematic = await analyzeThematic({ ...source, groups: payload.cleaned_groups || source.groups, request, onProgress: async stage => {
            await pool.query("UPDATE argument_map_jobs SET stage = $1, lease_until = NOW() + INTERVAL '15 minutes', updated_at = NOW() WHERE id = $2 AND status = 'running'", [stage, job.id]);
          } });
          payload = { ...payload, thematic_analysis: thematic };
          await pool.query("UPDATE argument_map_jobs SET result = $1::jsonb, updated_at = NOW() WHERE id = $2 AND status = 'running' RETURNING room_code", [JSON.stringify(payload), job.id]);
          try { await (await redis.getClient()).set('room:' + job.room_code + ':argumentMap', JSON.stringify(payload)); } catch (error) { console.error('Thematic cache:', error.message); }
          thematicHandled = true;
        }
        const requested = Boolean(latest.input.reportRequested);
        if (requested && !reportHandled) {
          await pool.query("UPDATE argument_map_jobs SET stage = $1, lease_until = NOW() + INTERVAL '15 minutes', updated_at = NOW() WHERE id = $2 AND status = 'running'", ['Preparing report summary', job.id]);
          await finishReport(job.room_code, payload, latest.input.refreshSummary, latest.input);
          reportHandled = true;
        }
        // A report request arriving after our read must be handled before this
        // job can finish. An arriving request after completion queues reuse.
        const completed = await pool.query(`UPDATE argument_map_jobs SET status = 'succeeded', stage = 'Complete',
          result = $1::jsonb, error = NULL, lease_until = NULL, updated_at = NOW()
          WHERE id = $2 AND status = 'running'
          AND (COALESCE((input->>'reportRequested')::boolean, false) = false OR $3::boolean)
          AND (COALESCE((input->>'thematicRequested')::boolean, false) = false OR $4::boolean)
          RETURNING room_code`, [JSON.stringify(payload), job.id, reportHandled, thematicHandled]);
        if (completed.rows.length) break;
      }
    } catch (error) {
      const latest = await getJob(job.room_code);
      const stage = error.analysis_stage || latest?.stage || 'analysis';
      console.error('Discussion analysis failed:', { stage, status: error.status || null, type: error.name });
      await pool.query("UPDATE argument_map_jobs SET status = 'failed', stage = $3, error = $1, lease_until = NULL, updated_at = NOW() WHERE id = $2 AND status = 'running'", ['Analysis stopped during ' + stage + '. Original transcripts, completed checkpoints and the previous valid map are preserved. Retry to resume.', job.id, 'Failed · ' + stage]);
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

module.exports = { enqueue, getJob, publicJob, requestReport, requestThematic, wakeWorker, startWorker };
