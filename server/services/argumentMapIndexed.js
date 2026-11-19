'use strict';
// Compatibility entry point: no mechanical sentence chunks or excerpt fallback.
const { indexSources } = require('./transcriptPreparation');
const { analyzeClaimReport } = require('./claimReportAnalysis');
module.exports = { indexSources, analyzeArgumentMap: analyzeClaimReport };
