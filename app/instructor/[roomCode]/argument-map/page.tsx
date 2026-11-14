'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getRoom, getGroups, type Room, type Group } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import DiscussionInstructions from '@/components/DiscussionInstructions';
import cytoscape from 'cytoscape';
import { graphElements, graphStyles, layoutGraph, fitGraph, categoryFor } from '@/lib/argumentMapView';
import ArgumentMapLegend from '@/components/ArgumentMapLegend';

type Source = { group_id: string | null; speaker_id: string | null; timestamp: string | null; source_location: string | null; original_quote: string };
type Node = { node_id: string; normalized_statement: string; primary_type: string; topic_position?: string; sources: Source[] };
type Edge = { edge_id: string; source_node_id: string; target_node_id: string; relationship_type: 'SUPPORTS' | 'ATTACKS' | 'SIMILAR_TO'; evidence: { node_id: string; original_quote: string }[]; justification: string };
type Graph = { nodes: Node[]; edges: Edge[]; groups: { id: string; name: string }[]; generation?: { mode: string; warning: string }; input?: { generated_at: string; groups: { id: string; name: string; characters: number }[] } };
type Job = { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed'; stage: string; error?: string };
declare global { interface Window { cytoscape?: (config: any) => any } }

const API_BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
export default function ArgumentMapPage() {
  const params = useParams();
  const roomCode = String(params.roomCode || '');
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<any>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [roomError, setRoomError] = useState('');
  const [graph, setGraph] = useState<Graph | null>(null);
  const [groupFilter, setGroupFilter] = useState('*');
  const [details, setDetails] = useState<null | { title: string; paragraphs: string[]; quotes: { meta: string; quote: string }[] }>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inputGroups, setInputGroups] = useState<Group[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const requestVersion = useRef(0);

  function applyStatus(result: { job: Job | null; graph: Graph | null }) {
    setJob(result.job);
    setLoading(result.job?.status === 'queued' || result.job?.status === 'running');
    if (result.graph) setGraph(previous => previous && previous.input?.generated_at === result.graph?.input?.generated_at ? previous : result.graph);
    if (result.job?.status === 'failed') setError(result.job.error || 'Generation failed. Please retry.');
    else setError('');
  }

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const version = requestVersion.current;
      try {
        const response = await fetch(API_BASE + '/api/rooms/' + encodeURIComponent(roomCode) + '/argument-map', { credentials: 'include', cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to read generation status');
        if (!cancelled && version === requestVersion.current) applyStatus(result);
      } catch (err) { if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to check generation status'); }
    };
    void poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [roomCode]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => Promise.all([getRoom(roomCode), getGroups(roomCode)])
      .then(([{ room }, { groups }]) => { if (!cancelled) { setRoom(room); setInputGroups(groups); setRoomError(''); } })
      .catch(() => { if (!cancelled) setRoomError('Unable to load session information and original transcripts.'); });
    void refresh();
    const socket = getSocket();
    const join = () => socket.emit('join:room', roomCode);
    const updated = ({ room }: { room: Room }) => { if (!cancelled) setRoom(room); };
    const transcript = ({ groupId, transcript }: { groupId: string; transcript: string }) => {
      setInputGroups(prev => prev.map(g => g.id === groupId ? { ...g, transcript } : g));
    };
    join(); socket.on('connect', join); socket.on('room:updated', updated); socket.on('group:transcript:update', transcript);
    const interval = setInterval(refresh, 10000);
    return () => { cancelled = true; clearInterval(interval); socket.off('connect', join); socket.off('room:updated', updated); socket.off('group:transcript:update', transcript); };
  }, [roomCode]);

  useEffect(() => {
    if (!graph || !container.current) return;
    if (cy.current) cy.current.destroy();
    const instance = cytoscape({
      container: container.current,
      elements: graphElements(graph),
      style: graphStyles as any,
      layout: { name: 'preset' },
      wheelSensitivity: 0.18,
      minZoom: 0.01,
      maxZoom: 3
    });
    cy.current = instance;
    layoutGraph(instance);
    const observer = new ResizeObserver(() => { instance.resize(); fitGraph(instance); });
    observer.observe(container.current);
    instance.on('tap', 'node', (event: any) => {
      const node = graph.nodes.find(n => n.node_id === event.target.id());
      if (!node) return;
      setDetails({
        title: node.normalized_statement,
        paragraphs: ['Node ' + node.node_id + ' · ' + node.primary_type + ' · ' + categoryFor(node).label],
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
    return () => { observer.disconnect(); instance.destroy(); if (cy.current === instance) cy.current = null; };
  }, [graph]);

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
    requestVersion.current++;
    setLoading(true);
    try {
      const response = await fetch(API_BASE + '/api/rooms/' + encodeURIComponent(roomCode) + '/argument-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to analyze discussion');
      applyStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate map');
      setLoading(false);
    }
  }

  function exportJSON() {
    if (!graph) return;
    // Preserve fallback warnings and source metadata in downloaded results too.
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'argument_map_' + roomCode + '.json'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-slate-50 p-5 md:p-8 text-slate-800">
      <header className="max-w-screen-2xl mx-auto flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold">Argument Map</h1>
          <p className="text-sm text-slate-500">Room {roomCode} · Source-grounded classroom argument network</p>
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
          </div>
          <p className="text-xs text-slate-500">The analysis uses saved session information and original group transcripts. No additional fields are required.</p>
          <DiscussionInstructions roomCode={roomCode} editable />
          <details className="text-sm border rounded-lg p-3">
            <summary className="cursor-pointer font-semibold">Input: All Groups’ Original Transcripts ({inputGroups.length} groups)</summary>
            <p className="text-xs text-slate-500 my-3">Includes offline groups. AI summaries are never used as input. Generation uses all text saved when the request begins; newer speech is included on the next generation.</p>
            {inputGroups.map(group => <div key={group.id} className="border-t py-3">
              <h3 className="font-semibold">{group.name} · {group.transcript?.length || 0} characters</h3>
              <p className="whitespace-pre-wrap break-words max-h-64 overflow-y-auto mt-2 text-slate-600">{group.transcript || 'No recorded transcript yet.'}</p>
            </div>)}
          </details>
          {graph?.input && <p className="text-xs text-slate-500">Last map input: {graph.input.groups.filter(g => g.characters > 0).length} groups with transcripts · {graph.input.groups.reduce((sum, g) => sum + g.characters, 0)} characters · {new Date(graph.input.generated_at).toLocaleTimeString()}</p>}
          <button type="button" disabled={loading || !room} onClick={generate} className="w-full rounded-lg bg-indigo-600 text-white font-semibold px-4 py-3 disabled:opacity-50">
            {loading ? 'Generating in Background…' : graph ? 'Regenerate Argument Map' : 'Generate Argument Map'}
          </button>
          {loading && <p role="status" className="text-sm text-indigo-700">{job?.stage || 'Queueing task…'} You can return to the dashboard; this task will continue. Reopen this page to see the result.</p>}
          {graph?.generation?.warning && <p role="status" className="text-sm text-amber-800 bg-amber-50 rounded-lg p-3">{graph.generation.warning}</p>}
          {error && <p role="alert" className="text-red-700 text-sm break-words">{error}</p>}
          <p className="text-xs text-slate-500">Transcript data will be sent to the configured AI provider. Use only authorized or anonymized classroom data.</p>
        </section>
        <section className="bg-white border border-slate-200 rounded-xl p-4 md:p-5 min-w-0">
          <div className="flex flex-wrap gap-3 items-center justify-between mb-4">
            <div>
              <h2 className="font-bold text-lg">Interactive Argument Map</h2>
              <p className="text-xs text-slate-500">{graph ? graph.nodes.length + ' nodes · ' + graph.edges.length + ' relationships' + (graph.generation?.mode === 'extractive_fallback' ? ' · Original-excerpt fallback' : '') : 'No graph generated yet'}</p>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <select aria-label="Highlight group" className="border rounded-lg p-2 text-sm" value={groupFilter} onChange={e => setGroupFilter(e.target.value)}>
                <option value="*">All Groups</option>
                {graph?.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button type="button" className="border rounded-lg p-2 text-sm" onClick={() => cy.current && fitGraph(cy.current)}>Fit view</button>
              <button type="button" className="border rounded-lg p-2 text-sm" onClick={() => cy.current && layoutGraph(cy.current)}>Reset layout</button>
              <button type="button" className="border rounded-lg p-2 text-sm" disabled={!graph} onClick={exportJSON}>Export JSON</button>
            </div>
          </div>
          <ArgumentMapLegend />
          <div ref={container} className="w-full rounded-xl border border-slate-200 bg-white" style={{ height: 550 }} role="img" aria-label="Interactive argument network" />
          {graph && !graph.nodes.length && <p className="text-sm text-slate-600 mt-3">No substantive argument statements were identified. The original transcripts remain available in the input panel; no arguments or relationships have been invented.</p>}
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
