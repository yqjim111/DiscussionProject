// Shared by the interactive map and the PDF snapshot. No semantic decisions
// belong in the renderer: SUPPORTS can support a negative statement too.
const categories = {
  POSITIVE: { label: 'Positive / supportive', fill: '#dcfce7', border: '#86b89a' },
  NEGATIVE: { label: 'Negative / critical', fill: '#fee2e2', border: '#d99b9b' },
  OFF_TOPIC: { label: 'Off-topic insight', fill: '#dbeafe', border: '#8eb3de' },
  NEUTRAL: { label: 'Related / neutral', fill: '#e5e7eb', border: '#a6adb8' },
};
const unclassified = { label: 'Not classified', fill: '#e5e7eb', border: '#a6adb8' };
function categoryFor(node) { return categories[node.topic_position] || unclassified; }

// Explicit wrapping and dimensions keep the solver's rectangles identical to
// the rendered cards, including CJK and unbroken words. Never truncate a claim.
function wrapLabel(text) {
  const lines = []; let line = ''; let units = 0;
  for (const token of String(text).split(/(\s+)/u)) {
    const width = [...token].reduce((sum, c) => sum + (/[^\x00-\xff]/u.test(c) ? 1.1 : /[MW@%]/.test(c) ? 1 : 0.67), 0);
    if (units + width > 15 && line.trim()) { lines.push(line.trim()); line = ''; units = 0; }
    for (const c of token) {
      const size = /[^\x00-\xff]/u.test(c) ? 1.1 : /[MW@%]/.test(c) ? 1 : 0.67;
      if (units + size > 15 && line.trim()) { lines.push(line.trim()); line = ''; units = 0; }
      if (!line && /\s/u.test(c)) continue;
      line += c; units += size;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return { label: lines.join('\n'), width: 228, height: Math.max(78, lines.length * 18 + 32) };
}
function graphElements(graph) {
  return [
    ...graph.nodes.map(node => ({ data: {
      ...categoryFor(node),
      id: node.node_id, ...wrapLabel(node.normalized_statement), sources: node.sources,
      type: node.primary_type,
    } })),
    ...graph.edges.map(edge => ({ data: {
      id: edge.edge_id, source: edge.source_node_id, target: edge.target_node_id,
      label: edge.relationship_type, relationship_type: edge.relationship_type,
      evidence: edge.evidence, justification: edge.justification,
    } })),
  ];
}
const graphStyles = [
  { selector: 'node', style: {
    'background-color': 'data(fill)', 'border-color': 'data(border)', 'border-width': 1.5,
    label: 'data(label)', color: '#243244', 'font-family': 'Helvetica, Arial, sans-serif',
    'font-size': 12, 'line-height': 1.5, 'text-wrap': 'wrap', 'text-max-width': 196,
    'text-valign': 'center', 'text-halign': 'center', shape: 'round-rectangle',
    width: 'data(width)', height: 'data(height)', padding: 0,
  } },
  { selector: 'edge', style: {
    width: 1.6, 'line-color': '#8893a3', 'target-arrow-color': '#8893a3',
    'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)',
    'font-size': 9, color: '#566174', 'text-background-color': '#fff',
    'text-background-opacity': 0.95, 'text-background-padding': '3px', 'text-rotation': 'autorotate',
  } },
  { selector: 'edge[relationship_type = "SIMILAR_TO"]', style: { 'target-arrow-shape': 'none', 'line-style': 'dashed' } },
  { selector: '.dimmed', style: { opacity: 0.12 } },
  { selector: ':selected', style: { 'border-color': '#334155', 'border-width': 3 } },
];
const GAP = 42;
function overlaps(a, b) {
  return Math.abs(a.x - b.x) < (a.width + b.width) / 2 + GAP &&
    Math.abs(a.y - b.y) < (a.height + b.height) / 2 + GAP;
}
function separateRectangles(rectangles) {
  const placed = [];
  for (const rectangle of rectangles) {
    const original = { ...rectangle }; let candidate = { ...rectangle }; let attempt = 0;
    while (placed.some(other => overlaps(candidate, other))) {
      attempt++;
      const angle = attempt * 2.399963229728653;
      const radius = 24 * Math.sqrt(attempt);
      candidate = { ...original, x: original.x + Math.cos(angle) * radius, y: original.y + Math.sin(angle) * radius };
      if (attempt > 5000) {
        candidate.x = Math.max(...placed.map(r => r.x + r.width / 2)) + GAP + original.width / 2;
        candidate.y = original.y;
        break;
      }
    }
    placed.push(candidate);
  }
  return placed;
}
function fitGraph(cy) {
  if (!cy.nodes().length) return;
  cy.fit(undefined, 40);
  if (cy.zoom() > 1.1) { cy.zoom(1.1); cy.center(); }
}
function packComponents(cy) {
  const components = cy.elements().components().map(component => {
    const nodes = component.nodes();
    const left = Math.min(...nodes.map(n => n.position('x') - n.outerWidth() / 2));
    const top = Math.min(...nodes.map(n => n.position('y') - n.outerHeight() / 2));
    const right = Math.max(...nodes.map(n => n.position('x') + n.outerWidth() / 2));
    const bottom = Math.max(...nodes.map(n => n.position('y') + n.outerHeight() / 2));
    return { nodes, left, top, width: right - left, height: bottom - top };
  }).sort((a, b) => b.height - a.height);
  const aspect = Math.max(0.8, Math.min(2, cy.width() / cy.height() || 1.4));
  const area = components.reduce((sum, c) => sum + (c.width + GAP) * (c.height + GAP), 0);
  const targetWidth = Math.max(...components.map(c => c.width), Math.sqrt(area * aspect));
  const rows = []; let bottom = 0;
  for (const component of components) {
    let row = rows.find(r => r.height >= component.height && r.x + component.width <= targetWidth);
    if (!row) { row = { x: 0, y: bottom, height: component.height }; rows.push(row); bottom += row.height + GAP; }
    const dx = row.x - component.left, dy = row.y - component.top;
    component.nodes.forEach(node => node.position({ x: node.position('x') + dx, y: node.position('y') + dy }));
    row.x += component.width + GAP;
  }
}
function layoutGraph(cy) {
  const nodes = cy.nodes();
  if (!nodes.length) return;
  if (nodes.length > 200) {
    // Bounded O(n) packing for huge excerpt-only fallback maps.
    const columns = Math.ceil(Math.sqrt(nodes.length)); let y = 0;
    const width = Math.max(...nodes.map(node => node.outerWidth()));
    for (let start = 0; start < nodes.length; start += columns) {
      const row = nodes.slice(start, start + columns);
      const height = Math.max(...row.map(node => node.outerHeight()));
      row.forEach((node, column) => node.position({ x: column * (width + GAP), y: y + height / 2 }));
      y += height + GAP;
    }
  } else {
    // Stable seeds keep reset reproducible. CoSE groups related claims; the
    // final rectangle pass guarantees space even for disconnected/long cards.
    nodes.forEach((node, index) => node.position({ x: Math.cos(index * 2.39996) * 150 * Math.sqrt(index), y: Math.sin(index * 2.39996) * 150 * Math.sqrt(index) }));
    cy.layout({ name: 'cose', animate: false, fit: false, randomize: false,
      nodeDimensionsIncludeLabels: true, nodeRepulsion: 24000, idealEdgeLength: 160,
      componentSpacing: 70, nodeOverlap: 42, gravity: 0.25, numIter: 1000,
    }).run();
    const rectangles = nodes.map(node => ({ id: node.id(), ...node.position(), width: node.outerWidth(), height: node.outerHeight() }));
    for (const rectangle of separateRectangles(rectangles)) cy.getElementById(rectangle.id).position(rectangle);
    // CoSE can leave large empty bands between unrelated components. Pack those
    // as blocks without altering the relative positions of connected claims.
    packComponents(cy);
  }
  fitGraph(cy);
}
module.exports = { categories, categoryFor, wrapLabel, graphElements, graphStyles, separateRectangles, layoutGraph, fitGraph, GAP };
