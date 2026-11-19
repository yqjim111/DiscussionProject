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
  if (graph?.claim_analysis) return require('./claimReportExport').supportMapSvg({ claimAnalysis: graph.claim_analysis, argumentMap: graph, groups: graph.groups || [] });
  const cy = cytoscape({ headless: true, styleEnabled: true, elements: graphElements(graph), style: graphStyles, layout: { name: 'preset' } });
  try { layoutGraph(cy); return svgFromCy(cy); } finally { cy.destroy(); }
}
const md = text => String(text ?? '').replace(/\s+/gu, ' ').trim().replace(/[\\`*_{}\[\]<>#|]/g, '\\$&');
function reportMarkdown(report) {
  if (report.claimAnalysis) return require('./claimReportExport').claimReportMarkdown(report);
  const sources = list => [...new Set(list.map(s => { const i = report.groups.findIndex(g => g.id === s.group_id); return i < 0 ? s.group_id || 'Unknown group' : 'G' + (i + 1) + ' · ' + report.groups[i].name; }))].map(md).join(', ');
  const multiline = value => String(value ?? '').split(/\r?\n/).map(md).join('  \n');
  const lines = ['ClassDiscuss · Session Report', '', '# Classroom Discussion Report', '',
    `**Room:** ${md(report.room.code)}`, '',
    ...(report.room.session_date ? [`**Date:** ${md(report.room.session_date)}`, ''] : report.room.created_at ? [`**Date:** ${new Date(report.room.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Chicago' })}`, ''] : []),
    ...(report.generatedAt ? [`**Report snapshot:** ${new Date(report.generatedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}`, ''] : []),
    '## Session Information', '', `**Instructor:** ${md(report.room.instructor_name || 'Not provided')}`, '',
    `**Discussion Topic:** ${multiline(report.room.teacher_topic)}`, '', `**Questions / Instructions:** ${multiline(report.room.discussion_instructions)}`, '',
    `**Groups:** ${report.groups.map(g => md(g.name)).join(', ') || 'No groups recorded'}`, '',
    ...(report.argumentMap?.generation?.method_version ? ['**Analysis scope:** All discussion rounds, including positive, negative, mixed and conditional experiences. Topic and instructions are metadata only; they were not used to filter or judge contributions.', ''] : []),
    '## 1. Overall Summary', '', report.overallSummary ? multiline(report.overallSummary) : 'Not generated.', '',
    '## 2. Content Analysis', '',
    ...(report.contentAnalysis?.statements || []).flatMap((s, i) => [`${i + 1}. **Statement ${i + 1}.** ${md(s.statement)} **(${sources(s.sources)})**`,
      ...((report.argumentMap?.generation?.method_version) ? s.sources.map(source => `   > ${md(source.original_quote)}`) : []), '']), '',
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
    ...((report.argumentMap?.generation?.method_version) ? ['### Verified argument relationships', '',
      ...report.argumentMap.edges.flatMap(edge => [`- **${md(edge.source_node_id)} ${md(edge.relationship_type)} ${md(edge.target_node_id)}:** ${md(edge.justification)}`,
        ...edge.evidence.map(item => `  > ${md(item.node_id)}: ${md(item.original_quote)}`)]), ''] : []),
    ...thematicMarkdown(report.thematicAnalysis || report.argumentMap?.thematic_analysis),
    '## 4. Original Transcripts', '',
  ];
  report.groups.forEach((g, i) => lines.push(`### Group ${i + 1}: ${md(g.name)}`, '', `Members: ${(g.members || []).map(md).join(', ') || 'Not provided'}`, '',
    '#### Original Transcript', '', multiline(g.transcript) || 'No transcription recorded for this group.', '',
    '#### Cleaned Transcript', '', g.cleanup?.status === 'completed' ? multiline(g.cleanedTranscript) || (g.transcript?.trim() ? 'No text remains after conservative cleanup.' : 'No transcript available to clean.') : 'Not yet cleaned.', '',
    ...(g.cleanup?.review_notes?.length ? ['**Cleanup review notes**', '', ...g.cleanup.review_notes.map(note => `- ${md(note.issue)} Original: “${md(note.original_excerpt)}”`), ''] : []),
    ...(g.manualPoints?.some(p => p.text.trim()) ? ['**Student-written Contributions**', '', ...g.manualPoints.filter(p => p.text.trim()).map(p => '- ' + multiline(p.text).replace(/\n/g, '\n  ')), ''] : [])));
  return lines.join('\n');
}

function thematicMarkdown(analysis) {
  const lines = ['## Thematic Analysis', ''];
  if (!analysis) return [...lines, 'Thematic analysis has not been generated for this saved discussion.', ''];
  if (analysis.warning) lines.push(md(analysis.warning), '');
  if (analysis.status !== 'completed') return lines;
  lines.push('### Themes', '');
  if (!analysis.themes.length) lines.push('No themes identified.', '');
  for (const theme of analysis.themes) lines.push(`**${md(theme.name)}**`, '', md(theme.definition), '',
    ...(analysis.method_version === 'cleaned-thematic-v2' ? [`**Conditions and boundaries:** ${md(theme.qualifications)}`, '',
      ...theme.sources.map(source => `> ${md(source.group_name || source.group_id)}: ${md(source.original_quote)}`), ''] : []));
  lines.push('### Axes', '');
  if (!analysis.axes.length) lines.push('No axes identified.', '');
  for (const axis of analysis.axes) lines.push(`**${md(axis.left_pole.label)} ↔ ${md(axis.right_pole.label)}**`, '', md(axis.left_pole.definition + ' ' + axis.right_pole.definition), '');
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
function reportHtml(report, svg = renderMapSvg(report.argumentMap)) {
  if (report.claimAnalysis) return require('./claimReportExport').claimReportHtml(report);
  const graph = report.argumentMap || { nodes: [], edges: [] }, analysis = report.thematicAnalysis;
  const groupName = id => { const i = report.groups.findIndex(g => g.id === id); return i < 0 ? id : 'G' + (i + 1) + ' · ' + report.groups[i].name; };
  const paragraphs = value => String(value || '').split(/\n\s*\n/).filter(Boolean).map(p => '<p>' + xml(p).replace(/\r?\n/g, '<br>') + '</p>').join('');
  const evidence = list => (list || []).map(s => '<blockquote><strong>' + xml(groupName(s.group_id)) + '</strong><br>' + xml(s.original_quote).replace(/\r?\n/g, '<br>') + '</blockquote>').join('');
  const sessionDate = report.room.session_date || (report.room.created_at ? new Date(report.room.created_at).toLocaleDateString('en-US', { timeZone: 'America/Chicago' }) : 'Not provided');
  const argumentAudit = graph.argument_review ? '<section><h2>Argument Review Audit</h2><p>' + graph.argument_review.kept + ' retained relationships from ' + graph.argument_review.candidates + ' reviewed candidates.</p><details><summary>Inspect every KEEP / REMOVE decision</summary>' + graph.argument_review.decisions.map(d => '<article><p><strong>' + xml(d.candidate_id + ' · ' + d.decision) + '</strong> ' + xml(d.candidate.source_node_id + ' → ' + d.candidate.target_node_id) + '</p><p>' + xml(d.reason) + '</p></article>').join('') + '</details></section>' : '';
  const sections = [
    '<header><p class="eyebrow">CLASSDISCUSS · EVIDENCE-GROUNDED REPORT</p><h1>Classroom Discussion Report</h1><p>Room ' + xml(report.room.code) + ' · ' + xml(report.room.instructor_name) + '</p><p>Session date: ' + xml(sessionDate) + (report.generatedAt ? ' · Generated: ' + xml(new Date(report.generatedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })) : '') + '</p><p>All positive, negative and conditional discussion rounds analyzed together. Classroom topic and instructions were not used to filter the analysis.</p><p>' + report.groups.length + ' group records · ' + graph.nodes.length + ' verified statements · ' + graph.edges.length + ' relationships · ' + (analysis?.themes?.length || 0) + ' themes</p><p>AI-assisted analysis; original evidence remains available for review. Repeated snowball accounts are not independent votes.</p></header>',
    '<nav><a href="#summary">Summary</a><a href="#content">Content analysis</a><a href="#map">Argument map</a><a href="#themes">Themes</a><a href="#transcripts">Original / cleaned transcripts</a></nav>',
    '<section id="summary"><h2>1. Overall Summary</h2>' + paragraphs(report.overallSummary) + '</section>',
    '<section id="content"><h2>2. Content Analysis</h2>' + graph.nodes.map((node, i) => '<article id="statement-' + xml(node.node_id) + '"><h3>Statement ' + (i + 1) + ' <span class="badge">' + xml(node.primary_type) + ' · ' + xml(node.account_kind || '') + '</span></h3><p>' + xml(node.normalized_statement) + '</p><p class="muted">' + xml([...new Set(node.sources.map(s => groupName(s.group_id)))].join(' · ')) + '</p><details><summary>Original evidence</summary>' + evidence(node.sources) + '</details></article>').join('') + '</section>',
    '<section id="map"><h2>3. Argument Map</h2><p>Click a statement card to inspect its evidence. Use zoom controls and scroll to explore the complete graph.</p><div class="controls"><button id="zoom-out">− Zoom out</button><button id="zoom-in">+ Zoom in</button><button id="zoom-reset">Reset</button></div><div class="map-viewport"><div id="map-canvas">' + svg + '</div></div><h3>Verified relationships</h3>' + graph.edges.map(edge => '<article><p><a href="#statement-' + xml(edge.source_node_id) + '">' + xml(edge.source_node_id) + '</a> <strong>' + xml(edge.relationship_type) + '</strong> <a href="#statement-' + xml(edge.target_node_id) + '">' + xml(edge.target_node_id) + '</a></p><p>' + xml(edge.justification) + '</p><details><summary>Relationship evidence</summary>' + edge.evidence.map(item => '<blockquote>' + xml(item.node_id) + ': ' + xml(item.original_quote) + '</blockquote>').join('') + '</details></article>').join('') + '</section>',
    argumentAudit,
    '<section id="themes"><h2>Thematic Analysis</h2>' + (analysis?.themes || []).map(theme => '<article><h3>' + xml(theme.name) + '</h3>' + paragraphs(theme.definition) + '<p><strong>Central concept:</strong> ' + xml(theme.central_concept) + '</p><p><strong>Conditions and boundaries:</strong> ' + xml(theme.qualifications) + '</p><p><strong>Includes:</strong> ' + xml(theme.inclusion) + '</p><p><strong>Excludes:</strong> ' + xml(theme.exclusion) + '</p><details><summary>Supporting original evidence</summary>' + evidence(theme.sources) + '</details></article>').join('') +
      '<h3>Supported analytic dimensions</h3>' + ((analysis?.axes || []).map(a => '<article><h4>' + xml(a.left_pole.label) + ' ↔ ' + xml(a.right_pole.label) + '</h4><p>' + xml(a.rationale) + '</p><p>' + xml(a.qualifications) + '</p><details><summary>Evidence for both poles</summary><h4>' + xml(a.left_pole.label) + '</h4>' + evidence(a.left_pole.sources) + '<h4>' + xml(a.right_pole.label) + '</h4>' + evidence(a.right_pole.sources) + '</details></article>').join('') || '<p>No defensible two-pole dimension identified.</p>') +
      '<h3>Limitations and alternative interpretations</h3><ul>' + [...(analysis?.limitations || []), ...(analysis?.alternative_interpretations || [])].map(item => '<li>' + xml(item) + '</li>').join('') + '</ul><details><summary>Complete codebook (' + (analysis?.codes?.length || 0) + ' codes)</summary>' + (analysis?.codes || []).map(code => '<article><h4>' + xml(code.code_id + ': ' + code.label) + '</h4><p>' + xml(code.meaning) + '</p>' + evidence(code.sources) + '</article>').join('') + '</details></section>',
    '<section><h2>Experience episodes and snowball provenance</h2><p>Episode records describe occurrences in the source material. Repeated accounts may refer to the same experience; missing retelling links do not establish independence.</p><details><summary>Inspect recovered episodes (' + (report.contentAnalysis?.episodes?.length || 0) + ')</summary>' + (report.contentAnalysis?.episodes || []).map(ep => '<article><h3>' + xml(ep.episode_id + ' · ' + groupName(ep.group_id)) + '</h3><p>' + xml(ep.description) + '</p>' + ['project_goal', 'task', 'ai_interaction', 'student_action', 'reported_outcome', 'conditions', 'limitations'].filter(key => ep[key]).map(key => '<p><strong>' + xml(key.replace(/_/g, ' ')) + ':</strong> ' + xml(ep[key]) + '</p>').join('') + evidence(ep.sources) + '</article>').join('') + '</details><details><summary>Retelling links</summary>' + (report.contentAnalysis?.retellings || []).map(r => '<p><strong>' + xml(r.status) + '</strong> ' + xml(r.episode_ids.join(', ')) + ': ' + xml(r.reason) + '</p>').join('') + '</details></section>',
    '<section id="transcripts"><h2>4. Original and Cleaned Transcripts</h2>' + report.groups.map((g, i) => '<article class="transcript-group"><h3>Group ' + (i + 1) + ': ' + xml(g.name) + '</h3><p><strong>Members:</strong> ' + xml((g.members || []).join(', ')) + '</p><h4>Original Transcript</h4><div class="transcript-text">' + paragraphs(g.transcript || 'No transcription recorded for this group.') + '</div><h4>Cleaned Transcript</h4><div class="cleaned-transcript-text">' + paragraphs(g.cleanup?.status === 'completed' ? g.cleanedTranscript || (g.transcript?.trim() ? 'No text remains after conservative cleanup.' : 'No transcript available to clean.') : 'Not yet cleaned.') + '</div>' + (g.cleanup?.review_notes?.length ? '<details><summary>Cleanup review notes</summary>' + g.cleanup.review_notes.map(n => '<blockquote>' + xml(n.original_excerpt) + '</blockquote><p>' + xml(n.issue) + '</p>').join('') + '</details>' : '') + ((g.manualPoints || []).length ? '<h4>Student-written Contributions</h4>' + g.manualPoints.map(p => paragraphs(p.text)).join('') : '') + '</article>').join('') + '</section>',
  ];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Discussion ' + xml(report.room.code) + ' · Reanalyzed report</title><style>' +
    'body{margin:0;background:#f1f3f8;color:#202b40;font:16px/1.7 system-ui,sans-serif}main{max-width:1120px;margin:auto;background:white;padding:48px}h1{font-size:36px;line-height:1.2}h2{border-bottom:2px solid #ddd8f0;padding-bottom:10px;margin-top:44px}h3{line-height:1.4}h4{margin-bottom:8px}p{white-space:pre-wrap;overflow-wrap:anywhere}article{padding:18px 0;border-bottom:1px solid #e5e7ef;scroll-margin-top:20px}nav{display:flex;gap:20px;flex-wrap:wrap;padding:20px 0}a,summary{color:#4b3b91}summary,button{cursor:pointer}blockquote{white-space:pre-wrap;overflow-wrap:anywhere;border-left:3px solid #d8d1ed;padding:10px 18px;margin:14px 0;background:#f7f6fb;font-size:14px}.badge,.muted{font-size:13px;color:#667085}.eyebrow{font-size:12px;letter-spacing:2px;color:#64538b}.controls{display:flex;gap:10px;margin:12px 0}button{padding:8px 14px;border:1px solid #c9c4df;background:white;border-radius:6px}.map-viewport{max-height:780px;overflow:auto;border:1px solid #d8d1ed}#map-canvas{width:100%}#map-canvas svg{display:block;width:100%;height:auto}#map-canvas [data-node-id]{cursor:pointer}.cleaned-transcript-text{background:#f1f7f4;padding:16px 22px;border-left:3px solid #80aa95}.transcript-text{color:#505c70;font-size:14px}@media(max-width:700px){main{padding:20px}h1{font-size:28px}}' +
    '</style></head><body><main>' + sections.join('') + '</main><script>let zoom=1;const canvas=document.getElementById("map-canvas");function resize(){canvas.style.width=(zoom*100)+"%"}document.getElementById("zoom-in").onclick=()=>{zoom=Math.min(zoom*1.5,30);resize()};document.getElementById("zoom-out").onclick=()=>{zoom=Math.max(zoom/1.5,1);resize()};document.getElementById("zoom-reset").onclick=()=>{zoom=1;resize()};document.querySelectorAll("[data-node-id]").forEach(node=>{node.setAttribute("tabindex","0");node.setAttribute("role","link");function inspect(){const item=document.getElementById("statement-"+node.getAttribute("data-node-id"));if(item){item.querySelector("details").open=true;item.scrollIntoView({behavior:"smooth"})}}node.onclick=inspect;node.onkeydown=event=>{if(event.key==="Enter")inspect()}});</script></body></html>';
}
module.exports = { renderMapSvg, svgFromCy, reportMarkdown, reportHtml, zipFiles };
