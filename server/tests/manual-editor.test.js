'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const { effectiveSummary } = require('../services/manualPoints');

// Run the real editor hooks and event handlers; writes are delayed/failable to
// exercise drafts, refresh and edits made while another save is in flight.
function harness(save, storage = new Map(), initial = { id: crypto.randomUUID(), name: 'Test group', members: ['A'], summary: '• Original AI point.', aiSummary: '• Original AI point.', manualPoints: [] }) {
  const slots = [], effects = [], timers = new Map(); let cursor = 0, changed = false, timerId = 0, group = initial;
  const localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const react = {
    forwardRef: fn => fn,
    useState: value => { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value;
      return [slots[index], next => { const result = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(result, slots[index])) { slots[index] = result; changed = true; } }]; },
    useRef: value => { const index = cursor++; return slots[index] ||= { current: value }; },
    useEffect: (fn, deps) => { const index = cursor++; const old = slots[index];
      if (!old || !deps || deps.some((d, i) => !Object.is(d, old.deps[i]))) { effects.push(() => { old?.dispose?.(); slots[index] = { deps, dispose: fn() }; }); } },
    useImperativeHandle: (ref, make) => { ref.current = make(); },
  };
  const jsx = (type, props) => ({ type, props }); const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../../components/EditableSummary.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, crypto, localStorage, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id),
    require: id => id === 'react' ? react : id === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : id === '@/lib/api' ? { saveManualPoint: save } : (() => { throw new Error(id); })() });
  const ref = {}; let tree;
  function render() { for (let i = 0; i < 8; i++) { changed = false; cursor = 0;
    tree = module.exports.default({ group, isEditable: true, onSaved: result => { group = { ...group, ...result }; changed = true; } }, ref);
    effects.splice(0).forEach(fn => fn()); if (!changed) break;
  } return tree; }
  function elements(type) { const result = []; function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node?.props) return; if (node.type === type) result.push(node); visit(node.props.children); } visit(render()); return result; }
  return { ref, storage, render, group: () => group, fields: () => elements('textarea'),
    add: () => elements('button').find(b => b.props.children === '+ Add bullet point').props.onClick(),
    edit: (index, value) => { const node = elements('textarea')[index]; node.props.onChange({ target: { value, style: {}, scrollHeight: 100 } }); render(); },
    remove: index => elements('button').filter(b => b.props['aria-label'] === 'Delete bullet')[index].props.onClick(),
  };
}
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

test('typed edits save without a character cap, survive refresh and never overwrite another saved bullet', async () => {
  const notes = new Map(); const writes = [];
  const save = async (_id, point) => { writes.push(structuredClone(point)); notes.set(point.id, structuredClone(point)); return { manualPoints: [...notes.values()], aiSummary: '• Original AI point.', summary: effectiveSummary('• Original AI point.', [...notes.values()]) }; };
  const h = harness(save); h.render(); h.add();
  const text = 'Long original student viewpoint. '.repeat(5000);
  h.edit(1, text); await h.ref.current.flush(); h.render();
  assert.equal(writes[0].text, text);
  assert.equal(h.storage.size, 0, 'Saved drafts need not remain only in the browser');
  const reopened = harness(save, h.storage, h.group()); reopened.render();
  assert.ok(reopened.fields().some(f => f.props.value === text));
  reopened.edit(0, 'Student correction of the AI point.'); await reopened.ref.current.flush(); reopened.render();
  assert.equal(writes.at(-1).replacesText, 'Original AI point.');
  assert.equal(notes.size, 2);
  assert.equal(reopened.fields().length, 2);
  reopened.remove(1); await reopened.ref.current.flush(); reopened.render();
  const afterDelete = harness(save, reopened.storage, reopened.group()); afterDelete.render();
  assert.equal(afterDelete.fields().length, 1, 'A deleted/replaced AI point must stay hidden after reload');
});

test('a failed save keeps the full draft, restores it after refresh and retries successfully', async () => {
  let failing = true; let saved;
  const save = async (_id, point) => { if (failing) throw new Error('Offline'); saved = structuredClone(point); return { manualPoints: [saved], aiSummary: '', summary: '• ' + point.text }; };
  const h = harness(save, new Map(), { id: crypto.randomUUID(), name: 'Group', members: [], summary: '', aiSummary: '', manualPoints: [] }); h.render(); h.add(); h.edit(0, 'Keep my original text.');
  await assert.rejects(h.ref.current.flush(), /Offline/);
  assert.ok([...h.storage.values()][0].includes('Keep my original text.'));
  failing = false;
  const reopened = harness(save, h.storage, h.group()); reopened.render(); await settle(); reopened.render();
  assert.equal(saved.text, 'Keep my original text.'); assert.equal(reopened.storage.size, 0);
  assert.equal(reopened.fields()[0].props.value, saved.text);
});
