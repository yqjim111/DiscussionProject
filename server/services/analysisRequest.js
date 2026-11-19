'use strict';

const crypto = require('crypto');
const { OpenAI } = require('openai');
const { textModelOptions, TEXT_MODEL } = require('./textModel');

const object = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const text = { type: 'string' };
const strings = { type: 'array', items: text };
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function mapGroups(items, operation, concurrency = 2) {
  const results = new Array(items.length); let next = 0, failure;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await operation(items[index], index); }
      catch (error) { failure ||= error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

// A checkpoint is reusable only for the same model, prompt, schema and input.
// Failed/incomplete requests never become cached successful analysis.
function createAnalysisRequest({ checkpoints = {}, onCheckpoint = async () => {}, client } = {}) {
  let checkpointWrite = Promise.resolve();
  return async function request(name, schema, system, data, validate = () => {}, maxTokens = 16000) {
    const key = hash({ name, model: TEXT_MODEL, system, schema, data });
    if (checkpoints[key]) {
      try { validate(checkpoints[key].result); return structuredClone(checkpoints[key].result); }
      catch { delete checkpoints[key]; }
    }
    // After a validator correction, a saved complete response can be rechecked
    // without paying to generate the same candidate again. It must now pass all checks.
    for (let attempt = 2; attempt >= 0; attempt--) {
      const diagnostic = checkpoints[key + ':attempt:' + attempt];
      if (diagnostic?.finish_reason !== 'stop' || !diagnostic.invalid_output) continue;
      try {
        const result = JSON.parse(diagnostic.invalid_output); validate(result);
        checkpoints[key] = { name, result: structuredClone(result), model: TEXT_MODEL, usage: diagnostic.usage, finish_reason: 'stop', revalidated: true };
      } catch { continue; }
      const snapshot = structuredClone(checkpoints);
      checkpointWrite = checkpointWrite.then(() => onCheckpoint(snapshot));
      await checkpointWrite;
      return structuredClone(checkpoints[key].result);
    }
    if (!client && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured; no analysis was generated.');
    const api = client || new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 180000, maxRetries: 1 });
    const messages = [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(data) }];
    let outputBudget = maxTokens;
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = Date.now();
      // Transport errors propagate to the job. Retrying the job reuses successful checkpoints.
      let response;
      try {
        response = await api.chat.completions.create({ ...textModelOptions(outputBudget), temperature: 0,
          response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } }, messages });
      } catch (error) { error.analysis_stage = name; throw error; }
      const choice = response.choices?.[0];
      let result;
      try {
        if (choice?.finish_reason !== 'stop' || choice.message?.refusal || !choice.message?.content) {
          throw new Error('Incomplete output (finish_reason=' + choice?.finish_reason + ')');
        }
        result = JSON.parse(choice.message.content);
        validate(result);
      } catch (error) {
        checkpoints[key + ':attempt:' + attempt] = { name, validation_error: error.message, invalid_output: choice?.message?.content || null,
          duration_ms: Date.now() - started, finish_reason: choice?.finish_reason || null, usage: response.usage || null };
        const diagnosticSnapshot = structuredClone(checkpoints);
        checkpointWrite = checkpointWrite.then(() => onCheckpoint(diagnosticSnapshot));
        await checkpointWrite;
        if (attempt === 2) throw Object.assign(new Error(name + ': ' + error.message), { analysis_stage: name });
        if (choice?.finish_reason === 'length') outputBudget = Math.min(outputBudget * 2, 64000);
        if (choice?.message?.content && choice.finish_reason === 'stop') messages.push({ role: 'assistant', content: choice.message.content });
        messages.push({ role: 'user', content: 'The previous output failed validation: ' + error.message + '. Return the complete corrected result. Preserve all substantive evidence; do not omit records to evade validation.' });
        continue;
      }
      checkpoints[key] = { name, result: structuredClone(result), model: TEXT_MODEL,
        duration_ms: Date.now() - started, usage: response.usage || null, finish_reason: choice.finish_reason };
      const snapshot = structuredClone(checkpoints);
      checkpointWrite = checkpointWrite.then(() => onCheckpoint(snapshot));
      await checkpointWrite;
      return result;
    }
  };
}

module.exports = { createAnalysisRequest, object, text, strings, hash, mapGroups };
