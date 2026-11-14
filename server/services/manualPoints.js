'use strict';
const pool = require('../db/pool');
async function getManualPoints(groupId) {
  const { rows } = await pool.query('SELECT id, text, replaces_text AS "replacesText" FROM group_notes WHERE group_id = $1 ORDER BY created_at, id', [groupId]);
  return rows;
}
function effectiveSummary(aiSummary, points) {
  const replaced = new Set(points.flatMap(p => [p.replacesText, p.text.trim()]).filter(Boolean));
  const ai = String(aiSummary || '').split('\n').map(s => s.replace(/^[•\-*]\s*/, '').trim()).filter(s => s && !replaced.has(s));
  return [...ai, ...points.filter(p => p.text.trim()).map(p => p.text)].map(s => '• ' + s).join('\n');
}
function analysisText(group) {
  return [group.transcript || '', ...(group.manualPoints || []).map(p => p.text)].filter(Boolean).join('\n');
}
module.exports = { getManualPoints, effectiveSummary, analysisText };
