'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getRoom, type Room } from '@/lib/api';
import Script from 'next/script';

type Source = { group_id: string | null; speaker_id: string | null; timestamp: string | null; source_location: string | null; original_quote: string };
type Node = { node_id: string; normalized_statement: string; primary_type: string; sources: Source[] };
type Edge = { edge_id: string; source_node_id: string; target_node_id: string; relationship_type: 'SUPPORTS' | 'ATTACKS' | 'SIMILAR_TO'; evidence: { node_id: string; original_quote: string }[]; justification: string };
type Graph = { nodes: Node[]; edges: Edge[]; groups: { id: string; name: string }[] };
declare global { interface Window { cytoscape?: (config: any) => any } }

const API_BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
const layout = () => ({ name: 'cose', animate: false, fit: true, padding: 45, nodeRepulsion: 600000, idealEdgeLength: 100, numIter: 650, gravity: 0.75 });
const styles = [
  { selector: 'node', style: { 'background-color': '#e7ddff', 'border-color': '#bba8e5', 'border-width': 2, label: 'data(label)', color: '#2d2450', 'font-size': 11, 'text-wrap': 'wrap', 'text-max-width': 190, 'text-valign': 'center', 'text-halign': 'center', 'padding': '16px', shape: 'round-rectangle', width: 'label', height: 'label', 'min-width': 140, 'min-height': 60 } },
  { selector: 'edge', style: { width: 2, 'line-color': '#788092', 'target-arrow-color': '#788092', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 10, color: '#4b5563', 'text-background-color': '#fff', 'text-background-opacity': 1, 'text-background-padding': '4px', 'text-rotation': 'autorotate' } },
  { selector: 'edge[relationship_type = "SIMILAR_TO"]', style: { 'target-arrow-shape': 'none', 'line-style': 'dashed' } },
  { selector: '.dimmed', style: { opacity: 0.12 } },
  { selector: ':selected', style: { 'border-color': '#6652bd', 'border-width': 3 } }
];

export default function ArgumentMapPage() {
  const params = useParams();
  const roomCode = String(params.roomCode || '');
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomError, setRoomError] = useState('');
  const [graph, setGraph] = useState<Graph | null>(null);
  const [groupFilter, setGroupFilter] = useState('*');
  const [details, setDetails] = useState<null | { title: string; paragraphs: string[]; quotes: { meta: string; quote: string }[] }>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getRoom(roomCode)
      .then(({ room }) => { if (!cancelled) setRoom(room); })
      .catch(() => { if (!cancelled) setRoomError('Unable to load session information.'); });
    return () => { cancelled = true; };
  }, [roomCode]);

  useEffect(() => {
    if (!graph || !ready || !window.cytoscape || !container.current) return;
    if (cy.current) cy.current.destroy();
    const instance = window.cytoscape({
      container: container.current,
      elements: [
        ...graph.nodes.map(n => ({ data: { id: n.node_id, label: n.normalized_statement, sources: n.sources, type: n.primary_type } })),
        ...graph.edges.map(e => ({ data: { id: e.edge_id, source: e.source_node_id, target: e.target_node_id, label: e.relationship_type, relationship_type: e.relationship_type, evidence: e.evidence, justification: e.justification } }))
      ],
      style: styles,
      layout: layout(),
      wheelSensitivity: 0.18,
      minZoom: 0.15,
      maxZoom: 3
    });
    cy.current = instance;
    instance.on('tap', 'node', (event: any) => {
      const node = graph.nodes.find(n => n.node_id === event.target.id());
      if (!node) return;
      setDetails({
        title: node.normalized_statement,
        paragraphs: ['Node ' + node.node_id + ' · ' + node.primary_type],
        quotes: node.sources.map(s => ({
          meta: 'Group: ' + (graph.groups.find(g => g.id === s.group_id)?.name || s.group_id || 'Unknown') +
            ' · Speaker: ' + (s.speaker_id || 'Unknown') +
            ' · Time: ' + (s.timestamp || 'Not provided'),
          quote: s.original_quote
        }))
      });
    });
    instance.on('tap', 'edge', (event: any) => {
      const edge = graph.edges.find(e => e.edge_id === event.target.id());
      if (!edge) return;
      setDetails({
        title: edge.relationship_type + ' · ' + edge.edge_id,
        paragraphs: [
          'From: ' + (graph.nodes.find(n => n.node_id === edge.source_node_id)?.normalized_statement || ''),
          'To: ' + (graph.nodes.find(n => n.node_id === edge.target_node_id)?.normalized_statement || ''),
          'Reason: ' + edge.justification
        ],
        quotes: edge.evidence.map(e => ({ meta: 'Original quote from ' + e.node_id, quote: e.original_quote }))
      });
    });
    setGroupFilter('*');
    setDetails(null);
    return () => { instance.destroy(); if (cy.current === instance) cy.current = null; };
  }, [graph, ready]);

  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;
    instance.elements().removeClass('dimmed');
    if (groupFilter === '*') return;
    instance.nodes().forEach((node: any) => {
      if (!node.data('sources').some((s: Source) => s.group_id === groupFilter)) node.addClass('dimmed');
    });
    instance.edges().forEach((edge: any) => {
      if (edge.source().hasClass('dimmed') || edge.target().hasClass('dimmed')) edge.addClass('dimmed');
    });
  }, [groupFilter, graph]);

  async function generate() {
    setError('');
    if (!room?.teacher_topic) {
      setError('This room has no saved discussion topic. Create a new session with a topic.');
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(API_BASE + '/api/rooms/' + encodeURIComponent(roomCode) + '/argument-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to analyze discussion');
      if (!Array.isArray(result.nodes) || !Array.isArray(result.edges)) throw new Error('Invalid graph response');
      setGraph(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate map');
    } finally {
      setLoading(false);
    }
  }

  function exportJSON() {
    if (!graph) return;
    const blob = new Blob([JSON.stringify({ nodes: graph.nodes, edges: graph.edges }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'argument_map_' + roomCode + '.json'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 md:p-8 text-slate-800">
      <Script src="https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js" strategy="afterInteractive" onLoad={() => setReady(true)} />
      <header className="max-w-screen-2xl mx-auto flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold">Argument Map</h1>
          <p className="text-sm text-slate-500">Room {roomCode} · Verified classroom argument network</p>
        </div>
        <Link className="text-indigo-700 font-semibold text-sm" href={'/instructor/' + roomCode}>Back to Instructor Dashboard</Link>
      </header>
      <div className="max-w-screen-2xl mx-auto grid lg:grid-cols-[320px_minmax(0,1fr)] gap-5">
        <section className="bg-white border border-slate-200 rounded-xl p-5 h-fit space-y-4">
          <h2 className="font-bold">Session information</h2>
          {roomError && <p role="alert" className="text-red-700 text-sm">{roomError}</p>}
          <div className="text-sm space-y-3">
            <div><strong>Teacher Topic</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{room?.teacher_topic || 'No topic saved for this room'}</p></div>
            <div><strong>Discussion Instructions</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{room?.discussion_instructions || 'None provided'}</p></div>
            <div><strong>Planned Duration</strong><p className="mt-1 text-slate-600">{room?.duration_minutes ? room.duration_minutes + ' minutes' : 'Not recorded'}</p></div>
          </div>
          <p className="text-xs text-slate-500">The analysis uses saved session information and original group transcripts. No additional fields are required.</p>
          <button type="button" disabled={loading || !room?.teacher_topic} onClick={generate} className="w-full rounded-lg bg-indigo-600 text-white font-semibold px-4 py-3 disabled:opacity-50">
            {loading ? 'Analyzing discussion…' : 'Generate Argument Map'}
          </button>
          {error && <p role="alert" className="text-red-700 text-sm break-words">{error}</p>}
          <p className="text-xs text-slate-500">Transcript data will be sent to the configured AI provider. Use only authorized or anonymized classroom data.</p>
        </section>
        <section className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 min-w-0">
          <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-lg">Interactive Argument Map</h2>
              <p className="text-xs text-slate-500">{graph ? graph.nodes.length + ' nodes · ' + graph.edges.length + ' verified edges' : 'No graph generated yet'}</p>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <select aria-label="Highlight group" className="border rounded-lg p-2 text-sm" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
                <option value="*">All Groups</option>
                {graph?.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button type="button" className="border rounded-lg p-2 text-sm" onClick={() => cy.current?.fit(undefined, 40)}>Fit view</button>
              <button type="button" className="border rounded-lg p-2 text-sm" onClick={() => cy.current?.layout(layout()).run()}>Reset layout</button>
              <button type="button" className="border rounded-lg p-2 text-sm" disabled={!graph} onClick={exportJSON}>Export JSON</button>
            </div>
          </div>
          <div ref={container} className="w-full rounded-xl border border-slate-200 bg-white" style={{ height: 550 }} role="img" aria-label="Interactive argument network" />
          <p className="text-xs text-slate-500 mt-3">SUPPORTS → directed · ATTACKS → directed · SIMILAR_TO — undirected. Relationship labels appear on each edge. Click a node or edge to inspect its sources.</p>
          <div className="mt-4 p-4 bg-slate-50 rounded-lg min-h-[95px] text-sm">
            {details ? <>
              <h3 className="font-bold mb-2">{details.title}</h3>
              {details.paragraphs.map((p, i) => <p key={i} className="mb-1 break-words">{p}</p>)}
              {details.quotes.map((q, i) => <blockquote key={i} className="border-l-4 border-violet-300 bg-white p-3 my-2 break-words">
                <p className="text-xs text-slate-500">{q.meta}</p><p className="whitespace-pre-wrap">{q.quote}</p>
              </blockquote>)}
            </> : <p className="text-slate-500">{graph ? 'Select a node or edge to inspect the original evidence.' : 'Generate a graph from the room transcripts to begin.'}</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
