'use strict';
const fs = require('fs');
const path = require('path');
const { createAnalysisRequest, mapGroups } = require('./analysisRequest');
const { prepareGroups, indexSources, resolveQuote } = require('./transcriptPreparation');
const { TEXT_MODEL } = require('./textModel');
const METHOD_VERSION = 'cleaned-thematic-v2';
const strings = { type: 'array', items: { type: 'string' } };
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const text = { type: 'string' };
const codingSchema = object({ codes: { type: 'array', items: object({ label: text, meaning: text, quotes: { type: 'array', items: object({ source_id: text, original_quote: text }) } }) } });
const pole = object({ label: text, definition: text, code_ids: strings });
const synthesisSchema = object({
  themes: { type: 'array', items: object({ theme_id: text, name: text, central_concept: text, definition: text, inclusion: text, exclusion: text, qualifications: text, topic_relevance: { type: 'string', enum: ['ON_TOPIC', 'OFF_TOPIC', 'MIXED'] }, code_ids: strings }) },
  axes: { type: 'array', items: object({ axis_id: text, name: text, dimension: text, relationship: { type: 'string', enum: ['CONTINUUM', 'TENSION'] }, left_pole: pole, right_pole: pole, theme_ids: strings, rationale: text, qualifications: text }) },
  unassigned_code_ids: strings, alternative_interpretations: strings, limitations: strings, review_questions: strings,
});
const prompt = name => fs.readFileSync(path.join(__dirname, '../prompts/thematic_' + name + '_prompt.txt'), 'utf8');

function select(ids, records, kind) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('Missing ' + kind + ' references');
  return [...new Set(ids)].map(id => { const item = records.get(id); if (!item) throw new Error('Unknown ' + kind + ' ID ' + id); return item; });
}
function materializeAnalysis(candidate, codes, sources) {
  if (!Array.isArray(candidate?.themes) || !Array.isArray(candidate.axes)) throw new Error('Invalid thematic structure');
  const byCode = new Map(codes.map(c => [c.code_id, c])), bySource = new Map(sources.map(s => [s.source_id, s]));
  const evidence = ids => {
    const records = select(ids, byCode, 'code');
    const sourceIds = [...new Set(records.flatMap(c => c.source_ids))];
    const quotes = select(sourceIds, bySource, 'source');
    return { code_ids: records.map(c => c.code_id), sources: quotes, group_ids: [...new Set(quotes.map(s => s.group_id))] };
  };
  const themeIds = new Set(), axisIds = new Set(), covered = new Set();
  const themes = candidate.themes.map(theme => {
    if (!theme.theme_id || themeIds.has(theme.theme_id) || !theme.name?.trim() || !theme.central_concept?.trim() || !theme.definition?.trim()) throw new Error('Invalid or duplicate theme');
    themeIds.add(theme.theme_id);
    const linked = evidence(theme.code_ids); linked.code_ids.forEach(id => covered.add(id));
    return { ...theme, ...linked, development: linked.code_ids.length < 2 ? 'CANDIDATE' : 'DEVELOPING_PATTERN' };
  });
  const axes = candidate.axes.map(axis => {
    if (!axis.axis_id || axisIds.has(axis.axis_id) || !axis.name?.trim() || !axis.dimension?.trim() || !axis.rationale?.trim() || !['CONTINUUM', 'TENSION'].includes(axis.relationship)) throw new Error('Invalid axis');
    axisIds.add(axis.axis_id);
    if (!Array.isArray(axis.theme_ids) || !axis.theme_ids.length || axis.theme_ids.some(id => !themeIds.has(id))) throw new Error('Unknown axis theme');
    if (!axis.left_pole?.label?.trim() || !axis.right_pole?.label?.trim() || !axis.left_pole.definition?.trim() || !axis.right_pole.definition?.trim() || axis.left_pole.label.trim().toLowerCase() === axis.right_pole.label.trim().toLowerCase()) throw new Error('Axis poles need distinct labels and definitions');
    const left = evidence(axis.left_pole.code_ids), right = evidence(axis.right_pole.code_ids);
    if (!left.code_ids.some(id => !right.code_ids.includes(id)) || !right.code_ids.some(id => !left.code_ids.includes(id))) throw new Error('Each pole needs distinct supporting codes; do not invent a binary');
    return { ...axis, left_pole: { ...axis.left_pole, ...left }, right_pole: { ...axis.right_pole, ...right } };
  });
  if (!Array.isArray(candidate.unassigned_code_ids)) throw new Error('Missing code coverage');
  // Coverage is bookkeeping, not an interpretive model decision. Compute the
  // actual set difference so no minority code disappears and invented inventory
  // IDs cannot become evidence. Theme/axis evidence IDs above remain strict.
  candidate.unassigned_code_ids = codes.filter(c => !covered.has(c.code_id)).map(c => c.code_id);
  for (const key of ['alternative_interpretations', 'limitations', 'review_questions']) if (!Array.isArray(candidate[key]) || candidate[key].some(s => typeof s !== 'string')) throw new Error('Invalid review notes');
  return { ...candidate, themes, axes, coverage_method: 'server_set_difference', codes: codes.map(code => ({ ...code, ...evidence([code.code_id]) })) };
}

async function analyzeThematic({ groups, onProgress = async () => {}, checkpoints, onCheckpoint, request: suppliedRequest }) {
  const request = suppliedRequest || createAnalysisRequest({ checkpoints, onCheckpoint });
  const prepared = await prepareGroups(groups, { request, onProgress });
  const originals = indexSources(prepared), sources = [], codes = [];
  const base = { method_version: METHOD_VERSION, model: TEXT_MODEL, review_status: 'AI_DRAFT', generated_at: new Date().toISOString() };
  const empty = { codes: [], themes: [], axes: [], unassigned_code_ids: [], alternative_interpretations: [], limitations: [], review_questions: [] };
  const codedGroups = await mapGroups(prepared, async (group, i) => {
    const available = originals.filter(s => s.group_id === String(group.id));
    if (!available.length) return null;
    await onProgress('Thematic coding of complete group · ' + (i + 1) + '/' + prepared.length + ' · ' + group.name);
    const data = { group_id: String(group.id), cleaned_transcript: group.cleanedTranscript, original_sources: available };
    const validate = result => {
      if (!Array.isArray(result?.codes)) throw new Error('Missing codes');
      for (const code of result.codes) {
        if (!code.label?.trim() || !code.meaning?.trim() || !code.quotes?.length) throw new Error('Every code needs meaning and exact evidence');
        code.quotes.forEach(q => resolveQuote(q, available));
      }
    };
    const result = await request('thematic_codes', codingSchema, prompt('coding'), data, validate);
    return { group, available, result };
  });
  for (const { group, available, result } of codedGroups.filter(Boolean)) {
    for (const code of result.codes) {
      const sourceIds = [];
      for (const quote of code.quotes) {
        const resolved = resolveQuote(quote, available);
        let record = sources.find(s => s.group_id === resolved.group_id && s.original_quote === resolved.original_quote && s.source_kind === resolved.source_kind);
        if (!record) { record = { ...resolved, source_id: 'TQ' + (sources.length + 1), group_name: group.name }; sources.push(record); }
        sourceIds.push(record.source_id);
      }
      codes.push({ code_id: 'C' + (codes.length + 1), label: code.label, meaning: code.meaning, source_ids: [...new Set(sourceIds)] });
    }
  }
  if (!codes.length) return { ...base, ...empty, status: 'completed', limitations: ['No substantive codable meanings were identified.'] };
  // Synthesis gets the complete codebook with selected original evidence, not
  // thousands of mechanical fragments or another copy of every full transcript.
  const data = { codes, original_sources: sources };
  await onProgress('Developing evidence-grounded themes across all groups');
  const candidate = await request('thematic_synthesis', synthesisSchema, prompt('synthesis'), data, r => materializeAnalysis(r, codes, sources), 24000);
  await onProgress('Reviewing themes, conditions and negative cases');
  const reviewed = await request('thematic_review', synthesisSchema, prompt('review'), { ...data, candidate }, r => materializeAnalysis(r, codes, sources), 24000);
  return { ...base, ...materializeAnalysis(reviewed, codes, sources), status: 'completed', input: { source_count: sources.length, groups: prepared.map(g => String(g.id)) } };
}

module.exports = { analyzeThematic, materializeAnalysis, METHOD_VERSION };
