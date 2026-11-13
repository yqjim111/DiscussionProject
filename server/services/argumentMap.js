'use strict';

const fs = require('fs');
const path = require('path');
const OpenAI = require('openai').OpenAI;

const NODE_TYPES = new Set(['CLAIM', 'EVIDENCE', 'EXAMPLE', 'PROPOSAL', 'QUESTION', 'UNCLASSIFIED']);
const EDGE_TYPES = new Set(['SUPPORTS', 'ATTACKS', 'SIMILAR_TO']);
const PROMPT_PATH = path.join(__dirname, '..', 'prompts', 'argument_map_prompt.txt');

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const sourceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['group_id', 'speaker_id', 'timestamp', 'source_location', 'original_quote'],
  properties: {
    group_id: nullableString,
    speaker_id: nullableString,
    timestamp: nullableString,
    source_location: nullableString,
    original_quote: { type: 'string' }
  }
};
const schema = {
  type: 'object',
  additionalProperties: false,
  required: ['nodes', 'edges'],
  properties: {
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['node_id', 'normalized_statement', 'primary_type', 'sources'],
        properties: {
          node_id: { type: 'string' },
          normalized_statement: { type: 'string' },
          primary_type: { type: 'string', enum: [...NODE_TYPES] },
          sources: { type: 'array', items: sourceSchema }
        }
      }
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['edge_id', 'source_node_id', 'target_node_id', 'relationship_type', 'evidence', 'justification'],
        properties: {
          edge_id: { type: 'string' },
          source_node_id: { type: 'string' },
          target_node_id: { type: 'string' },
          relationship_type: { type: 'string', enum: [...EDGE_TYPES] },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['node_id', 'original_quote'],
              properties: {
                node_id: { type: 'string' },
                original_quote: { type: 'string' }
              }
            }
          },
          justification: { type: 'string' }
        }
      }
    }
  }
};

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
      if (!source.original_quote?.trim() || !transcript.includes(source.original_quote)) {
        throw new Error('Node quotation not found in original transcript');
      }
      if (source.group_id != null && !allowedGroups.has(source.group_id)) {
        throw new Error('Unrecognized source group');
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

async function analyzeArgumentMap({ topic, instructions, groups }) {
  const transcript = groups
    .map(g => 'Group ID: ' + g.id + '\nGroup name: ' + g.name + '\nTranscript:\n' + g.transcript)
    .join('\n\n-----\n\n');
  const allowedGroups = new Set(groups.map(g => g.id));
  const approvedPrompt = fs.readFileSync(PROMPT_PATH, 'utf8');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: process.env.ARGUMENT_MAP_MODEL || 'gpt-4o-mini',
    temperature: 0,
    max_tokens: 12000,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'classroom_argument_map', strict: true, schema }
    },
    messages: [
      { role: 'system', content: approvedPrompt +
        '\n\nExecution context: Return ONLY the Part A strict JSON for server-side rendering, ' +
        'not HTML or an explanation. Group IDs are exactly the Group ID values given below. ' +
        'The supplied raw transcripts have no verified speaker IDs, timestamps or source locations: ' +
        'set those three fields to null, never infer them. Original quotes must be exact substrings ' +
        'of the supplied transcript. Follow both edge-identification and edge-verification stages.' },
      { role: 'user', content: JSON.stringify({
        teacher_topic: topic,
        discussion_instructions: instructions || '',
        discussion_transcript: transcript,
        discussion_metadata: groups.map(g => ({ group_id: g.id, group_name: g.name, speaker_id: null, timestamp: null }))
      }) }
    ]
  });
  const msg = response.choices[0]?.message;
  if (!msg?.content || msg.refusal || response.choices[0]?.finish_reason !== 'stop') {
    throw new Error('Model did not produce a complete graph');
  }
  return validateGraph(JSON.parse(msg.content), transcript, allowedGroups);
}

module.exports = { analyzeArgumentMap, validateGraph };
