'use strict';
const { secondarySection } = require('./reportSections');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function layoutClaims(claims, edges) {
  const nodes = claims.map((c, i) => ({ ...c, x: (i % 7) * 440, y: Math.floor(i / 7) * 250 }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  for (let iteration = 0; iteration < 650; iteration++) {
    const forces = nodes.map(n => ({ x: (1300 - n.x) * .0025, y: (780 - n.y) * .0025 }));
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j]; let dx = a.x - b.x, dy = a.y - b.y;
      const distance = Math.max(1, Math.hypot(dx, dy)), force = 70000 / (distance * distance);
      let fx = dx / distance * force, fy = dy / distance * force;
      if (Math.abs(dx) < 390 && Math.abs(dy) < 200) {
        if ((390 - Math.abs(dx)) < (200 - Math.abs(dy)) * 1.8) fx += Math.sign(dx || 1) * (390 - Math.abs(dx)) * .3;
        else fy += Math.sign(dy || 1) * (200 - Math.abs(dy)) * .35;
      }
      forces[i].x += fx; forces[i].y += fy; forces[j].x -= fx; forces[j].y -= fy;
    }
    for (const e of edges) {
      const a = byId.get(e.source), b = byId.get(e.target); if (!a || !b) continue;
      const ai = nodes.indexOf(a), bi = nodes.indexOf(b), dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.max(1, Math.hypot(dx, dy)), f = (d - (e.membership ? 310 : 510)) * (e.membership ? .02 : .008);
      forces[ai].x += dx / d * f; forces[ai].y += dy / d * f;
      forces[bi].x -= dx / d * f; forces[bi].y -= dy / d * f;

    }
    const step = .8 * (1 - iteration / 850);
    nodes.forEach((n, i) => { n.x += Math.max(-12, Math.min(12, forces[i].x)) * step; n.y += Math.max(-12, Math.min(12, forces[i].y)) * step; });
  }
  // Resolve rectangle collisions after force convergence so every claim stays readable.
  for (let pass = 0; pass < 180; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j], dx = b.x - a.x, dy = b.y - a.y;
      const overlapX = 368 - Math.abs(dx), overlapY = 178 - Math.abs(dy);
      if (overlapX <= 0 || overlapY <= 0) continue;
      moved = true;
      if (overlapX < overlapY) { const shift = Math.sign(dx || 1) * (overlapX + .1) / 2; a.x -= shift; b.x += shift; }
      else { const shift = Math.sign(dy || 1) * (overlapY + .1) / 2; a.y -= shift; b.y += shift; }
    }
    if (!moved) break;
  }
  // Keep substantial corridors between fixed-size cards, even in connected clusters.
  const centerX = nodes.reduce((sum, n) => sum + n.x, 0) / Math.max(1, nodes.length);
  const centerY = nodes.reduce((sum, n) => sum + n.y, 0) / Math.max(1, nodes.length);
  nodes.forEach(n => { n.x = centerX + (n.x - centerX) * 1.8; n.y = centerY + (n.y - centerY) * 1.8; });
  return nodes;
}
function routeEdges(nodes, edges) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const boundary = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const scale = Math.min(174 / Math.max(.001, Math.abs(dx)), 79 / Math.max(.001, Math.abs(dy)));
    return { x: a.x + dx * scale, y: a.y + dy * scale };
  };
  return edges.map(edge => {
    const a = byId.get(edge.source), b = byId.get(edge.target);
    return { edge, points: a && b ? [boundary(a, b), boundary(b, a)] : [] };
  });
}
function connectionPath(points) {
  return 'M' + points[0].x + ' ' + points[0].y + ' L' + points[1].x + ' ' + points[1].y;
}
const COLORS = { SUPPORT: '#637b6b', AGAINST: '#b74b60', TENSION: '#b47a2f' };
function mapData(report) {
  const sections = report.claimAnalysis?.sections || report.argumentMap?.claim_analysis?.sections || [];
  const nodes = [], memberships = []; let themeNumber = 0;
  for (const [sectionIndex, section] of sections.entries()) for (const theme of section.themes) {
    const id = 'theme-' + (++themeNumber);
    nodes.push({ id, label: 'Theme ' + themeNumber, text: theme.title || '', conditions: theme.description || '', polarity: section.polarity, secondary: secondarySection(section, sectionIndex), isTheme: true });
    for (const claim of theme.claims) {
      nodes.push({ ...claim, polarity: section.polarity, secondary: secondarySection(section, sectionIndex), isTheme: false });
      memberships.push({ id: 'membership-' + claim.id, source: claim.id, target: id, relation: 'SUPPORT', membership: true,
        rationale: 'This claim contributes to the coded theme: ' + theme.title });
    }
  }
  const analysis = report.claimAnalysis?.overall_map || report.argumentMap?.claim_analysis?.overall_map;
  return { nodes, edges: [...memberships, ...(analysis?.edges || []).filter(e => Object.hasOwn(COLORS, e.relation))] };
}
function overallMapSvg(report) {
  const data = mapData(report), edges = data.edges, nodes = layoutClaims(data.nodes, edges), byId = new Map(nodes.map(n => [n.id, n]));
  const routes = routeEdges(nodes, edges), routePoints = routes.flatMap(r => r.points);
  const left = Math.min(0, ...nodes.map(n => n.x - 230), ...routePoints.map(p => p.x - 40)), top = Math.min(0, ...nodes.map(n => n.y - 150), ...routePoints.map(p => p.y - 40));
  const width = Math.max(800, ...nodes.map(n => n.x + 230), ...routePoints.map(p => p.x + 40)) - left, height = Math.max(600, ...nodes.map(n => n.y + 150), ...routePoints.map(p => p.y + 40)) - top;
  const defs = Object.entries(COLORS).map(([type, color]) => '<marker id="overall-arrow-' + type + '" markerUnits="userSpaceOnUse" markerWidth="16" markerHeight="14" refX="15" refY="7" orient="auto-start-reverse"><path d="M0 0L16 7L0 14Z" fill="' + color + '"/></marker>').join('');
  const labels = [];
  const links = routes.map(({ edge: e, points }) => {
    const a = byId.get(e.source), b = byId.get(e.target); if (!a || !b) return '';
    const color = COLORS[e.relation];
    let position = points[0], best = -Infinity;
    for (let i = 1; i < points.length; i++) for (const t of [.5, .3, .7]) {
      const a = points[i - 1], b = points[i], p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - 9 };
      const collision = labels.some(q => Math.abs(q.x - p.x) < 90 && Math.abs(q.y - p.y) < 30) || nodes.some(n => Math.abs(n.x - p.x) < 220 && Math.abs(n.y - p.y) < 110);
      const score = Math.hypot(b.x - a.x, b.y - a.y) + (a.y === b.y ? 40 : 0) - (collision ? 100000 : 0) - Math.abs(t - .5) * 40;
      if (score > best) { best = score; position = p; }
    }
    if (!e.membership) labels.push(position);
    const dash = e.relation === 'TENSION' ? '9 6' : '';
    const label = e.membership ? '' : e.relation.toLowerCase();
    return '<g class="overall-edge" data-relation="' + e.relation.toLowerCase() + '" data-source="' + esc(e.source) + '" data-target="' + esc(e.target) + '"' + (e.membership ? ' data-theme-link="true" opacity=".55"' : '') + '><title>' + esc(a.label + ' → ' + b.label + ' · ' + e.relation.toLowerCase() + '\n' + e.rationale) + '</title><path d="' + connectionPath(points) + '" stroke="' + color + '" stroke-width="' + (e.membership ? '1.8' : '3.3') + '" fill="none"' + (dash ? ' stroke-dasharray="' + dash + '" marker-start="url(#overall-arrow-TENSION)"' : '') + ' marker-end="url(#overall-arrow-' + e.relation + ')"/>' + (label ? '<text x="' + position.x + '" y="' + position.y + '" text-anchor="middle" font-size="15" fill="' + color + '" stroke="white" stroke-width="5" paint-order="stroke">' + label + '</text>' : '') + '</g>';
  }).join('');
  const boxes = nodes.map(n => {
    const words = n.text.split(/\s+/), lines = []; let current = '';
    for (const word of words) { if (current && (current + ' ' + word).length > 35) { lines.push(current); current = ''; } current += (current ? ' ' : '') + word; } if (current) lines.push(current);
    if (lines.length > 4) { lines.length = 4; lines[3] = lines[3].replace(/[.,;:]?$/, '…'); }
    const helpful = !n.secondary, dark = helpful ? '#356f50' : '#994d64', fill = n.isTheme ? dark : helpful ? '#e4f2e9' : '#f7e4e9', ink = n.isTheme ? '#ffffff' : '#24344a';
    return '<g class="' + (n.isTheme ? 'overall-theme' : 'overall-node') + '" data-node-id="' + esc(n.id) + '" tabindex="0"><title>' + esc(n.label + '. ' + n.text + (n.conditions ? '\n\n' + n.conditions : '')) + '</title><rect x="' + (n.x - 174) + '" y="' + (n.y - 79) + '" width="348" height="158" rx="' + (n.isTheme ? '26' : '10') + '" fill="' + fill + '" stroke="' + dark + '" stroke-width="' + (n.isTheme ? '4' : '2.5') + '"/><text x="' + (n.x - 155) + '" y="' + (n.y - 49) + '" font-size="22" font-weight="700" fill="' + (n.isTheme ? '#ffffff' : dark) + '">' + esc(n.label) + '</text>' + lines.map((line, i) => '<text x="' + (n.x - 155) + '" y="' + (n.y - 19 + i * 23) + '" font-size="17" fill="' + ink + '">' + esc(line) + '</text>').join('') + '</g>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" class="overall-svg" role="img" aria-label="Overall argument map of all discussion themes and claims" viewBox="' + [left, top, width, height].join(' ') + '" data-initial-view="' + [left, top, width, height].join(' ') + '"><defs>' + defs + '</defs><g class="overall-edges">' + links + '</g><g class="overall-nodes">' + boxes + '</g></svg>';
}
const OVERALL_CSS = `.overall-map{position:relative;border:1px solid #d7e2da;border-radius:12px;background:#fafcfb;overflow:hidden}.overall-map .overall-svg{display:block;width:100%;height:850px;max-height:85vh;min-height:500px;touch-action:none;cursor:grab;user-select:none}.overall-map .overall-svg:active{cursor:grabbing}.overall-controls{position:absolute;top:14px;right:14px;z-index:2;display:flex;gap:7px}.overall-controls button{width:40px;height:40px;border:2px solid #39815d;color:#285d48;font-size:22px;line-height:1;padding:4px;background:white}.overall-node,.overall-theme{cursor:grab}.overall-node:focus,.overall-theme:focus{outline:none}.overall-node:hover rect,.overall-node:focus rect,.overall-theme:hover rect,.overall-theme:focus rect{stroke-width:5}.overall-map:fullscreen{background:#fafcfb}.overall-map:fullscreen .overall-svg{height:100vh;max-height:100vh}.transcript-group{border:1px solid #dce5e0;border-radius:9px;margin:14px 0;padding:0}.transcript-group>summary{padding:18px 22px;font-size:18px;font-weight:650;list-style-position:inside;color:#285d48}.transcript-content{padding:0 22px 24px}@media print{.overall-controls{display:none}.overall-map .overall-svg{height:700px;max-height:none}}`;
function overallMapHtml(report) {
  const number = (report.claimAnalysis?.sections || report.argumentMap?.claim_analysis?.sections || []).length + 2;
  return '<section id="overall-map"><h2>' + number + '. Overall Argument Map</h2><div class="overall-map" data-overall-map><div class="overall-controls"><button type="button" data-map-action="in" aria-label="Zoom in" title="Zoom in">+</button><button type="button" data-map-action="out" aria-label="Zoom out" title="Zoom out">−</button><button type="button" data-map-action="fit" aria-label="Fit map" title="Fit map">⌖</button><button type="button" data-map-action="fullscreen" aria-label="Full screen" title="Full screen">⛶</button></div>' + overallMapSvg(report) + '</div></section>';
}
// This function is also embedded verbatim in the standalone HTML; keep it self-contained.
function initOverallMaps(root) {
  const disposers = [];
  root.querySelectorAll('[data-overall-map]').forEach(container => {
    const svg = container.querySelector('svg'), initial = svg.getAttribute('data-initial-view').split(' ').map(Number);
    let view = initial.slice(), drag = null;
    const render = () => svg.setAttribute('viewBox', view.join(' '));
    const point = event => { const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
    const zoom = (factor, p) => { const next = view[2] * factor; if (next < initial[2] / 12 || next > initial[2] * 4) return; p ||= { x: view[0] + view[2] / 2, y: view[1] + view[3] / 2 }; view = [p.x + (view[0] - p.x) * factor, p.y + (view[1] - p.y) * factor, next, view[3] * factor]; render(); };
    const wheel = e => { e.preventDefault(); zoom(Math.exp(Math.max(-.5, Math.min(.5, e.deltaY * .0015))), point(e)); };
    const down = e => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, view: view.slice() }; svg.setPointerCapture(e.pointerId); };
    const move = e => { if (!drag) return; const rect = svg.getBoundingClientRect(), scale = Math.max(view[2] / rect.width, view[3] / rect.height); view[0] = drag.view[0] - (e.clientX - drag.x) * scale; view[1] = drag.view[1] - (e.clientY - drag.y) * scale; render(); };
    const up = () => { drag = null; };
    const click = e => { const button = e.target.closest('[data-map-action]'); if (!button) return; const action = button.dataset.mapAction; if (action === 'fit') { view = initial.slice(); render(); } else if (action === 'fullscreen') { if (document.fullscreenElement) document.exitFullscreen?.(); else container.requestFullscreen?.(); } else zoom(action === 'in' ? .75 : 1 / .75); };
    svg.addEventListener('wheel', wheel, { passive: false }); svg.addEventListener('pointerdown', down); svg.addEventListener('pointermove', move); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up); container.addEventListener('click', click);
    disposers.push(() => { svg.removeEventListener('wheel', wheel); svg.removeEventListener('pointerdown', down); svg.removeEventListener('pointermove', move); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); container.removeEventListener('click', click); });
  });
  return () => disposers.forEach(dispose => dispose());
}
module.exports = { overallMapHtml, overallMapSvg, OVERALL_CSS, initOverallMaps, layoutClaims, mapData, routeEdges };
