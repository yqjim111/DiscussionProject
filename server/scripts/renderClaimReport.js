'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { claimReportHtml, claimReportMarkdown, supportMapSvg, claimMapsHtml } = require('../../lib/claimReportExport');
const { overallMapSvg } = require('../../lib/overallMapView');
const { zipFiles } = require('../../lib/reportExport');
const folder = path.resolve(process.argv[2]);
const report = JSON.parse(fs.readFileSync(path.join(folder, 'report.json'), 'utf8'));
report.mapVersion = crypto.createHash('sha256').update(JSON.stringify({ analysis: report.claimAnalysis, inputHash: report.inputHash })).digest('hex');
const files = { 'report.html': claimReportHtml(report), 'report.md': claimReportMarkdown(report), 'report.json': JSON.stringify(report, null, 2),
  'argument-map.svg': supportMapSvg(report), 'argument-maps.html': claimMapsHtml(report), 'overall-argument-map.svg': overallMapSvg(report) };
for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), value);
fs.writeFileSync(path.join(folder, 'discussion-report-' + report.room.code + '-v3.zip'), zipFiles(files));
console.log('Rendered updated report and complete public ZIP: ' + folder);
