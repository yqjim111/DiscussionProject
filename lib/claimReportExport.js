'use strict';
const { overallMapHtml, OVERALL_CSS, initOverallMaps } = require('./overallMapView');
const { secondarySection, sectionAnchor } = require('./reportSections');

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const flat = value => String(value || '').replace(/\s+/gu, ' ').trim();
const paragraphs = value => String(value || '').split(/\n\s*\n/u).filter(p => p.trim()).map(p => '<p>' + esc(flat(p)) + '</p>').join('');
const md = value => flat(value).replace(/[\\`*_{}\[\]<>|]/g, '\\$&');
const groupLabel = (report, id) => {
  const i = report.groups.findIndex(g => g.id === id);
  if (i < 0) return id;
  const group = report.groups[i];
  const members = (group.members || []).map(flat).filter(Boolean).join(', ');
  return 'G' + (i + 1) + ' · ' + group.name + (members ? ' · ' + members : '');
};
const sectionsOf = report => report.claimAnalysis?.sections || report.argumentMap?.claim_analysis?.sections || [];
const normalizeAxis = axis => ({ ...axis, pole_a: axis.pole_a || axis.helpful_pole, pole_b: axis.pole_b || axis.risk_pole });
const themeTitle = (report, theme) => 'Theme ' + (sectionsOf(report).flatMap(s => s.themes).indexOf(theme) + 1) + '. ' + theme.title;
const sourceHtml = (report, sources) => sources.map(source => '<blockquote><a data-open-target="group-' + esc(source.group_id) + '" href="#group-' + esc(source.group_id) + '">' + esc(groupLabel(report, source.group_id)) + '</a><p>' + esc(flat(source.original_quote)) + '</p></blockquote>').join('');

function supportMapHtml(report, theme, { open = false } = {}) {
  return '<details class="support-map"' + (open ? ' open' : '') + '><summary>Argument map · evidence → claims</summary><div class="support-tree">' + theme.claims.map(claim =>
    '<div class="support-row"><div class="support-cases">' + (claim.evidence.length ? claim.evidence.map(e => '<button type="button" class="map-chip" aria-describedby="map-preview-' + esc(e.id) + '"><strong>' + esc(e.label) + '</strong><span>' + esc(groupLabel(report, e.group_id)) + '</span><span class="map-preview" role="tooltip" id="map-preview-' + esc(e.id) + '"><strong>' + esc(e.label) + '</strong><span>' + esc(e.description) + '</span></span></button>').join('') : '<span class="muted">No specific supporting case reported.</span>') + '</div><div class="support-arrow">' + (claim.evidence.length ? 'support →' : '') + '</div><div class="map-claim"><strong>' + esc(claim.label) + '</strong><span>' + esc(claim.text) + '</span><b>' + claim.group_count + ' groups</b></div></div>').join('') + '</div></details>';
}

function claimHtml(report, claim) {
  return '<details class="claim" id="' + esc(claim.id) + '"><summary><strong>' + esc(claim.label) + '.</strong> ' + esc(claim.text) + '<span class="frequency">' + claim.group_count + (claim.group_count === 1 ? ' group' : ' groups') + '</span></summary><div class="claim-body">' +
    '<details class="source-details" open><summary>Claim-Original transcript</summary>' + sourceHtml(report, claim.original_sources) + '</details>' +
    (claim.conditions ? '<p class="conditions"><strong>Evidences:</strong> ' + esc(claim.conditions) + '</p>' : '') +
    '<p class="group-list">Mentioned in ' + esc(claim.group_ids.map(id => groupLabel(report, id)).join('; ')) + '</p>' +
    '<div class="evidence-list">' + (claim.evidence.length ? claim.evidence.map(e => '<details class="evidence" id="' + esc(e.id) + '"><summary><strong>' + esc(e.label) + '.</strong> ' + esc(e.description) + '</summary><div class="evidence-body"><details class="source-details" open><summary>Original transcript · ' + esc(e.label.toLowerCase()) + '</summary>' + sourceHtml(report, e.original_sources) + '</details></div></details>').join('') : '<p class="muted">No specific supporting experience was stated for this claim.</p>') + '</div></div></details>';
}

function tensionAnalysisHtml(report) {
  const analysis = report.claimAnalysis || report.argumentMap?.claim_analysis;
  const axes = (analysis?.overall_map?.tensions || []).map(normalizeAxis);
  if (!axes.length) return '';
  const claims = new Map(sectionsOf(report).flatMap(s => s.themes.flatMap(t => t.claims)).map(c => [c.id, c]));
  const pole = (p, kind) => '<div class="tension-pole ' + kind + '"><p>' + esc(p.conditions) + '</p><div class="pole-claims">' + p.claim_ids.map(id => '<span title="' + esc(claims.get(id)?.text || '') + '">' + esc(claims.get(id)?.label || id) + '</span>').join('') + '</div><details class="source-details axis-sources"><summary>Original transcripts</summary>' + sourceHtml(report, p.original_sources || []) + '</details></div>';
  return '<div class="tension-analysis" id="tension-analysis"><h3>Tension Analysis</h3>' + axes.map(axis => '<article class="tension-axis"><h4>' + esc(axis.label + '. ' + axis.title) + '</h4><div class="tension-visual" role="img" aria-label="' + esc(axis.pole_a.label + ' versus ' + axis.pole_b.label + ': ' + axis.dimension) + '"><div class="axis-labels"><strong class="helpful-label">' + esc(axis.pole_a.label) + '</strong><strong class="risk-label">' + esc(axis.pole_b.label) + '</strong></div><div class="bipolar-line"></div><div class="axis-dimension">' + esc(axis.dimension) + '</div></div><p class="tension-explanation">' + esc(axis.analysis) + '</p><div class="tension-poles">' + pole(axis.pole_a, 'helpful-pole') + pole(axis.pole_b, 'risk-pole') + '</div></article>').join('') + '</div>';
}
const TENSION_CSS = `
.tension-analysis{margin-top:40px}.tension-analysis>h3{font-size:24px;margin-bottom:24px}.tension-axis{margin:24px 0;padding:26px;border:1px solid #dce3df;border-radius:12px;background:#fff}.tension-axis>h4{font-size:20px;margin:0 0 26px;line-height:1.5}.axis-labels{display:grid;grid-template-columns:1fr 1fr;gap:65px;font-size:17px;line-height:1.5}.helpful-label{color:#285d48}.risk-label{color:#8a3e4b;text-align:right}.bipolar-line{height:4px;margin:22px 9px 14px;background:linear-gradient(90deg,#498b62,#aab6ab 50%,#b9687b);position:relative}.bipolar-line:before,.bipolar-line:after{content:'';position:absolute;top:-5px;width:14px;height:14px;border-radius:50%;background:#498b62;left:-7px}.bipolar-line:after{left:auto;right:-7px;background:#b9687b}.axis-dimension{text-align:center;font-weight:600;color:#4c5d6e;font-size:14px;margin:0 auto 22px;max-width:80%}.tension-explanation{line-height:1.8;margin:18px 0 22px}.tension-poles{display:grid;grid-template-columns:1fr 1fr;gap:20px}.tension-pole{padding:17px 19px;border-radius:8px;background:#f0f7f2;border-top:3px solid #76a487}.risk-pole{background:#fbf0f3;border-top-color:#bf8795}.tension-pole>p{font-size:14px;line-height:1.8;margin:0 0 16px}.pole-claims{display:flex;gap:6px;flex-wrap:wrap}.pole-claims>span{font-size:12px;font-weight:650;background:#ffffffb8;border:1px solid #cadace;border-radius:5px;padding:4px 8px}.risk-pole .pole-claims>span{border-color:#e3c8ce}.axis-sources blockquote{background:#ffffffc9}.tension-pole blockquote p{font-size:13px;line-height:1.8}@media(max-width:750px){.tension-poles{grid-template-columns:1fr}.tension-axis{padding:18px}.axis-labels{font-size:15px;gap:28px}}
`;

const CSS = `
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f2f4f7;color:#213047;font:16px/1.7 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1180px;margin:28px auto;background:#fff;border:1px solid #e3e7ed;border-radius:16px;padding:46px 54px;box-shadow:0 8px 30px #1e293b08}h1{font-size:34px;line-height:1.2;margin:10px 0 18px}h2{font-size:27px;line-height:1.3;margin:0 0 24px;padding-bottom:14px;border-bottom:2px solid #e2e7ee}h3{font-size:21px;line-height:1.4;margin:0 0 12px}h4{margin:24px 0 10px}.eyebrow{font-size:12px;letter-spacing:2px;color:#69748b}.metadata,.muted,.count-note{color:#68758a;font-size:13px}.count-note{background:#f7f8fb;padding:13px 16px;border-radius:8px}nav{display:flex;gap:18px;flex-wrap:wrap;margin:26px 0 40px;padding:15px 0;border-top:1px solid #e5e9ef;border-bottom:1px solid #e5e9ef}nav a,a{color:#435b96;text-underline-offset:3px}section{margin:0 0 52px;scroll-margin-top:20px}.theme{margin:22px 0 32px;padding:24px;border:1px solid #dfe6e4;border-radius:12px;background:#b6beb9}.unhelpful .theme{border-color:#d8b9c1;background:#c1b3b7}.theme-description{color:#526276;margin:0 0 20px}.helpful h2{border-color:#7ba993;color:#285d48}.unhelpful h2{border-color:#c99199;color:#8a3e4b}details{scroll-margin-top:22px}summary{cursor:pointer;list-style:disclosure-closed}details[open]>summary{list-style:disclosure-open}summary::marker{color:#6b7890}.claim{background:#fff;border:1px solid #dce5e0;border-radius:8px;margin:12px 0}.claim>summary{position:relative;padding:16px 102px 16px 19px;font-size:16px;line-height:1.65;list-style-position:inside}.claim>summary strong{margin-right:4px}.frequency{position:absolute;right:14px;top:16px;white-space:nowrap;font-size:12px;line-height:1.5;border-radius:16px;background:#e9f3ec;color:#315f47;padding:4px 9px;font-weight:700}.unhelpful .frequency{background:#f8eaed;color:#8a4350}.claim-body{padding:4px 22px 22px;border-top:1px solid #edf0ed}.conditions{margin-bottom:8px}.group-list{font-size:12px;color:#6b7789}.source-details{margin:14px 0;font-size:14px}.source-details>summary{color:#465f8a}.evidence{margin:12px 0;padding:13px 16px;border-left:3px solid #a5bcae;background:#f7faf8;border-radius:3px}.unhelpful .evidence{background:#fcf7f8;border-color:#cfabb2}.evidence>summary{font-size:14px}.evidence-body{padding:4px 8px}.support-reason{font-size:13px;color:#536477}blockquote{border-left:2px solid #c7d2e3;background:#f5f7fa;margin:12px 0;padding:12px 16px;font-size:14px}blockquote a{font-size:12px;font-weight:700}blockquote p{margin:5px 0;white-space:normal;overflow-wrap:anywhere}.support-map{margin-top:22px;border-top:1px solid #dde5df;padding-top:16px}.support-map>summary{font-size:14px;font-weight:650;color:#48677a}.support-tree{padding-top:12px}.support-row{display:grid;grid-template-columns:minmax(160px,1fr) 90px minmax(200px,1.4fr);align-items:center;padding:16px 0;border-top:1px dashed #dce4e3;gap:12px}.support-cases{display:flex;flex-wrap:wrap;gap:6px}.map-chip{display:block;background:#f0f4f8;border:1px solid #cfd9e6;border-radius:6px;padding:6px 9px;text-decoration:none;font-size:11px;max-width:100%}.map-chip span{display:block;color:#65738a;overflow-wrap:anywhere}.map-claim{background:#eaf3ed;border:1px solid #a9c3b2;border-radius:8px;padding:12px;text-decoration:none;color:#284b3b;font-size:13px}.map-claim strong,.map-claim span{display:block}.map-claim b{display:inline-block;margin-top:6px;font-size:11px}.unhelpful .map-claim{background:#f7e9ec;border-color:#d3adb5;color:#783c49}.support-arrow{font-size:10px;color:#61738c;text-align:center;white-space:nowrap}.transcript-group{padding:24px 0;border-bottom:1px solid #e2e7ef;scroll-margin-top:20px}.original-transcript{white-space:normal;line-height:1.85;color:#5c6a80;font-size:14px;overflow-wrap:anywhere}.cleaned-transcript{background:#f2f7f4;border-left:3px solid #8eb39d;padding:15px 21px;font-size:14px;line-height:1.85;overflow-wrap:anywhere}.cleaned-transcript p:first-child{margin-top:0}.cleaned-transcript p:last-child{margin-bottom:0}.toolbar{display:flex;gap:9px;margin-bottom:20px}button{background:white;border:1px solid #ccd5e2;padding:7px 12px;border-radius:6px;color:#536784;cursor:pointer;font:inherit;font-size:12px}#summary p{margin:0 0 18px;line-height:1.85}.section-subtitle{color:#68758a;font-size:14px;margin-top:-10px;margin-bottom:24px}@media(max-width:750px){main{margin:0;padding:24px 18px;border:0;border-radius:0}h1{font-size:29px}.theme{padding:16px}.claim>summary{padding-right:90px}.claim-body{padding:3px 14px 16px}.support-row{grid-template-columns:1fr;gap:10px}.support-arrow{text-align:left}.frequency{right:10px;font-size:11px}}@media print{body{background:#fff}main{border:0;box-shadow:none;margin:0;max-width:none;padding:15px}nav,.toolbar{display:none}.theme{break-inside:auto}details{break-inside:auto}}
`;
const MAP_CSS = `
.toolbar button{border:2px solid #39815d;color:#285d48;font-weight:600}.toolbar button:hover{background:#edf7f0;border-color:#286444}.toolbar button:focus-visible{outline:2px solid #39815d;outline-offset:3px}
.map-chip{position:relative;text-align:left;cursor:default;color:#435b96;line-height:1.6}.map-chip:focus-visible{outline:2px solid #587caf;outline-offset:2px}.map-chip .map-preview{display:none;position:absolute;bottom:calc(100% + 7px);left:0;z-index:10;width:min(420px,72vw);padding:14px 16px;background:#fff;border:1px solid #bccbda;border-radius:8px;box-shadow:0 7px 25px #21304730;color:#213047;font-size:14px;line-height:1.7;white-space:normal;pointer-events:none}.map-chip:hover .map-preview,.map-chip:focus .map-preview{display:block}.map-chip .map-preview span{color:#213047;margin-top:5px}.map-claim{cursor:default}@media print{.map-preview{display:none!important}}
`;
const SCRIPT = `
function reveal(id){const target=document.getElementById(id);if(!target)return;let node=target;while(node){if(node.tagName==='DETAILS')node.open=true;node=node.parentElement}requestAnimationFrame(()=>target.scrollIntoView({behavior:'smooth',block:'start'}))}
document.querySelectorAll('[data-open-target]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();reveal(link.dataset.openTarget)}));
document.getElementById('expand-claims')?.addEventListener('click',()=>document.querySelectorAll('details.claim').forEach(d=>d.open=true));
document.getElementById('collapse-claims')?.addEventListener('click',()=>document.querySelectorAll('details.claim').forEach(d=>d.open=false));
document.getElementById('expand-transcripts')?.addEventListener('click',()=>document.querySelectorAll('details.transcript-group').forEach(d=>d.open=true));
document.getElementById('collapse-transcripts')?.addEventListener('click',()=>document.querySelectorAll('details.transcript-group').forEach(d=>d.open=false));
if(location.hash)reveal(decodeURIComponent(location.hash.slice(1)));
`;
const shell = (title, content) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' + CSS + MAP_CSS + OVERALL_CSS + TENSION_CSS + '</style></head><body><main>' + content + '</main><script>' + SCRIPT + '\n(' + initOverallMaps.toString() + ')(document);' + '</script></body></html>';

function claimReportHtml(report) {
  const analysis = report.claimAnalysis || report.argumentMap.claim_analysis;
  const mapNumber = analysis.sections.length + 2, transcriptNumber = mapNumber + 1;
  const reportTitle = analysis.report_title || 'Discussion Report';
  const counts = analysis.sections.flatMap(s => s.themes.flatMap(t => t.claims));
  const header = '<header><div class="eyebrow">CLASSDISCUSS · CLASSROOM REFLECTION REPORT</div><h1>' + esc(reportTitle) + '</h1><p class="metadata">Room ' + esc(report.room.code) + ' · ' + esc(report.room.instructor_name || '') + (report.room.session_date ? ' · ' + esc(report.room.session_date) : '') + '</p><p class="metadata">' + counts.length + ' claims · ' + analysis.sections.reduce((n, s) => n + s.themes.length, 0) + ' themes · ' + report.groups.length + ' group records</p></header>';
  const nav = '<nav><a href="#summary">1. Summary</a>' + analysis.sections.map((section, i) => '<a href="#' + esc(sectionAnchor(section, i)) + '">' + (i + 2) + '. ' + esc(section.title) + '</a>').join('') + '<a href="#overall-map">' + mapNumber + '. Overall Argument Map</a><a href="#transcripts">' + transcriptNumber + '. Transcripts</a></nav>';
  const summary = '<section id="summary"><h2>1. Summary</h2>' + paragraphs(analysis.summary) + '</section>';
  const note = '<div class="toolbar"><button id="expand-claims">Expand claims</button><button id="collapse-claims">Collapse claims</button></div>';
  const bodies = analysis.sections.map((section, i) => '<section id="' + sectionAnchor(section, i) + '" class="' + (secondarySection(section, i) ? 'unhelpful' : 'helpful') + '"><h2>' + (i + 2) + '. ' + esc(section.title) + '</h2>' + (i === 0 ? note : '') +
    section.themes.map(theme => '<article class="theme"><h3>' + esc(themeTitle(report, theme)) + '</h3><p class="theme-description">' + esc(theme.description) + '</p>' + theme.claims.map(claim => claimHtml(report, claim)).join('') + supportMapHtml(report, theme) + '</article>').join('') + '</section>').join('');
  const transcripts = '<section id="transcripts"><h2>' + transcriptNumber + '. Original and cleaned transcripts</h2><div class="toolbar"><button id="expand-transcripts">Expand transcripts</button><button id="collapse-transcripts">Collapse transcripts</button></div>' + report.groups.map(g => '<details class="transcript-group" id="group-' + esc(g.id) + '" open><summary>' + esc(groupLabel(report, g.id)) + '</summary><div class="transcript-content"><h4>Original Transcript</h4><p class="original-transcript">' + esc(flat(g.transcript) || 'No transcript recorded for this group.') + '</p><h4>Cleaned Transcript</h4><div class="cleaned-transcript">' + paragraphs(g.cleanedTranscript || 'No transcript available to clean.') + '</div></div></details>').join('') + '</section>';
  return shell('Discussion ' + report.room.code + ' · ' + reportTitle, header + nav + summary + bodies + overallMapHtml(report).replace('</section>', tensionAnalysisHtml(report) + '</section>') + transcripts);
}
function claimMapsHtml(report) {
  return shell('Evidence → claim maps', '<h1>Evidence → Claim Maps</h1><p><a href="report.html">Open the complete report</a></p>' + sectionsOf(report).map((section, i) => '<section class="' + (secondarySection(section, i) ? 'unhelpful' : 'helpful') + '"><h2>' + esc(section.title) + '</h2>' + section.themes.map(t => '<article class="theme"><h3>' + esc(themeTitle(report, t)) + '</h3>' + supportMapHtml(report, t, { external: true, open: true }) + '</article>').join('') + '</section>').join(''));
}
function claimReportMarkdown(report) {
  const analysis = report.claimAnalysis || report.argumentMap.claim_analysis;
  const lines = ['# ' + md(analysis.report_title || 'Discussion Report'), '', '**Room:** ' + md(report.room.code), '', '## 1. Summary', '', analysis.summary, ''];
  for (const [i, section] of analysis.sections.entries()) {
    lines.push('## ' + (i + 2) + '. ' + section.title, '');
    for (const theme of section.themes) {
      lines.push('### ' + md(themeTitle(report, theme)), '', md(theme.description), '');
      for (const claim of theme.claims) {
        lines.push('<details><summary><strong>' + esc(claim.label) + '.</strong> ' + esc(claim.text) + ' — ' + claim.group_count + ' groups</summary>', '', '**Claim-Original transcript**', '');
        for (const source of claim.original_sources) lines.push('> **' + md(groupLabel(report, source.group_id)) + ':** ' + md(source.original_quote), '');
        if (claim.conditions) lines.push('**Evidences:** ' + md(claim.conditions), '');
        for (const e of claim.evidence) {
          lines.push('<details><summary><strong>' + esc(e.label) + '.</strong> ' + esc(e.description) + '</summary>', '', '**Original transcript**', '');
          for (const source of e.original_sources) lines.push('> **' + md(groupLabel(report, source.group_id)) + ':** ' + md(source.original_quote), '');
          lines.push('</details>', '');
        }
        lines.push('</details>', '');
      }
      lines.push('**Argument map:** ' + theme.claims.map(c => (c.evidence.length ? c.evidence.map(e => e.label).join(', ') + ' → ' : '') + c.label).join('; '), '');
    }
  }
  lines.push('## ' + (analysis.sections.length + 2) + '. Overall Argument Map', '', '[Interactive overall argument map](report.html#overall-map)', '');
  for (const axis of (analysis.overall_map?.tensions || []).map(normalizeAxis)) {
    lines.push('### ' + md(axis.label + '. ' + axis.title), '', '**' + md(axis.pole_a.label) + ' ↔ ' + md(axis.pole_b.label) + '**', '', md(axis.dimension), '', md(axis.analysis), '');
    for (const pole of [axis.pole_a, axis.pole_b]) {
      lines.push('**' + md(pole.label) + '**', '', md(pole.conditions), '');
      for (const q of pole.original_sources || []) lines.push('> **' + md(groupLabel(report, q.group_id)) + ':** ' + md(q.original_quote), '');
    }
  }
  lines.push('## ' + (analysis.sections.length + 3) + '. Original and cleaned transcripts', '');
  for (const [i, group] of report.groups.entries()) lines.push('### G' + (i + 1) + ' · ' + md(group.name), '', '#### Original Transcript', '', md(group.transcript) || 'No transcript recorded.', '', '#### Cleaned Transcript', '', ...String(group.cleanedTranscript || 'No transcript available to clean.').split(/\n\s*\n/u).flatMap(p => [md(p), '']));
  return lines.join('\n');
}

function wrap(text, max = 64) {
  const lines = []; let line = '';
  for (const word of flat(text).split(' ')) { if (line && (line + ' ' + word).length > max) { lines.push(line); line = ''; } line += (line ? ' ' : '') + word; }
  if (line) lines.push(line); return lines;
}
function supportMapSvg(report) {
  const width = 1280, parts = []; let y = 52;
  const label = (x, top, value, size = 13, color = '#24344a') => '<text x="' + x + '" y="' + top + '" font-family="Arial,sans-serif" font-size="' + size + '" fill="' + color + '">' + esc(value) + '</text>';
  parts.push(label(32, y, 'Evidence → Claim Maps', 26)); y += 55;
  for (const section of sectionsOf(report)) {
    parts.push(label(32, y, section.title, 23)); y += 40;
    for (const theme of section.themes) {
      for (const line of wrap(themeTitle(report, theme), 90)) { parts.push(label(32, y, line, 17)); y += 24; }
      y += 12;
      for (const claim of theme.claims) {
        const lines = wrap(claim.label + '. ' + claim.text, 70);
        const evidenceLines = claim.evidence.length ? claim.evidence.flatMap(e => wrap(e.label + ' · ' + groupLabel(report, e.group_id), 59).map(text => ({ text, description: e.description }))) : [{ text: 'No specific supporting case reported', description: '' }];
        const height = Math.max(lines.length, evidenceLines.length) * 20 + 46;
        parts.push('<g data-claim-id="' + esc(claim.id) + '"><rect x="32" y="' + y + '" width="510" height="' + height + '" rx="8" fill="#f2f5f9" stroke="#cbd6e4"/>');
        evidenceLines.forEach((line, i) => parts.push('<g><title>' + esc(line.description) + '</title>' + label(47, y + 28 + i * 20, line.text, 12) + '</g>'));
        if (claim.evidence.length) parts.push('<path d="M554 ' + (y + height / 2) + ' H654" stroke="#74849c" stroke-width="2" marker-end="url(#arrow)"/><text x="570" y="' + (y + height / 2 - 10) + '" font-family="Arial" font-size="10" fill="#63738b">support</text>');
        const fill = secondarySection(section, sectionsOf(report).indexOf(section)) ? '#f8e9ed' : '#eaf4ed';
        parts.push('<g><rect x="670" y="' + y + '" width="578" height="' + height + '" rx="8" fill="' + fill + '" stroke="#b7c7bf"/>');
        lines.forEach((line, i) => parts.push(label(685, y + 27 + i * 20, line, 13)));
        parts.push(label(685, y + height - 14, 'Mentioned in ' + claim.group_count + ' groups', 11)); parts.push('</g></g>'); y += height + 22;
      }
      y += 22;
    }
    y += 24;
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + y + '" viewBox="0 0 ' + width + ' ' + y + '"><rect width="100%" height="100%" fill="white"/><defs><marker id="arrow" markerWidth="9" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0 0L8 4L0 8Z" fill="#74849c"/></marker></defs>' + parts.join('') + '</svg>';
}
module.exports = { claimReportHtml, claimReportMarkdown, claimMapsHtml, supportMapSvg, supportMapHtml };
