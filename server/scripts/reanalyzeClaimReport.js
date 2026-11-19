'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createAnalysisRequest } = require('../services/analysisRequest');
const { analyzeClaimReport } = require('../services/claimReportAnalysis');

async function main() {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node server/scripts/reanalyzeClaimReport.js source-session.json output-directory [previous-report.json]');
  const output = path.resolve(process.argv[3]); fs.mkdirSync(output, { recursive: true });
  const session = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const previous = process.argv[4] ? JSON.parse(fs.readFileSync(process.argv[4], 'utf8')) : null;
  const baseGraph = previous?.argumentMap;
  const prepared = baseGraph?.source_snapshot?.groups || previous?.groups;
  const groups = session.groups.map(group => {
    const saved = prepared?.find(g => g.id === group.id);
    return saved && saved.transcript === group.transcript ? { ...saved, members: group.members, manualPoints: group.manualPoints } : group;
  });
  const cachePath = path.join(output, 'checkpoints.private.json');
  const checkpoints = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  let writes = Promise.resolve();
  const save = (name, value) => {
    const content = JSON.stringify(value, null, 2);
    writes = writes.then(async () => {
      const target = path.join(output, name), temp = target + '.tmp'; fs.writeFileSync(temp, content);
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(temp, target); break; }
        catch (error) { if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 12) throw error; await new Promise(r => setTimeout(r, 25 * (attempt + 1))); }
      }
    }); return writes;
  };
  const onProgress = async stage => { console.log(new Date().toISOString() + ' ' + stage); await save('status.json', { status: 'running', stage }); };
  const request = createAnalysisRequest({ checkpoints, onCheckpoint: data => save('checkpoints.private.json', data) });
  const graph = await analyzeClaimReport({ groups, baseGraph, request, onProgress });
  graph.source_snapshot = { groups: graph.source_groups, topic: session.room.teacher_topic, instructions: session.room.discussion_instructions };
  await save('analysis.private.json', graph);
  const { reportFromMap } = require('../services/reportFromMap');
  const { claimReportHtml, claimReportMarkdown, supportMapSvg, claimMapsHtml } = require('../../lib/claimReportExport');
  const { zipFiles } = require('../../lib/reportExport');
  const { overallMapSvg } = require('../../lib/overallMapView');
  const report = reportFromMap(session, graph, graph.source_snapshot, null);
  report.generatedAt = new Date().toISOString(); report.importMetadata = session.import_metadata;
  const html = claimReportHtml(report), markdown = claimReportMarkdown(report), svg = supportMapSvg(report), maps = claimMapsHtml(report), overallSvg = overallMapSvg(report);
  await save('report.json', report);
  fs.writeFileSync(path.join(output, 'report.html'), html); fs.writeFileSync(path.join(output, 'report.md'), markdown);
  fs.writeFileSync(path.join(output, 'argument-map.svg'), svg); fs.writeFileSync(path.join(output, 'argument-maps.html'), maps);
  fs.writeFileSync(path.join(output, 'overall-argument-map.svg'), overallSvg);
  fs.writeFileSync(path.join(output, 'discussion-report-520123-v3.zip'), zipFiles({ 'report.html': html, 'report.md': markdown, 'report.json': JSON.stringify(report, null, 2), 'argument-map.svg': svg, 'argument-maps.html': maps, 'overall-argument-map.svg': overallSvg }));
  await save('status.json', { status: 'completed', claims: graph.nodes.filter(n => n.primary_type === 'CLAIM').length, evidence_links: graph.edges.length,
    themes: graph.claim_analysis.sections.reduce((n, s) => n + s.themes.length, 0) });
  console.log('Complete: ' + output);
}
main().catch(error => { console.error('Claim report stopped:', error.analysis_stage || '', error.status || '', error.message); process.exitCode = 1; });
