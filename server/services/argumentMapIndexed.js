'use strict';
// Compatibility entry point: no mechanical sentence chunks or excerpt fallback.
const { indexSources } = require('./transcriptPreparation');
const { analyzeClaimReport } = require('./claimReportAnalysis');
async function analyzeArgumentMap(input) {
  if (input.workflow === 'simple-map') return require('./simpleArgumentAnalysis').analyzeSimpleArgumentMap(input);
  return analyzeClaimReport(input); // Compatibility for saved report tooling.
}
module.exports = { indexSources, analyzeArgumentMap };
