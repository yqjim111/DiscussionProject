'use strict';
const fs = require('fs');
const path = require('path');
const { object, text, strings } = require('./analysisRequest');
const { hasInappropriate } = require('./transcriptCensor');
const schema = object({ report_title: text, research_focus: text, sections: { type: 'array', items: object({ id: text, title: text, focus: text, questions: strings }) } });
function validatePlan(plan) {
  if (!plan.report_title.trim() || !plan.research_focus.trim() || !plan.sections.length) throw Error('No substantive discussion is available to organize into a report.');
  const ids = new Set(), titles = new Set();
  for (const section of plan.sections) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(section.id) || ids.has(section.id) || !section.title.trim() || titles.has(section.title.trim().toLowerCase()) || !section.focus.trim() || !section.questions.length || section.questions.some(q => !q.trim())) throw Error('Report sections need unique IDs, clear titles, boundaries and analytic questions.');
    ids.add(section.id); titles.add(section.title.trim().toLowerCase());
  }
  if (hasInappropriate(JSON.stringify(plan))) throw Error('Inappropriate text must not be reproduced in the analysis plan.');
}
async function discoverReportPlan(censored, { request, onProgress }) {
  await onProgress('Discovering discussion-specific report sections from all group transcripts');
  const groups = censored.map((r, i) => ({ group_key: 'G' + (i + 1), cleaned_transcript: r.analysisGroup.cleanedTranscript,
    typed_contributions: (r.analysisGroup.manualPoints || []).map(p => p.text) })).filter(g => g.cleaned_transcript?.trim() || g.typed_contributions.some(t => t?.trim()));
  if (!groups.length) throw Error('No transcripts or typed contributions are available for report generation.');
  return request('discussion_report_plan', schema, fs.readFileSync(path.join(__dirname, '../prompts/discussion_report_plan_prompt.txt'), 'utf8'), { groups }, validatePlan, 4500);
}
module.exports = { discoverReportPlan, validatePlan };
