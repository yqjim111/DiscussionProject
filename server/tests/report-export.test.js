'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { renderMapSvg, reportMarkdown, zipFiles } = require('../../lib/reportExport');

test('large vector exports include all nodes, edges and full text; ZIP opens with a standard independent reader', () => {
  const positions = ['POSITIVE', 'NEGATIVE', 'OFF_TOPIC', 'NEUTRAL'];
  const graph = { nodes: Array.from({ length: 305 }, (_, i) => ({
    node_id: 'N' + i, normalized_statement: 'å®Œæ•´åŽŸæ–‡ <script> & quoted "idea" ' + i + ' ' + 'A qualified statement. '.repeat(i % 4),
    topic_position: positions[i % 4], sources: [{ group_id: 'g1', original_quote: 'åŽŸæ–‡' }],
  })), edges: Array.from({ length: 100 }, (_, i) => ({
    edge_id: 'E' + i, source_node_id: 'N' + i, target_node_id: 'N' + (i + 1), relationship_type: i % 2 ? 'SUPPORTS' : 'SIMILAR_TO',
  })) };
  const report = { room: { code: '123456', teacher_topic: 'Topic', discussion_instructions: 'Instructions' },
    groups: [{ id: 'g1', name: 'ç»„ä¸€', members: ['A', 'B'], transcript: 'Original first chunk.\nSecond chunk.\r\nç¬¬ä¸‰æ®µã€‚' }],
    argumentMap: graph, overallSummary: 'High-level summary', contentAnalysis: { statements: graph.nodes.map(n => ({ statement: n.normalized_statement, sources: n.sources })) },
  };
  const svg = renderMapSvg(graph), markdown = reportMarkdown(report);
  assert.doesNotMatch(svg, /<script>|<image|<foreignObject|onclick=/i);
  assert.doesNotMatch(markdown, /Argument Relationships|Graph Evidence|Reference proposition/);
  assert.match(markdown, /Original first chunk\. Second chunk\. ç¬¬ä¸‰æ®µã€‚/);
  const archive = zipFiles({ 'report.md': markdown, 'argument-map.svg': svg });
  const parsed = spawnSync('python', ['-c', `
import sys,io,zipfile,json,xml.etree.ElementTree as E
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
root=E.fromstring(z.read('argument-map.svg'))
nodes=[n for n in root.iter() if 'data-node-id' in n.attrib]
edges=[n for n in root.iter() if 'data-edge-id' in n.attrib]
x,y,w,h=map(float,root.attrib['viewBox'].split())
for node in nodes:
 r=node.find('{http://www.w3.org/2000/svg}rect')
 assert float(r.attrib['x']) >= x and float(r.attrib['y']) >= y
 assert float(r.attrib['x'])+float(r.attrib['width']) <= x+w+.1
 assert float(r.attrib['y'])+float(r.attrib['height']) <= y+h+.1
print(json.dumps({'files':z.namelist(),'nodes':len(nodes),'edges':len(edges),'text':[''.join(n.itertext()) for n in nodes]},ensure_ascii=True))
`], { input: archive, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 });
  assert.equal(parsed.status, 0, parsed.stderr);
  const result = JSON.parse(parsed.stdout);
  assert.deepEqual(result.files, ['report.md', 'argument-map.svg']);
  assert.equal(result.nodes, 305); assert.equal(result.edges, 100);
  for (let i = 0; i < graph.nodes.length; i++) assert.equal(result.text[i].replace(/\s/gu, ''), graph.nodes[i].normalized_statement.replace(/\s/gu, ''));
});
