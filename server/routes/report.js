'use strict';
const router = require('express').Router();
const redis = require('../services/redis');
const jobs = require('../services/argumentMapJobs');
const { requireInstructor } = require('../services/instructorAuth');
const { reportFromMap } = require('../services/reportFromMap');
const { readSession } = require('../services/reportStore');

async function readReport(code) {
  const current = await readSession(code);
  if (!current) return null;
  const client = await redis.getClient();
  const job = await jobs.getJob(code);
  const [cachedMap, savedReport] = await Promise.all([client.get('room:' + code + ':argumentMap'), client.get('room:' + code + ':reportSnapshot')]);
  const saved = savedReport ? JSON.parse(savedReport) : null;
  // Same authoritative graph as the Argument Map page; never run extraction here.
  const graph = job?.result || (cachedMap ? JSON.parse(cachedMap) : null) || saved?.argumentMap || null;
  const sourceInput = graph?.source_snapshot || (job?.status === 'succeeded' ? job.input : null) ||
    (graph && graph === saved?.argumentMap && saved.groups ? {
      topic: saved.room?.teacher_topic, instructions: saved.room?.discussion_instructions, groups: saved.groups,
    } : null);
  return { ...reportFromMap(current, graph, sourceInput, saved),
    job: jobs.publicJob(job),
    reportPending: Boolean(job?.input?.reportRequested && ['queued', 'running'].includes(job.status)),
    reportError: job?.input?.reportRequested && job.status === 'failed' ? job.error : '',
  };
}
router.use('/:code/report', requireInstructor, (req, res, next) => {
  if (!/^\d{6}$/.test(req.params.code)) return res.status(400).json({ error: 'Invalid room code' });
  next();
});
router.get('/:code/report', async (req, res) => {
  try {
    const report = await readReport(req.params.code);
    if (!report) return res.status(404).json({ error: 'Room not found' });
    res.set('Cache-Control', 'no-store'); res.json(report);
  } catch (error) {
    console.error('GET report:', error.message);
    res.status(500).json({ error: 'Unable to load report data.' });
  }
});
router.post('/:code/report/generate', async (req, res) => {
  try {
    // Retry if a job finishes between reading it and attaching the report intent.
    // This prevents two simultaneous page requests from spawning two analyses.
    for (let attempt = 0; attempt < 3; attempt++) {
      const report = await readReport(req.params.code);
      if (!report) return res.status(404).json({ error: 'Room not found' });
      const refreshSummary = req.body?.refreshSummary === true;
      const needsThematic = report.thematicAnalysis?.status !== 'completed';
      if (report.overallSummary && !needsThematic && !refreshSummary && !report.reportPending && !['queued', 'running'].includes(report.job?.status)) {
        return res.json(report);
      }
      let job;
      if (['queued', 'running'].includes(report.job?.status)) {
        job = await jobs.requestReport(req.params.code, refreshSummary, needsThematic);
        if (!job) continue;
      } else {
        const source = report.argumentMap?.source_snapshot || {
          topic: report.room.teacher_topic || '', instructions: report.room.discussion_instructions || '', groups: report.groups,
        };
        job = await jobs.enqueue(req.params.code, { ...source,
          reportRequested: true, refreshSummary, thematicRequested: needsThematic,
          reuseSavedMap: Boolean(report.argumentMap), reuseGraph: report.argumentMap,
        });
        // enqueue may have joined a map job started concurrently from the map page.
        job = await jobs.requestReport(req.params.code, refreshSummary, needsThematic);
        if (!job) continue;
      }
      res.set('Cache-Control', 'no-store');
      res.status(202).json({ ...report, job: jobs.publicJob(job), reportPending: true, reportError: '' });
      setImmediate(() => { void jobs.wakeWorker(); });
      return;
    }
    res.status(409).json({ error: 'Generation state changed. Please try again.' });
  } catch (error) {
    console.error('POST report:', error.message);
    res.status(500).json({ error: 'Unable to queue report generation. Saved maps and transcripts are preserved.' });
  }
});
module.exports = router;
