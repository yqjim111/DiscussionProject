const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');

test('instruction formatting persists through create, update, reload and live broadcasts', async () => {
  let room;
  const poolPath = require.resolve('../db/pool');
  require.cache[poolPath] = { id: poolPath, filename: poolPath, loaded: true, exports: {
    query: async (sql, args) => {
      if (sql.startsWith('SELECT id FROM')) return { rows: [] };
      if (sql.startsWith('INSERT INTO rooms')) {
        assert.match(sql, /discussion_instructions_html/);
        room = { code: args[0], teacher_topic: args[1], discussion_instructions: args[2], discussion_instructions_html: args[5] };
      } else if (sql.startsWith('UPDATE rooms')) {
        assert.match(sql, /discussion_instructions_html = \$4/);
        room = { ...room, teacher_topic: args[0], discussion_instructions: args[1], discussion_instructions_html: args[3] };
      } else assert.match(sql, /SELECT .*discussion_instructions_html/);
      return { rows: [{ ...room }] };
    }
  } };
  const authPath = require.resolve('../services/instructorAuth');
  require.cache[authPath] = { id: authPath, filename: authPath, loaded: true, exports: { requireInstructor: (_req, _res, next) => next() } };
  const app = express(); app.use(express.json());
  const events = [];
  app.set('io', { to: code => ({ emit: (event, payload) => events.push({ code, event, payload }) }) });
  app.use('/rooms', require('../routes/rooms'));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/rooms`;
  const write = (url, method, body) => fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const html = '<ul><li><b style="color:red">Prompt</b><ul><li>Example</li></ul></li></ul>';
    const data = { instructor_name: 'Teacher', teacher_topic: 'Topic', discussion_instructions: 'Prompt\nExample', discussion_instructions_html: html };
    const created = await write(base, 'POST', data);
    assert.equal(created.status, 201);
    const first = (await created.json()).room;
    assert.equal(first.discussion_instructions_html, html);
    const url = `${base}/${first.code}`;
    const updated = await write(url, 'PATCH', { ...data, discussion_instructions_html: html.replace('red', 'blue') });
    assert.equal(updated.status, 200);
    const reloaded = (await (await fetch(url)).json()).room;
    assert.equal(reloaded.discussion_instructions_html, html.replace('red', 'blue'));
    assert.equal(reloaded.discussion_instructions, data.discussion_instructions);
    assert.equal(events.at(-1).payload.room.discussion_instructions_html, reloaded.discussion_instructions_html);
    assert.equal((await write(url, 'PATCH', { ...data, discussion_instructions_html: 'x'.repeat(100001) })).status, 400);
    // Older plain-text clients clear previous formatting instead of showing stale HTML.
    assert.equal((await write(url, 'PATCH', { teacher_topic: 'Topic', discussion_instructions: 'Plain' })).status, 200);
    assert.equal((await (await fetch(url)).json()).room.discussion_instructions_html, '');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
