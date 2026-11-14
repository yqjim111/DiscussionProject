'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { renderMapSvg, reportMarkdown, zipFiles } = require('../../lib/reportExport');

test('Markdown preserves page section order, emphasis, multiline fields and concise theme/axis descriptions', () => {
  const source = { source_id: 'Q1', group_id: 'g1', group_name: 'One', source_kind: 'manual', original_quote: 'Keep authorship.' };
  const evidence = { code_ids: ['C1'], group_ids: ['g1'], sources: [source] };
  const thematic = { status: 'completed', codes: [{ code_id: 'C1', label: 'Retain authorship', meaning: 'Students remain authors', sources: [source] }],
    themes: [{ ...evidence, theme_id: 'T1', name: 'Meaningful authorship', central_concept: 'Agency', definition: 'A contextual pattern', inclusion: 'Authorship', exclusion: 'Tool speed alone', qualifications: 'Conditional', development: 'CANDIDATE', topic_relevance: 'ON_TOPIC' }],
    axes: [{ axis_id: 'A1', name: 'Delegation', dimension: 'Extent of delegation', relationship: 'CONTINUUM', left_pole: { ...evidence, label: 'Assistance', definition: 'Student authors' }, right_pole: { ...evidence, label: 'Replacement', definition: 'Tool authors' }, rationale: 'Contextual contrast', qualifications: 'Intermediate cases matter' }],
    unassigned_code_ids: ['C1'], alternative_interpretations: ['Different task stages'], limitations: ['Review required'], review_questions: ['Does context support the contrast?'] };
  const report = { room: { code: '123456', teacher_topic: 'Topic', discussion_instructions: 'First task\nSecond task', created_at: '2026-11-14T12:00:00Z' },
    groups: [{ id: 'g1', name: 'One', members: ['A'], transcript: 'Spoken first.\nSpoken second.', manualPoints: [{ id: 'p1', text: 'First typed line\nSecond typed line' }] }],
    contentAnalysis: { statements: [{ statement: 'Keep authorship.', sources: [source] }] },
    argumentMap: { nodes: [{ normalized_statement: 'Keep authorship.', topic_position: 'NEUTRAL', sources: [source] }], edges: [] },
    overallSummary: '<script>not executable</script>', thematicAnalysis: thematic,
  };
  const markdown = reportMarkdown(report);
  const headings = ['## Session Information', '## 1. Overall Summary', '## 2. Content Analysis', '## 3. Argument Map', '## Thematic Analysis', '## 4. Original Transcripts'];
  assert.deepEqual(headings.map(h => markdown.indexOf(h)), headings.map(h => markdown.indexOf(h)).sort((a, b) => a - b));
  assert.match(markdown, /First task  \nSecond task/);
  assert.match(markdown, /\*\*Statement 1\.\*\*/);
  assert.match(markdown, /Assistance ↔ Replacement/);
  assert.match(markdown, /\*\*Meaningful authorship\*\*/);
  assert.match(markdown, /A contextual pattern/);
  assert.match(markdown, /Student authors Tool authors/);
  assert.doesNotMatch(markdown, /Central concept|Supporting original evidence|Alternative interpretations|Questions for instructor review|AI-assisted draft/);
  assert.match(markdown, /First typed line  \n  Second typed line/);
  assert.doesNotMatch(markdown, /<script>/);
});

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
