'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');

// Exercise the actual recorder component with a deterministic MediaRecorder and
// microphone; no audio leaves the machine and no browser permissions are needed.
function recorderHarness(transcribe) {
  const timers = new Map();
  const instances = [];
  const cleanup = [];
  let timerId = 0;
  let trackStopped = false;
  const stream = { getTracks: () => [{ stop: () => { trackStopped = true; } }] };
  class MediaRecorder {
    static isTypeSupported() { return true; }
    constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; instances.push(this); }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => { this.ondataavailable({ data: new Blob(['complete audio segment']) }); this.onstop(); });
    }
  }
  const react = {
    forwardRef: render => render,
    useState: value => [value, () => {}],
    useRef: value => ({ current: value }),
    useEffect: effect => { const dispose = effect(); if (dispose) cleanup.push(dispose); },
    useImperativeHandle: (ref, makeHandle) => { ref.current = makeHandle(); },
  };
  const jsx = (type, props) => ({ type, props });
  const module = { exports: {} };
  const source = fs.readFileSync(require('node:path').join(__dirname, '../../components/MicRecorder.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(compiled, {
    module, exports: module.exports,
    require: id => {
      if (id === 'react') return react;
      if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx };
      if (id === '@/lib/api') return { transcribeAudio: transcribe };
      throw new Error('Unexpected import ' + id);
    },
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    window: { addEventListener() {}, removeEventListener() {} },
    MediaRecorder, Blob, FormData, crypto,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
  });
  const ref = {};
  const tree = module.exports.default({ groupId: 'group-test' }, ref);
  return {
    ref, instances, timers,
    start: () => tree.props.children[0].props.onClick(),
    tick: () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.callback(); },
    trackStopped: () => trackStopped,
    dispose: () => cleanup.forEach(fn => fn()),
  };
}
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };

test('uploads complete four-second segments while still recording; flush saves final partial audio before leaving', async () => {
  const uploads = [];
  const h = recorderHarness(async form => { uploads.push(form); return { transcript: 'speech' }; });
  h.start(); await settle();
  assert.equal(h.timers.values().next().value.delay, 4000);
  h.tick(); await settle();
  assert.equal(uploads.length, 1);
  assert.equal(h.instances.length, 2);
  assert.equal(h.instances[1].state, 'recording');
  assert.equal(h.trackStopped(), false);
  await h.ref.current.flush(true);
  assert.equal(uploads.length, 2);
  assert.equal(h.trackStopped(), true);
  assert.notEqual(uploads[0].get('chunkId'), uploads[1].get('chunkId'));
  h.dispose();
});

test('Generate AI Summary can flush saved input while the microphone continues recording', async () => {
  let uploads = 0;
  const h = recorderHarness(async () => { uploads++; return { transcript: 'speech' }; });
  h.start(); await settle();
  await h.ref.current.flush();
  assert.equal(uploads, 1);
  assert.equal(h.instances.at(-1).state, 'recording');
  assert.equal(h.trackStopped(), false);
  await h.ref.current.flush(true); h.dispose();
});

test('failed final upload blocks leaving and retries with the same chunk ID', async () => {
  const ids = [];
  let online = false;
  const h = recorderHarness(async form => {
    ids.push(form.get('chunkId'));
    if (!online) throw new Error('offline');
    return { transcript: 'saved' };
  });
  h.start(); await settle();
  await assert.rejects(h.ref.current.flush(true), /offline/);
  online = true;
  await h.ref.current.flush(true);
  assert.ok(ids.length >= 3);
  assert.equal(new Set(ids).size, 1);
  h.dispose();
});
