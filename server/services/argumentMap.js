'use strict';

const NODE_TYPES = new Set(['CLAIM', 'EVIDENCE', 'EXAMPLE', 'PROPOSAL', 'QUESTION', 'UNCLASSIFIED']);
const EDGE_TYPES = new Set(['SUPPORTS', 'ATTACKS', 'SIMILAR_TO']);

function originalQuote(text, quote) {
  if (typeof quote !== 'string' || !quote.trim()) return null;
  if (text.includes(quote)) return quote;
  // Only whitespace differences can be repaired mechanically. Never paraphrase,
  // change punctuation, or accept approximate semantic matches as evidence.
  const escaped = quote.trim().split(/\s+/u).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.match(new RegExp(escaped.join('\\s+'), 'u'))?.[0] || null;
}

function validateGraph(graph, transcript, allowedGroups) {
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('AI returned invalid graph structure');
  }
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (!node.node_id || nodes.has(node.node_id) || !NODE_TYPES.has(node.primary_type)
      || !node.normalized_statement?.trim() || !Array.isArray(node.sources) || !node.sources.length) {
      throw new Error('Invalid, duplicate, or ungrounded node');
    }
    for (const source of node.sources) {
      // Quotes must belong to the cited group's raw text, not to a summary,
      // group header, or a different group's transcript.
      const groupText = allowedGroups.get(source.group_id);
      const quote = typeof groupText === 'string' ? originalQuote(groupText, source.original_quote) : null;
      if (!quote) throw new Error('Node ' + node.node_id + ': quotation not found in the cited group transcript; copy an exact original quote and its Group ID.');
      const previousQuote = source.original_quote;
      source.original_quote = quote;
      for (const edge of graph.edges) {
        for (const item of edge.evidence || []) {
          if (item.node_id === node.node_id && item.original_quote === previousQuote) item.original_quote = quote;
        }
      }
      // Group-level raw transcription has no reliable speaker, time or position.
      if (source.speaker_id !== null || source.timestamp !== null || source.source_location !== null) {
        throw new Error('Unprovided speaker, timestamp or source location');
      }
    }
    nodes.set(node.node_id, node);
  }
  const pairs = new Set();
  const edgeIds = new Set();
  for (const edge of graph.edges) {
    if (!edge.edge_id || edgeIds.has(edge.edge_id) || !EDGE_TYPES.has(edge.relationship_type)
      || !nodes.has(edge.source_node_id) || !nodes.has(edge.target_node_id)
      || edge.source_node_id === edge.target_node_id || !edge.justification?.trim()) {
      throw new Error('Invalid edge, relationship, direction, or endpoint');
    }
    edgeIds.add(edge.edge_id);
    const pair = [edge.source_node_id, edge.target_node_id].sort().join('|');
    if (pairs.has(pair)) throw new Error('Duplicate relationship for an unordered node pair');
    pairs.add(pair);
    if (!Array.isArray(edge.evidence) || !edge.evidence.length) throw new Error('Missing edge evidence');
    for (const item of edge.evidence) {
      if (![edge.source_node_id, edge.target_node_id].includes(item.node_id)
        || !item.original_quote?.trim()
        || !nodes.get(item.node_id).sources.some(s => s.original_quote === item.original_quote)) {
        throw new Error('Edge evidence does not match its node source');
      }
    }
  }
  return graph;
}

async function analyzeArgumentMap(input) {
  return require('./argumentMapIndexed').analyzeArgumentMap(input);
}

module.exports = { analyzeArgumentMap, validateGraph, originalQuote };
