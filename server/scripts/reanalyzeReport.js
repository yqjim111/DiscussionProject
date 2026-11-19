'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createAnalysisRequest } = require('../services/analysisRequest');
const { prepareGroups } = require('../services/transcriptPreparation');
const { analyzeDiscussion } = require('../services/discussionAnalysis');
const { analyzeThematic } = require('../services/thematicAnalysis');
const { summarizeMap } = require('../services/reportSummary');
const { reportFromMap } = require('../services/reportFromMap');
const { renderMapSvg, reportMarkdown, reportHtml, zipFiles } = require('../../lib/reportExport');

async function main() {
  const input = process.argv[2];
  if (!input || !process.argv[3]) throw new Error('Usage: node server/scripts/reanalyzeReport.js input.json output-directory [--prepare-only|--content-only|--thematic-only]');
  const output = path.resolve(process.argv[3]);
  fs.mkdirSync(output, { recursive: true });
  const session = JSON.parse(fs.readFileSync(input, 'utf8'));
  const cachePath = path.join(output, 'checkpoints.json');
  const checkpoints = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};
  if (fs.existsSync(cachePath + '.tmp')) {
    try { Object.assign(checkpoints, JSON.parse(fs.readFileSync(cachePath + '.tmp', 'utf8'))); } catch { /* Keep the last complete checkpoint. */ }
  }
  let writes = Promise.resolve();
  const save = (name, data) => {
    const serialized = JSON.stringify(data, null, 2);
    writes = writes.then(async () => {
      const target = path.join(output, name), temp = target + '.tmp';
      fs.writeFileSync(temp, serialized);
      // Windows file watchers can briefly lock a destination during replacement.
      for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(temp, target); return; }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 12) throw error;
          await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
        }
      }
    });
    return writes;
  };
  const onProgress = async stage => { console.log(new Date().toISOString() + ' ' + stage); await save('status.json', { status: 'running', stage }); };
  const onCheckpoint = async data => save('checkpoints.json', data);
  const request = createAnalysisRequest({ checkpoints, onCheckpoint });
  const groups = await prepareGroups(session.groups, { request, onProgress });
  await save('prepared-session.json', { ...session, groups });
  if (process.argv.includes('--prepare-only')) { console.log('Whole-group cleanup complete.'); return; }
  if (process.argv.includes('--thematic-only')) {
    const thematic = await analyzeThematic({ groups, request, onProgress });
    await save('thematic-analysis.json', thematic);
    await save('status.json', { status: 'completed', themes: thematic.themes.length });
    return;
  }
  const analyzeGraph = () => analyzeDiscussion({ groups, request, onProgress }).then(async graph => {
    graph.source_snapshot = { groups: graph.cleaned_groups, topic: session.room.teacher_topic, instructions: session.room.discussion_instructions };
    graph.input = { source: 'whole_group_cleaned_transcripts', generated_at: new Date().toISOString() };
    await save('argument-map.json', graph); return graph;
  });
  if (process.argv.includes('--content-only')) {
    const graph = await analyzeGraph();
    await save('status.json', { status: 'completed', nodes: graph.nodes.length, edges: graph.edges.length });
    return;
  }
  // Once all complete groups are cleaned, these are independent analytic branches.
  // Settle both so an error in one never discards the other's completed work.
  const outcomes = await Promise.allSettled([
    analyzeGraph(),
    analyzeThematic({ groups, request, onProgress }).then(async thematic => { await save('thematic-analysis.json', thematic); return thematic; }),
  ]);
  const failed = outcomes.find(item => item.status === 'rejected');
  if (failed) throw failed.reason;
  const graph = outcomes[0].value;
  graph.thematic_analysis = outcomes[1].value;
  await save('argument-map.json', graph);
  const report = reportFromMap(session, graph, graph.source_snapshot, null);
  report.overallSummary = await summarizeMap(report.room, graph.nodes, { request, thematic: graph.thematic_analysis });
  report.generatedAt = new Date().toISOString();
  report.importMetadata = session.import_metadata;
  await save('report.json', report);
  const svg = renderMapSvg(graph), markdown = reportMarkdown(report), html = reportHtml(report, svg);
  fs.writeFileSync(path.join(output, 'argument-map.svg'), svg);
  fs.writeFileSync(path.join(output, 'report.md'), markdown);
  fs.writeFileSync(path.join(output, 'report.html'), html);
  fs.writeFileSync(path.join(output, 'discussion-report-520123-v2.zip'), zipFiles({ 'report.md': markdown, 'report.html': html, 'argument-map.svg': svg, 'report.json': JSON.stringify(report, null, 2) }));
  await save('status.json', { status: 'completed', groups: groups.length, nodes: graph.nodes.length, edges: graph.edges.length, themes: graph.thematic_analysis.themes.length });
  const failurePath = path.join(output, 'failure.json');
  if (fs.existsSync(failurePath)) fs.unlinkSync(failurePath);
  console.log('Complete: ' + output);
}
main().catch(error => {
  console.error('Analysis stopped:', error.status || '', error.message);
  if (process.argv[3]) fs.writeFileSync(path.join(path.resolve(process.argv[3]), 'failure.json'), JSON.stringify({ status: 'failed', error: error.message, http_status: error.status || null }, null, 2));
  process.exitCode = 1;
});
