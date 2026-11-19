'use strict';
const fs = require('fs');
const path = require('path');
const { createAnalysisRequest, object, text, hash, mapGroups } = require('./analysisRequest');
const { originalQuote } = require('./argumentMap');
const CLEANUP_VERSION = 'whole-group-cleanup-v2';
const cleanupPrompt = fs.readFileSync(path.join(__dirname, '../prompts/transcript_cleanup_prompt.txt'), 'utf8');
const cleanupSchema = object({ cleaned_transcript: text,
  review_notes: { type: 'array', items: object({ original_excerpt: text, issue: text }) } });
const words = value => String(value).toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

function validateCleanup(result, original) {
  if (typeof result?.cleaned_transcript !== 'string' || !Array.isArray(result.review_notes)) throw new Error('Invalid cleanup output');
  const input = words(original); let cursor = 0;
  for (const word of words(result.cleaned_transcript)) {
    while (cursor < input.length && input[cursor] !== word) cursor++;
    if (cursor === input.length) throw new Error('Cleanup added or reordered wording near: ' + word);
    cursor++;
  }
  for (const note of result.review_notes) {
    const exact = originalQuote(original, note.original_excerpt);
    if (!exact || !note.issue?.trim()) throw new Error('Cleanup review note must quote the original exactly');
    note.original_excerpt = exact;
  }
}

async function prepareGroups(groups, { request = createAnalysisRequest(), onProgress = async () => {} } = {}) {
  return mapGroups(groups, async (group, i) => {
    const original = String(group.transcript || ''), sourceHash = hash(original);
    if (group.cleanup?.version === CLEANUP_VERSION && group.cleanup.source_hash === sourceHash && group.cleanup.status === 'completed') {
      validateCleanup({ cleaned_transcript: group.cleanedTranscript, review_notes: group.cleanup.review_notes }, original);
      return group;
    }
    if (!original.trim()) {
      return { ...group, cleanedTranscript: '', cleanup: { version: CLEANUP_VERSION, source_hash: sourceHash, status: 'completed', review_notes: [] } };
    }
    await onProgress('Cleaning full group transcript · ' + (i + 1) + '/' + groups.length + ' · ' + group.name);
    const input = { group_id: String(group.id), group_name: group.name, original_transcript: original };
    const candidate = await request('transcript_cleanup', cleanupSchema, cleanupPrompt, input, r => validateCleanup(r, original));
    await onProgress('Reviewing transcript cleanup · ' + group.name);
    const reviewed = await request('transcript_cleanup_review', cleanupSchema,
      cleanupPrompt + '\nREVIEW TASK: Compare the candidate with the COMPLETE original. Restore omitted substantive wording, uncertainty, task changes and the ending. Remove invented wording or speaker labels. IMPORTANT READABILITY CHECK: Original line breaks and periods may reflect recording boundaries rather than actual sentence or speaker boundaries. Reflow clearly connected adjacent fragments into readable paragraphs by adjusting punctuation and whitespace, preserving all retained words in order. Do not put every original fragment on its own paragraph. Do not merge distinct contributions or invent turn boundaries. Remove clearly empty fillers and immediate accidental repetitions as permitted above; do not restore them merely because they were in the original. Return the corrected full cleaned transcript and exact-quote review notes, not a summary or verdict.',
      { ...input, candidate }, r => validateCleanup(r, original));
    return { ...group, cleanedTranscript: reviewed.cleaned_transcript,
      cleanup: { version: CLEANUP_VERSION, source_hash: sourceHash, status: 'completed', review_notes: reviewed.review_notes } };
  });
}

// Whole original inputs are citation records, never sentence chunks.
function indexSources(groups) {
  const sources = [];
  for (const group of groups) {
    const inputs = [{ text: group.transcript || '', cleaned: group.cleanedTranscript, kind: 'transcript', id: null },
      ...(group.manualPoints || []).filter(p => p.text?.trim()).map(p => ({ text: p.text, cleaned: p.text, kind: 'manual', id: p.id }))];
    for (const input of inputs) {
      if (!input.text.trim()) continue;
      const comparable = input.text.replace(/\s+/gu, ' ').trim();
      const duplicate = sources.find(s => s.group_id === String(group.id) && s.original_quote.replace(/\s+/gu, ' ').trim() === comparable);
      sources.push({ source_id: 'Q' + (sources.length + 1), group_id: String(group.id), group_name: group.name,
        original_quote: input.text, cleaned_text: input.cleaned ?? input.text,
        source_kind: input.kind, contribution_id: input.id, duplicate_of: duplicate?.source_id || null });
    }
  }
  return sources;
}

function resolveQuote(quote, sources) {
  const source = sources.find(s => s.source_id === quote.source_id);
  const exact = source && originalQuote(source.original_quote, quote.original_quote);
  if (!exact) {
    const proposed = String(quote.original_quote), start = source?.original_quote.indexOf(proposed.slice(0, 24)) ?? -1;
    const context = source ? source.original_quote.slice(Math.max(0, start), Math.max(0, start) + Math.min(proposed.length + 160, 1600)) : '';
    throw new Error('Evidence must match original wording and punctuation from ' + quote.source_id + '. Invalid quote: ' + JSON.stringify(proposed) + '. Copy exact wording from this ORIGINAL context, or select shorter exact supporting excerpts without dropping the meaning: ' + JSON.stringify(context));
  }
  // Whitespace alone is restored mechanically; never fuzzy-match changed words.
  quote.original_quote = exact;
  return { group_id: source.group_id, speaker_id: null, timestamp: null, source_location: null,
    original_quote: quote.original_quote, source_kind: source.source_kind, contribution_id: source.contribution_id,
    source_id: source.source_id, original_start: source.original_quote.indexOf(quote.original_quote), duplicate_of: source.duplicate_of };
}
module.exports = { prepareGroups, indexSources, resolveQuote, validateCleanup, CLEANUP_VERSION };
