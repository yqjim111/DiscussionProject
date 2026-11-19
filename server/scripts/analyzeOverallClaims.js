'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createAnalysisRequest } = require('../services/analysisRequest');
const { analyzeOverallRelations } = require('../services/overallClaimRelations');
async function main() {
  const folder = path.resolve(process.argv[2]);
  const reportPath = path.join(folder, 'report.json');
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const cache = path.join(folder, 'overall-checkpoints.private.json');
  const checkpoints = fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : {};
  const request = createAnalysisRequest({ checkpoints, onCheckpoint: async value => fs.writeFileSync(cache, JSON.stringify(value, null, 2)) });
  report.claimAnalysis.overall_map = await analyzeOverallRelations(report.claimAnalysis.sections, { request, onProgress: async stage => console.log(stage) });
  const { METHOD_VERSION } = require('../services/claimReportAnalysis');
  report.claimAnalysis.method_version = METHOD_VERSION;
  report.argumentMap.generation.method_version = METHOD_VERSION;
  report.argumentMap.claim_analysis = report.claimAnalysis;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log('Overall analysis complete: ' + report.claimAnalysis.overall_map.node_ids.length + ' nodes, ' + report.claimAnalysis.overall_map.edges.length + ' reviewed relationships.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
