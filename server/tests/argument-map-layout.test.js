'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cytoscape = require('cytoscape');
const { graphElements, graphStyles, layoutGraph, separateRectangles, wrapLabel, categoryFor, GAP } = require('../../lib/argumentMapView');

function assertSeparated(rectangles) {
  for (let i = 0; i < rectangles.length; i++) for (let j = i + 1; j < rectangles.length; j++) {
    const a = rectangles[i], b = rectangles[j];
    assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + GAP - 0.1 ||
      Math.abs(a.y - b.y) >= (a.height + b.height) / 2 + GAP - 0.1, `Overlapping nodes ${i}, ${j}`);
  }
}
test('collision repair separates fully overlapping, variable height cards without dropping any', () => {
  const input = Array.from({ length: 60 }, (_, i) => ({ id: String(i), x: 0, y: 0, width: 228, height: 78 + i % 5 * 45 }));
  const positions = separateRectangles(input);
  assert.equal(positions.length, input.length);
  assertSeparated(positions);
  assert.deepEqual(positions, separateRectangles(input));
});
test('real layout separates connected, isolated and long-label nodes; large-map packing also preserves gaps', () => {
  for (const count of [1, 35, 205]) {
    const graph = { nodes: Array.from({ length: count }, (_, i) => ({ node_id: 'N' + i,
      normalized_statement: i % 3 ? 'Short claim' : 'Long qualified statement with contextual details. '.repeat(7),
      topic_position: ['POSITIVE', 'NEGATIVE', 'OFF_TOPIC', 'NEUTRAL'][i % 4], sources: [] })),
      edges: Array.from({ length: Math.min(count - 1, 20) }, (_, i) => ({ edge_id: 'E' + i, source_node_id: 'N0', target_node_id: 'N' + (i + 1), relationship_type: 'SUPPORTS' })) };
    const cy = cytoscape({ headless: true, styleEnabled: true, elements: graphElements(graph), style: graphStyles, layout: { name: 'preset' } });
    layoutGraph(cy);
    assertSeparated(cy.nodes().map(n => ({ ...n.position(), width: n.outerWidth(), height: n.outerHeight() })));
    assert.equal(cy.nodes().length, count); cy.destroy();
  }
});
test('labels retain Unicode and unbroken words; colors depend on topic classification, with honest legacy fallback', () => {
  for (const text of ['中文观点，保留所有限定条件。'.repeat(10), 'W'.repeat(150), 'A statement with several conditions and supporting details.']) {
    const wrapped = wrapLabel(text);
    assert.equal(wrapped.label.replace(/\s/gu, ''), text.replace(/\s/gu, ''));
    assert.ok(wrapped.height >= wrapped.label.split('\n').length * 18 + 32);
  }
  assert.equal(categoryFor({ topic_position: 'NEGATIVE' }).fill, '#fee2e2');
  assert.equal(categoryFor({}).label, 'Not classified');
  assert.equal(new Set(['POSITIVE', 'NEGATIVE', 'OFF_TOPIC', 'NEUTRAL'].map(topic_position => categoryFor({ topic_position }).fill)).size, 4);
});
