'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readTimer, transitionTimer, formatTimer } = require('../../lib/discussionTimer');

test('countdown survives elapsed wall time and reopening, with exact pause/resume instead of interval drift', () => {
  const started = transitionTimer(null, 'start', 60, 1000);
  assert.equal(readTimer(started, 11000).remainingMs, 50000);
  const paused = transitionTimer(started, 'pause', undefined, 11345);
  assert.equal(paused.remainingMs, 49655);
  assert.equal(readTimer(paused, 500000).remainingMs, 49655);
  const resumed = transitionTimer(paused, 'resume', undefined, 600000);
  assert.equal(resumed.endsAt, 649655);
  const reopened = readTimer(JSON.parse(JSON.stringify(resumed)), 620000);
  assert.equal(reopened.remainingMs, 29655);
  assert.equal(formatTimer(reopened.remainingMs), '00:30');
  assert.deepEqual(readTimer(resumed, 649656), { status: 'finished', durationSeconds: 60, remainingMs: 0, endsAt: null });
});
test('editing duration can restart immediately, reset stops the clock, and invalid input cannot corrupt it', () => {
  const original = transitionTimer(null, 'start', 600, 1000);
  const restarted = transitionTimer(original, 'start', 45, 9000);
  assert.equal(restarted.endsAt, 54000);
  const reset = transitionTimer(restarted, 'reset', 120, 10000);
  assert.equal(reset.status, 'idle'); assert.equal(reset.remainingMs, 120000); assert.equal(reset.endsAt, null);
  for (const seconds of [0, -1, NaN, Infinity, '15', Number.MAX_SAFE_INTEGER]) assert.throws(() => transitionTimer(null, 'start', seconds, 1000));
  assert.throws(() => transitionTimer(reset, 'resume', undefined, 10000), /paused/);
  assert.equal(formatTimer(3661000), '01:01:01');
  assert.equal(formatTimer(-1000), '00:00');
});
