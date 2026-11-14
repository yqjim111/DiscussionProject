'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const calls = [];
let responses = [];
class FakeOpenAI {
  constructor() {
    this.chat = { completions: { create: async input => {
      assert.equal(input.model, 'gpt-6-luna');
      assert.equal(input.reasoning_effort, 'none');
      assert.equal('max_tokens' in input, false);
      assert.ok(input.max_completion_tokens > 0);
      calls.push(structuredClone(input));
      if (!input.response_format) return { choices: [{ message: { content: '• A high-level classroom theme.' } }] };
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ statements: responses.shift() || [] }) } }] };
    } } };
  }
}
const openaiPath = require.resolve('openai');
require.cache[openaiPath] = { id: openaiPath, filename: openaiPath, loaded: true, exports: { OpenAI: FakeOpenAI } };
const { summarizeTranscript, synthesizeAllSummaries } = require('../services/summarize');
const { contextTail, transcriptionOptions } = require('../services/transcription');

test('group content analysis uses original words and contextual topic, with no fixed bullet count or stance classification', async () => {
  responses = [['AI can help generate ideas.', 'AI answers can be inaccurate.', 'How can answers be verified?']];
  const transcript = 'AI helps with ideas. But answers can be wrong. How do we verify them?';
  const result = await summarizeTranscript(transcript, { topic: 'AI in design', instructions: 'Consider examples' });
  assert.equal(result, '• AI can help generate ideas.\n• AI answers can be inaccurate.\n• How can answers be verified?');
  assert.deepEqual(JSON.parse(calls.at(-1).messages[1].content), { topic: 'AI in design', instructions: 'Consider examples', original_transcript: transcript });
  assert.equal(calls.at(-1).response_format.json_schema.name, 'group_content_analysis');
  assert.match(calls.at(-1).messages[0].content, /do not force a fixed bullet count/i);
  assert.match(calls.at(-1).messages[0].content, /Do not force FOR\/AGAINST labels/);
});

test('a generic overall wrap-up is rejected and re-extracted as direct statements', async () => {
  const before = calls.length;
  responses = [
    ['Overall, the group acknowledged both the benefits and constraints of AI.'],
    ['AI can assist with ideation.', 'AI may produce inaccurate answers.']
  ];
  const result = await summarizeTranscript('AI helps with ideation, but its answers can be inaccurate.');
  assert.equal(calls.length - before, 2);
  assert.doesNotMatch(result, /Overall|the group/i);
  assert.match(result, /AI can assist with ideation/);
});

test('short substantive input is not discarded or padded; an empty extraction returns no synthetic summary', async () => {
  responses = [['AI makes mistakes.']];
  assert.equal(await summarizeTranscript('AI makes mistakes.'), '• AI makes mistakes.');
  responses = [[]];
  assert.equal(await summarizeTranscript('uh, um, okay'), null);
});

test('overall classroom synthesis also uses Luna and preserves its text output contract', async () => {
  const result = await synthesizeAllSummaries([{ groupName: 'One', summary: '• An original group point.' }]);
  assert.equal(result, '• A high-level classroom theme.');
  assert.equal(calls.at(-1).max_completion_tokens, 2048);
  assert.match(calls.at(-1).messages[1].content, /An original group point/);
});

test('recognition context is a bounded suffix of original speech, and language can be automatic', () => {
  const original = 'A long introduction. '.repeat(100) + 'Previous original speech about design.';
  const tail = contextTail(original);
  assert.ok(Buffer.byteLength(tail, 'utf8') <= 224);
  assert.ok(original.replace(/\s+/g, ' ').trim().endsWith(tail));
  assert.match(tail, /Previous original speech about design/);
  assert.ok(Buffer.byteLength(contextTail('中文原始发言'.repeat(100)), 'utf8') <= 224);
  const oldLanguage = process.env.TRANSCRIPTION_LANGUAGE;
  const oldModel = process.env.TRANSCRIPTION_MODEL;
  try {
    delete process.env.TRANSCRIPTION_MODEL;
    process.env.TRANSCRIPTION_LANGUAGE = 'en';
    assert.equal(transcriptionOptions('audio-file', original).model, 'whisper-1');
    assert.equal(transcriptionOptions('audio-file', original).language, 'en');
    assert.equal(transcriptionOptions('audio-file', original).prompt, tail);
    process.env.TRANSCRIPTION_LANGUAGE = 'auto';
    assert.equal('language' in transcriptionOptions('audio-file', original), false);
    assert.equal('prompt' in transcriptionOptions('audio-file', ''), false);
  } finally {
    if (oldLanguage === undefined) delete process.env.TRANSCRIPTION_LANGUAGE; else process.env.TRANSCRIPTION_LANGUAGE = oldLanguage;
    if (oldModel === undefined) delete process.env.TRANSCRIPTION_MODEL; else process.env.TRANSCRIPTION_MODEL = oldModel;
  }
});

test('transcript UI displays old chunk line breaks as a continuous paragraph without changing stored input', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const ts = require('typescript');
  const { renderToStaticMarkup } = require('react-dom/server');
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../components/Transcript.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require });
  const original = 'First sentence.\n\nSecond sentence.\nThird sentence.';
  const output = renderToStaticMarkup(require('react').createElement(module.exports.default, { text: original }));
  assert.match(output, />First sentence\. Second sentence\. Third sentence\.<\/div>/);
  assert.equal(original, 'First sentence.\n\nSecond sentence.\nThird sentence.');
});
