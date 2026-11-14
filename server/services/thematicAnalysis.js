'use strict';
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
const { indexSources } = require('./argumentMapIndexed');
const { textModelOptions, TEXT_MODEL } = require('./textModel');
const METHOD_VERSION = 'thematic-draft-v1';
const strings = { type: 'array', items: { type: 'string' } };
const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const text = { type: 'string' };
const codingSchema = object({ codes: { type: 'array', items: object({ label: text, meaning: text, source_ids: strings }) } });
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
  candidate.unassigned_code_ids.forEach(id => { if (!byCode.has(id)) throw new Error('Unknown unassigned code'); covered.add(id); });
  if (codes.some(c => !covered.has(c.code_id))) throw new Error('Meaningful codes must be themed or explicitly unassigned');
  for (const key of ['alternative_interpretations', 'limitations', 'review_questions']) if (!Array.isArray(candidate[key]) || candidate[key].some(s => typeof s !== 'string')) throw new Error('Invalid review notes');
  return { ...candidate, themes, axes, codes: codes.map(code => ({ ...code, ...evidence([code.code_id]) })) };
}

async function analyzeThematic({ topic, instructions, groups, onProgress = async () => {} }) {
  const sources = indexSources(groups);
  const base = { method_version: METHOD_VERSION, model: TEXT_MODEL, review_status: 'AI_DRAFT', generated_at: new Date().toISOString() };
  const empty = { codes: [], themes: [], axes: [], unassigned_code_ids: [], alternative_interpretations: [], limitations: [], review_questions: [] };
  if (!sources.length) return { ...base, ...empty, status: 'completed', limitations: ['No meaningful original contribution text is available.'] };
  if (!process.env.OPENAI_API_KEY) return { ...base, ...empty, status: 'unavailable', warning: 'The AI API key is not configured. The saved Argument Map is unchanged.' };
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 90000, maxRetries: 1 });
  async function request(name, schema, system, data, validate) {
    const messages = [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(data) }];
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await client.chat.completions.create({ ...textModelOptions(16000), temperature: 0,
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }, messages });
      const choice = response.choices[0];
      try {
        if (choice?.finish_reason !== 'stop' || choice.message.refusal || !choice.message.content) throw new Error('Incomplete thematic output');
        const result = JSON.parse(choice.message.content); validate(result); return result;
      } catch (error) {
        if (attempt === 1) throw error;
        if (choice?.message?.content) messages.push({ role: 'assistant', content: choice.message.content });
        messages.push({ role: 'user', content: 'Validation failed: ' + error.message + '. Correct the complete result using only supplied IDs; an empty axes array is valid. Never invent evidence or omit codes to evade checks.' });
      }
    }
  }
  try {
    // Batches cover ALL indexed raw/typed sources. No group, minority contribution
    // or tail of a long transcript is discarded to fit a fixed theme count.
    const batches = []; let batch = [], size = 0;
    for (const source of sources) {
      const length = JSON.stringify(source).length;
      if (size + length > 24000 && batch.length) { batches.push(batch); batch = []; size = 0; }
      batch.push(source); size += length;
    }
    if (batch.length) batches.push(batch);
    const codes = [];
    for (let i = 0; i < batches.length; i++) {
      await onProgress('Thematic coding · batch ' + (i + 1) + '/' + batches.length);
      const available = new Map(batches[i].map(s => [s.source_id, s]));
      const result = await request('thematic_codes', codingSchema, prompt('coding'), { teacher_topic: topic, discussion_instructions: instructions, original_sources: batches[i] }, result => {
        if (!Array.isArray(result.codes)) throw new Error('Missing codes');
        for (const code of result.codes) { if (!code.label?.trim() || !code.meaning?.trim()) throw new Error('Empty code'); select(code.source_ids, available, 'source'); }
      });
      for (const code of result.codes) codes.push({ ...code, source_ids: [...new Set(code.source_ids)], code_id: 'C' + (codes.length + 1) });
    }
    if (!codes.length) return { ...base, ...empty, status: 'completed', limitations: ['No substantive codable meanings were identified; review the original contributions.'] };
    const used = new Set(codes.flatMap(c => c.source_ids));
    const data = { teacher_topic: topic, discussion_instructions: instructions, codes, original_sources: sources.filter(s => used.has(s.source_id)) };
    await onProgress('Developing themes and supported two-pole axes');
    const candidate = await request('thematic_synthesis', synthesisSchema, prompt('synthesis'), data, result => materializeAnalysis(result, codes, sources));
    await onProgress('Reviewing themes, minority evidence and axis poles');
    const reviewed = await request('thematic_review', synthesisSchema, prompt('review'), { ...data, candidate }, result => materializeAnalysis(result, codes, sources));
    return { ...base, ...materializeAnalysis(reviewed, codes, sources), status: 'completed', input: { source_count: sources.length, groups: [...new Set(sources.map(s => s.group_id))] } };
  } catch (error) {
    console.warn('Thematic analysis:', error.status || error.message);
    return { ...base, ...empty, status: 'unavailable', warning: 'Thematic analysis could not complete or pass evidence checks. Retry this analysis; the saved Argument Map and original contributions are preserved.' };
  }
}
module.exports = { analyzeThematic, materializeAnalysis, METHOD_VERSION };
