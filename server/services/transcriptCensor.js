'use strict';
const fs = require('fs');
const path = require('path');
const { object, text, mapGroups, hash } = require('./analysisRequest');
const { originalQuote } = require('./argumentMap');
const INAPPROPRIATE = /\b(?:retard(?:ed|s)?|fuck(?:ing|ed|s)?|bullshit|shit(?:ty|ting)?|bitch(?:es)?|asshole(?:s)?|motherfuck\w*|goddamn|damn(?:ed)?)\b/giu;
const schema = object({ redactions: { type: 'array', items: object({ field: { type: 'string', enum: ['original', 'cleaned', 'manual'] }, contribution_id: { type: ['string', 'null'] }, original_quote: text, reason: text }) } });
const prompt = fs.readFileSync(path.join(__dirname, '../prompts/transcript_censor_prompt.txt'), 'utf8');
const hasInappropriate = value => new RegExp(INAPPROPRIATE.source, INAPPROPRIATE.flags).test(String(value || ''));
const oneParagraph = value => String(value || '').replace(/\s+/gu, ' ').trim();

function sentenceRange(text, start, end) {
  while (start > 0 && !/[.!?。！？]/u.test(text[start - 1])) start--;
  while (end < text.length && !/[.!?。！？]/u.test(text[end])) end++;
  if (end < text.length) end++;
  return [start, end];
}
function censorText(text, deletions = []) {
  text = String(text || ''); const ranges = [];
  for (const quote of deletions) {
    const exact = originalQuote(text, quote);
    if (!exact) throw new Error('Censor deletion is not an exact source passage');
    let start = text.indexOf(exact);
    while (start >= 0) { ranges.push(sentenceRange(text, start, start + exact.length)); start = text.indexOf(exact, start + exact.length); }
  }
  for (const match of text.matchAll(new RegExp(INAPPROPRIATE.source, INAPPROPRIATE.flags))) ranges.push(sentenceRange(text, match.index, match.index + match[0].length));
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) { const last = merged.at(-1); if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push([...range]); }
  let result = '', cursor = 0;
  for (const [start, end] of merged) { result += text.slice(cursor, start) + '\n'; cursor = end; }
  result += text.slice(cursor);
  return { text: result.replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim(), removed_count: merged.length, ranges: merged };
}

async function censorGroups(groups, { request, onProgress = async () => {} }) {
  return mapGroups(groups, async (group, i) => {
    await onProgress('Removing inappropriate transcription content · ' + (i + 1) + '/' + groups.length);
    const data = { original: group.transcript || '', cleaned: group.cleanedTranscript || '', manual: (group.manualPoints || []).map(p => ({ contribution_id: p.id, text: p.text })) };
    const fields = item => item.field === 'original' ? data.original : item.field === 'cleaned' ? data.cleaned : data.manual.find(p => p.contribution_id === item.contribution_id)?.text;
    const result = (data.original || data.cleaned || data.manual.length) ? await request('transcript_censor', schema, prompt, data, result => {
      for (const item of result.redactions) { const exact = originalQuote(fields(item) || '', item.original_quote); if (!exact) throw new Error('Censor span must match its specified field exactly'); item.original_quote = exact; }
    }, 4000) : { redactions: [] };
    const remove = (field, value, id = null) => censorText(value, result.redactions.filter(r => r.field === field && r.contribution_id === id).map(r => r.original_quote));
    const original = remove('original', data.original), cleaned = remove('cleaned', data.cleaned);
    const manualPoints = (group.manualPoints || []).map(p => ({ ...p, text: remove('manual', p.text, p.id).text }));
    const analysisGroup = { ...group, transcript: original.text, cleanedTranscript: cleaned.text, manualPoints,
      cleanup: { ...group.cleanup, review_notes: [] }, censor: { version: 'censored-v1', original_removed: original.removed_count, cleaned_removed: cleaned.removed_count, raw_hash: hash(group.transcript) } };
    const publicGroup = { id: group.id, name: group.name, members: group.members || [], transcript: oneParagraph(original.text), cleanedTranscript: cleaned.text,
      manualPoints, cleanup: { status: 'completed', review_notes: [] }, censor: analysisGroup.censor };
    if (hasInappropriate(JSON.stringify(publicGroup))) throw new Error('Inappropriate text remains in a public transcript');
    return { analysisGroup, publicGroup, privateGroup: group };
  });
}
module.exports = { censorGroups, censorText, oneParagraph, hasInappropriate };
