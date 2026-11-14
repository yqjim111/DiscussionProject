const cytoscape = require('cytoscape');
const { graphElements, graphStyles, layoutGraph, categories } = require('./argumentMapView');

const xml = value => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const number = value => Number(value).toFixed(2);

// A full vector document, with real text, not a viewport screenshot or canvas
// raster. Every node and edge is included regardless of current zoom/filter.
function svgFromCy(cy) {
  const nodes = cy.nodes();
  if (!nodes.length) return '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100" viewBox="0 0 600 100"><text x="20" y="50" font-family="Helvetica,Arial,sans-serif">No statements in this map.</text></svg>';
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  nodes.forEach(n => {
    const p = n.position();
    left = Math.min(left, p.x - n.outerWidth() / 2); right = Math.max(right, p.x + n.outerWidth() / 2);
    top = Math.min(top, p.y - n.outerHeight() / 2); bottom = Math.max(bottom, p.y + n.outerHeight() / 2);
  });
  const width = Math.max(760, right - left + 80), height = bottom - top + 150;
  const output = [`<svg xmlns="http://www.w3.org/2000/svg" width="${number(width)}" height="${number(height)}" viewBox="${number(left - 40)} ${number(top - 110)} ${number(width)} ${number(height)}" role="img" aria-label="Complete Argument Map">`,
    '<rect x="' + number(left - 40) + '" y="' + number(top - 110) + '" width="100%" height="100%" fill="white"/>',
    '<defs><marker id="arrow" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L8,4 L0,8 Z" fill="#8893a3"/></marker></defs>',
    '<g font-family="Helvetica,Arial,sans-serif" fill="#243244">'];
  Object.values(categories).forEach((c, i) => {
    const x = left + (i % 2) * 350, y = top - 85 + Math.floor(i / 2) * 24;
    output.push(`<rect x="${number(x)}" y="${number(y - 11)}" width="13" height="13" rx="3" fill="${c.fill}" stroke="${c.border}"/><text x="${number(x + 20)}" y="${number(y)}" font-size="12">${xml(c.label)}</text>`);
  });
  function boundary(node, toward) {
    const p = node.position(), dx = toward.x - p.x, dy = toward.y - p.y;
    const ratio = Math.min(dx ? (node.outerWidth() / 2 + 2) / Math.abs(dx) : Infinity, dy ? (node.outerHeight() / 2 + 2) / Math.abs(dy) : Infinity, 0.49);
    return { x: p.x + dx * ratio, y: p.y + dy * ratio };
  }
  cy.edges().forEach(edge => {
    const a = boundary(edge.source(), edge.target().position()), b = boundary(edge.target(), edge.source().position());
    const similar = edge.data('relationship_type') === 'SIMILAR_TO';
    let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
    if (angle > 90 || angle < -90) angle += 180;
    const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
    output.push(`<g data-edge-id="${xml(edge.id())}"><path d="M${number(a.x)},${number(a.y)} L${number(b.x)},${number(b.y)}" fill="none" stroke="#8893a3" stroke-width="1.6" ${similar ? 'stroke-dasharray="6 4"' : 'marker-end="url(#arrow)"'}/><text x="${number(x)}" y="${number(y)}" transform="rotate(${number(angle)} ${number(x)} ${number(y)})" text-anchor="middle" dy="-5" font-size="9" stroke="white" stroke-width="4" paint-order="stroke">${xml(edge.data('label'))}</text></g>`);
  });
  nodes.forEach(node => {
    const p = node.position(), w = node.data('width'), h = node.data('height');
    const lines = node.data('label').split('\n'), firstY = p.y - (lines.length - 1) * 9;
    output.push(`<g data-node-id="${xml(node.id())}"><rect x="${number(p.x - w / 2)}" y="${number(p.y - h / 2)}" width="${number(w)}" height="${number(h)}" rx="9" fill="${xml(node.data('fill'))}" stroke="${xml(node.data('border'))}" stroke-width="1.5"/><text text-anchor="middle" dominant-baseline="central" font-size="12">`);
    lines.forEach((line, i) => output.push(`<tspan x="${number(p.x)}" y="${number(firstY + i * 18)}">${xml(line)}</tspan>`));
    output.push('</text></g>');
  });
  output.push('</g></svg>'); return output.join('');
}
function renderMapSvg(graph) {
  const cy = cytoscape({ headless: true, styleEnabled: true, elements: graphElements(graph), style: graphStyles, layout: { name: 'preset' } });
  try { layoutGraph(cy); return svgFromCy(cy); } finally { cy.destroy(); }
}
const md = text => String(text ?? '').replace(/\s+/gu, ' ').trim().replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
function reportMarkdown(report) {
  const sources = list => [...new Set(list.map(s => report.groups.find(g => g.id === s.group_id)?.name || s.group_id || 'Unknown group'))].map(md).join(', ');
  const multiline = value => String(value ?? '').split(/\r?\n/).map(md).join('  \n');
  const lines = ['ClassDiscuss · Session Report', '', '# Classroom Discussion Report', '',
    `**Room:** ${md(report.room.code)}`, '',
    ...(report.room.created_at ? [`**Date:** ${new Date(report.room.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, ''] : []),
    ...(report.generatedAt ? [`**Report snapshot:** ${new Date(report.generatedAt).toLocaleString('en-US')}`, ''] : []),
    '## Session Information', '', `**Instructor:** ${md(report.room.instructor_name || 'Not provided')}`, '',
    `**Discussion Topic:** ${multiline(report.room.teacher_topic)}`, '', `**Questions / Instructions:** ${multiline(report.room.discussion_instructions)}`, '',
    `**Groups:** ${report.groups.map(g => md(g.name)).join(', ') || 'No groups recorded'}`, '',
    '## 1. Overall Summary', '', report.overallSummary ? multiline(report.overallSummary) : 'Not generated.', '',
    '## 2. Content Analysis', '',
    ...(report.contentAnalysis?.statements || []).map((s, i) => `${i + 1}. **Statement ${i + 1}.** ${md(s.statement)} **(${sources(s.sources)})**`), '',
    '## 3. Argument Map', '',
    ...Object.entries(categories).flatMap(([key, category]) => [
      `### ${category.label}`, '',
      ...((report.argumentMap?.nodes || []).some(n => n.topic_position === key)
        ? report.argumentMap.nodes.filter(n => n.topic_position === key).map(n => `- ${md(n.normalized_statement)} (${sources(n.sources)})`)
        : ['*No statements in this category.*']), '',
    ]),
    ...(report.argumentMap?.generation?.warning ? [md(report.argumentMap.generation.warning), ''] : []),
    `${report.argumentMap?.nodes.length || 0} nodes · ${report.argumentMap?.edges.length || 0} relationships`, '',
    '![Complete saved Argument Map](argument-map.svg)', '',
    ...thematicMarkdown(report.thematicAnalysis || report.argumentMap?.thematic_analysis),
    '## 4. Original Transcripts', '',
  ];
  report.groups.forEach((g, i) => lines.push(`### Group ${i + 1}: ${md(g.name)}`, '', `Members: ${(g.members || []).map(md).join(', ') || 'Not provided'}`, '', md(g.transcript) || 'No transcription recorded for this group.', '', ...(g.manualPoints?.some(p => p.text.trim()) ? ['**Student-written Contributions**', '', ...g.manualPoints.filter(p => p.text.trim()).map(p => '- ' + multiline(p.text).replace(/\n/g, '\n  ')), ''] : [])));
  return lines.join('\n');
}

function thematicMarkdown(analysis) {
  const lines = ['## Thematic Analysis', ''];
  if (!analysis) return [...lines, 'Thematic analysis has not been generated for this saved discussion.', ''];
  lines.push('AI-assisted draft · Review themes and both axis poles against the original evidence. Axes describe interpretive contrasts, not scores or groups of students.', '');
  if (analysis.warning) lines.push(md(analysis.warning), '');
  if (analysis.status !== 'completed') return lines;
  const byCode = new Map(analysis.codes.map(c => [c.code_id, c]));
  function quotes(items) {
    for (const s of items || []) lines.push(`> **${md(s.group_name || s.group_id)} · ${s.source_kind === 'manual' ? 'Student-written point' : 'Original transcription'}**`, '>', ...String(s.original_quote).split(/\r?\n/).map(line => '> ' + md(line)), '');
  }
  lines.push('### Themes', '');
  if (!analysis.themes.length) lines.push('No defensible theme pattern was identified in this input.', '');
  for (const theme of analysis.themes) {
    lines.push(`#### ${md(theme.name)}`, '', `${theme.development === 'CANDIDATE' ? 'Tentative candidate' : 'Developing pattern'} · ${md(theme.topic_relevance.replace(/_/g, ' '))} · ${theme.group_ids.length} source groups`, '',
      `**Central concept:** ${md(theme.central_concept)}`, '', md(theme.definition), '', `**Includes:** ${md(theme.inclusion)}`, '', `**Excludes:** ${md(theme.exclusion)}`, '');
    if (theme.qualifications) lines.push(`**Qualifications:** ${md(theme.qualifications)}`, '');
    lines.push('**Codes and original evidence**', '');
    for (const id of theme.code_ids) lines.push(`- **${md(byCode.get(id)?.label)}:** ${md(byCode.get(id)?.meaning)}`);
    lines.push(''); quotes(theme.sources);
  }
  lines.push('### Axes · Two Poles', '');
  if (!analysis.axes.length) lines.push('No two-pole axis is supported by this discussion. A missing opposite is not invented.', '');
  for (const axis of analysis.axes) {
    lines.push(`#### ${md(axis.name)}`, '', `**Dimension:** ${md(axis.dimension)} · ${axis.relationship === 'TENSION' ? 'Coexisting priorities / tension' : 'Continuum'}`, '',
      `**${md(axis.left_pole.label)} ↔ ${md(axis.right_pole.label)}**`, '');
    for (const pole of [axis.left_pole, axis.right_pole]) { lines.push(`##### ${md(pole.label)}`, '', md(pole.definition), '', '**Supporting original evidence**', ''); quotes(pole.sources); }
    lines.push(`**Why this axis:** ${md(axis.rationale)}`, '');
    if (axis.qualifications) lines.push(`**Intermediate / both-and positions:** ${md(axis.qualifications)}`, '');
  }
  if (analysis.unassigned_code_ids.length) { lines.push('### Unassigned meanings / minority observations', ''); for (const id of analysis.unassigned_code_ids) { const code = byCode.get(id); lines.push(`**${md(code?.label)}:** ${md(code?.meaning)}`, ''); quotes(code?.sources); } }
  for (const [key, label] of [['alternative_interpretations', 'Alternative interpretations'], ['limitations', 'Limitations'], ['review_questions', 'Questions for instructor review']]) if (analysis[key]?.length) lines.push('### ' + label, '', ...analysis[key].map(s => '- ' + md(s)), '');
  return lines;
}

// Standard UTF-8 ZIP (STORE). No image recompression, raster size limit, remote
// service or extra package is needed. ZIP readers verify each file via CRC-32.
const crcTable = Array.from({ length: 256 }, (_, i) => {
  let c = i; for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
});
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipFiles(files) {
  const encoder = new TextEncoder(), chunks = [], directory = []; let offset = 0, directorySize = 0;
  const header = size => { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; };
  for (const [filename, content] of Object.entries(files)) {
    const name = encoder.encode(filename), data = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(data), local = header(30), central = header(46);
    local.view.setUint32(0, 0x04034b50, true); local.view.setUint16(4, 20, true); local.view.setUint16(6, 0x800, true);
    local.view.setUint16(12, 33, true); local.view.setUint32(14, crc, true);
    local.view.setUint32(18, data.length, true); local.view.setUint32(22, data.length, true); local.view.setUint16(26, name.length, true);
    central.view.setUint32(0, 0x02014b50, true); central.view.setUint16(4, 20, true); central.view.setUint16(6, 20, true); central.view.setUint16(8, 0x800, true);
    central.view.setUint16(14, 33, true); central.view.setUint32(16, crc, true);
    central.view.setUint32(20, data.length, true); central.view.setUint32(24, data.length, true); central.view.setUint16(28, name.length, true); central.view.setUint32(42, offset, true);
    chunks.push(local.bytes, name, data); directory.push(central.bytes, name);
    offset += local.bytes.length + name.length + data.length; directorySize += central.bytes.length + name.length;
  }
  const end = header(22), count = Object.keys(files).length;
  end.view.setUint32(0, 0x06054b50, true); end.view.setUint16(8, count, true); end.view.setUint16(10, count, true);
  end.view.setUint32(12, directorySize, true); end.view.setUint32(16, offset, true);
  const result = new Uint8Array(offset + directorySize + 22); let position = 0;
  for (const chunk of [...chunks, ...directory, end.bytes]) { result.set(chunk, position); position += chunk.length; }
  return result;
}
module.exports = { renderMapSvg, svgFromCy, reportMarkdown, zipFiles };
