'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';

type Source = { group_id: string | null; speaker_id: string | null; original_quote: string };
type MapNode = { node_id: string; normalized_statement: string; primary_type: string; sources: Source[] };
type MapEdge = { edge_id: string; source_node_id: string; target_node_id: string; relationship_type: string; justification: string };
type MapData = { nodes: MapNode[]; edges: MapEdge[] };
type Report = {
  room: {
    code: string;
    instructor_name: string | null;
    teacher_topic: string | null;
    discussion_instructions: string | null;
    duration_minutes: number | null;
    created_at: string;
  };
  groups: { id: string; name: string; members: string[]; transcript: string }[];
  overallSummary: string | null;
  contentAnalysis: {
    referenceProposition: string;
    statements: { statement_id: string; statement: string; position: 'FOR' | 'AGAINST' | 'OTHER'; sources: { group_id: string; original_quote: string }[] }[];
  } | null;
  argumentMap: MapData | null;
  generatedAt: string | null;
  stale: boolean;
};

declare global {
  interface Window { cytoscape?: (config: any) => any }
}

const API_BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export default function SessionReportPage() {
  const params = useParams();
  const roomCode = String(params.roomCode || '');
  const containerRef = useRef<HTMLDivElement>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cyReady, setCyReady] = useState(false);
  const [mapImage, setMapImage] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    setMapImage(null);
    let active = true;
    setLoading(true);
    fetch(API_BASE + '/api/rooms/' + encodeURIComponent(roomCode) + '/report', {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load session report');
        return result as Report;
      })
      .then((result) => { if (active) setReport(result); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Failed to load report'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [roomCode]);

  useEffect(() => {
    if (!cyReady || !report?.argumentMap?.nodes.length || !containerRef.current || !window.cytoscape) return;
    const graph = report.argumentMap;
    const diagram = window.cytoscape({
      container: containerRef.current,
      elements: [
        ...graph.nodes.map((node) => ({ data: { id: node.node_id, label: node.normalized_statement } })),
        ...graph.edges.map((edge) => ({ data: {
          id: edge.edge_id, source: edge.source_node_id, target: edge.target_node_id,
          label: edge.relationship_type, kind: edge.relationship_type,
        } })),
      ],
      style: [
        { selector: 'node', style: {
          'background-color': '#e7ddff', 'border-color': '#bba8e5', 'border-width': 2,
          'label': 'data(label)', 'shape': 'round-rectangle', 'padding': '14px',
          'width': 'label', 'height': 'label', 'font-size': 12, 'text-wrap': 'wrap',
          'text-max-width': 190, 'text-valign': 'center', 'text-halign': 'center', 'color': '#302550'
        } },
        { selector: 'edge', style: {
          'line-color': '#788092', 'target-arrow-color': '#788092', 'target-arrow-shape': 'triangle',
          'curve-style': 'bezier', 'width': 2, 'label': 'data(label)',
          'font-size': 10, 'text-rotation': 'autorotate', 'color': '#344054',
          'text-background-color': '#fff', 'text-background-opacity': 1
        } },
        { selector: 'edge[kind = "SIMILAR_TO"]', style: {
          'target-arrow-shape': 'none', 'line-style': 'dashed'
        } },
      ],
      layout: { name: 'cose', animate: false, fit: true, padding: 45, numIter: 750 },
    });
    let disposed = false;
    const capture = () => {
      if (disposed) return;
      try {
        diagram.fit(undefined, 45);
        const png = diagram.png({ full: true, scale: 1.8, bg: '#ffffff' });
        if (png) setMapImage(png);
      } catch {
        setMapImage(null);
      }
    };
    diagram.on('layoutstop', capture);
    // Layout can finish synchronously during initialization; also capture after the first paint.
    const frame = requestAnimationFrame(capture);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      diagram.destroy();
    };
  }, [cyReady, report]);

  function printPDF() {
    if (!report?.contentAnalysis || generating || (report.argumentMap?.nodes.length && !mapImage)) return;
    window.print();
  }

  async function generateReport() {
    setGenerating(true); setError('');
    try {
      const response = await fetch(API_BASE + '/api/rooms/' + encodeURIComponent(roomCode) + '/report/generate', {
        method: 'POST', credentials: 'include', cache: 'no-store'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to generate report');
      setMapImage(null); setReport(result);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to generate report'); }
    finally { setGenerating(false); }
  }

  const map = report?.argumentMap;
  const nodeById = new Map((map?.nodes || []).map((node) => [node.node_id, node.normalized_statement]));
  const statements = report?.contentAnalysis?.statements || [];
  function sourceNames(sources: { group_id: string | null }[]) {
    const ids = new Set(sources.map(source => source.group_id));
    return report?.groups.filter(group => ids.has(group.id)).map(group => group.name).join(', ') || 'Unknown group';
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-800">
      <Script
        src="https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js"
        strategy="afterInteractive"
        onLoad={() => setCyReady(true)}
        onError={() => setError('Unable to load the diagram renderer. Check your connection and reload before exporting.')}
      />
      <div className="no-print max-w-5xl mx-auto px-5 py-5 flex flex-wrap justify-between items-center gap-3">
        <Link href={'/instructor/' + roomCode} className="text-indigo-700 font-semibold">← Back to Instructor Dashboard</Link>
        <button onClick={() => void generateReport()} disabled={loading || generating || !report}
          className="rounded-xl border border-indigo-600 text-indigo-700 disabled:opacity-40 font-semibold px-6 py-3">
          {generating ? 'Analyzing all original transcripts…' : report?.generatedAt ? 'Refresh Full Report' : 'Generate Full Report'}
        </button>
        <button onClick={printPDF} disabled={!report?.contentAnalysis || generating || (!!map?.nodes.length && !mapImage)}
          className="rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-semibold px-6 py-3">
          {map?.nodes.length && !mapImage ? 'Preparing diagram…' : 'Export PDF / Print'}
        </button>
      </div>
      <p className="no-print max-w-5xl mx-auto px-5 pb-4 text-sm text-slate-600">Generate Full Report analyzes all groups’ saved original transcripts and makes AI calls. PDF export then prints that same saved snapshot, including the full transcript appendix.</p>
      {report?.stale && <p role="status" className="no-print max-w-5xl mx-auto px-5 pb-4 text-amber-700">Discussion data has changed since this report was generated. Refresh Full Report to include the latest content. This preview and its appendix show the saved snapshot.</p>}
      {loading && <p className="max-w-5xl mx-auto px-5">Loading saved report…</p>}
      {error && <p role="alert" className="max-w-5xl mx-auto px-5 text-red-700">{error}</p>}
      {report && (
        <article className="report-sheet max-w-5xl mx-auto bg-white shadow-sm px-8 md:px-12 py-10 mb-10">
          <div className="border-b-2 border-indigo-600 pb-5 mb-7">
            <p className="uppercase tracking-[0.2em] text-xs text-indigo-700 font-semibold">ClassDiscuss · Session Report</p>
            <h1 className="text-3xl font-bold mt-2">Classroom Discussion Report</h1>
            <p className="text-sm text-slate-500 mt-2">
              Room {report.room.code} · {new Date(report.room.created_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
              })}
            </p>
            {report.generatedAt && <p className="text-xs text-slate-500 mt-2">Report snapshot: {new Date(report.generatedAt).toLocaleString('en-US')}</p>}
          </div>

          <section className="mb-8">
            <h2 className="section-heading">Session Information</h2>
            <dl className="grid sm:grid-cols-[175px_minmax(0,1fr)] gap-x-5 gap-y-3 text-sm">
              <dt className="font-semibold text-slate-600">Instructor</dt>
              <dd>{report.room.instructor_name || 'Not provided'}</dd>
              <dt className="font-semibold text-slate-600">Discussion Topic</dt>
              <dd className="whitespace-pre-wrap">{report.room.teacher_topic || 'Not provided'}</dd>
              <dt className="font-semibold text-slate-600">Questions / Instructions</dt>
              <dd className="whitespace-pre-wrap">{report.room.discussion_instructions || 'Not provided'}</dd>
              <dt className="font-semibold text-slate-600">Groups</dt>
              <dd>{report.groups.length ? report.groups.map((group) => group.name).join(', ') : 'No groups recorded'}</dd>
            </dl>
          </section>

          <section className="mb-8">
            <h2 className="section-heading">1. Overall Summary</h2>
            {report.overallSummary
              ? <p className="whitespace-pre-wrap text-sm leading-7">{report.overallSummary}</p>
              : <p className="text-sm italic text-slate-500">Select Generate Full Report for a high-level synthesis of the entire class discussion.</p>}
          </section>

          <section className="mb-8">
            <h2 className="section-heading">2. Content Analysis</h2>
            <p className="text-sm text-slate-600 mb-4">Distinct statements and arguments across the whole class, with equivalent ideas merged and their original groups retained. A source indicates a recorded contribution, not group consensus.</p>
            {report.contentAnalysis ? (
              statements.length ? <ol className="space-y-4 text-sm">
                {statements.map((statement, index) => <li key={statement.statement_id} className="report-entry">
                  <p><strong>Statement {index + 1}.</strong> {statement.statement} <span className="font-semibold text-indigo-800">({sourceNames(statement.sources)})</span></p>
                </li>)}
              </ol> : <p className="text-sm italic text-slate-500">No substantive on-topic statements were identified in the saved transcripts.</p>
            ) : <p className="text-sm italic text-slate-500">Select Generate Full Report to extract and deduplicate statements from all original group transcripts.</p>}
          </section>

          <section className="mb-8">
            <h2 className="section-heading">3. Argument Map</h2>
            {report.contentAnalysis && <div className="mb-6 space-y-4">
              <p className="text-sm"><strong>Reference proposition:</strong> {report.contentAnalysis.referenceProposition || 'No single explicit proposition was debated. Statements are listed under Other / Mixed / Open Questions.'}</p>
              {(['FOR', 'AGAINST', 'OTHER'] as const).map(position => <div key={position} className="position-block border rounded-lg p-4">
                <h3 className="font-bold mb-2">{position === 'FOR' ? 'Supporting Views' : position === 'AGAINST' ? 'Opposing Views' : 'Other / Mixed / Open Questions'}</h3>
                {statements.some(s => s.position === position) ? <ul className="space-y-2 text-sm">
                  {statements.filter(s => s.position === position).map(s => <li key={s.statement_id}>• {s.statement} <span className="text-slate-500">({sourceNames(s.sources)})</span></li>)}
                </ul> : <p className="text-sm italic text-slate-500">No explicit statements in this category.</p>}
              </div>)}
            </div>}
            {map ? (
              <>
                <p className="text-sm text-slate-600 mb-3">{map.nodes.length} nodes · {map.edges.length} relationships</p>
                {map.nodes.length > 0 ? (
                  <>
                    <div ref={containerRef} className="no-print w-full h-[600px] border rounded-lg" aria-hidden="true" />
                    {mapImage
                      ? <img src={mapImage} alt="Saved argument relationship diagram" className="map-print-image w-full object-contain border rounded-lg" />
                      : <p className="text-xs text-slate-500 no-print">Preparing printable diagram…</p>}
                  </>
                ) : <p className="text-sm text-slate-500">No argument nodes were produced.</p>}
                <h3 className="font-bold text-base mt-6 mb-3">Graph Evidence</h3>
                <ol className="space-y-3 text-sm">
                  {map.nodes.map((node) => (
                    <li key={node.node_id} className="report-entry">
                      <strong>{node.node_id} · {node.primary_type}</strong>
                      <p className="mt-1">{node.normalized_statement}</p>
                      {(node.sources || []).map((source, index) => (
                        <p key={index} className="text-xs text-slate-600 mt-1">
                          {report.groups.find((group) => group.id === source.group_id)?.name || 'Unknown group'}
                          {source.speaker_id ? ' · ' + source.speaker_id : ''}: “{source.original_quote}”
                        </p>
                      ))}
                    </li>
                  ))}
                </ol>
                <h3 className="font-bold text-base mt-7 mb-3">Argument Relationships</h3>
                {map.edges.length ? (
                  <ol className="space-y-3 text-sm">
                    {map.edges.map((edge) => (
                      <li key={edge.edge_id} className="report-entry">
                        <strong>{edge.relationship_type}</strong>
                        <p className="mt-1">{nodeById.get(edge.source_node_id) || edge.source_node_id}</p>
                        <p className="text-slate-500 text-xs my-1">↓ {edge.relationship_type}</p>
                        <p>{nodeById.get(edge.target_node_id) || edge.target_node_id}</p>
                        {edge.justification && <p className="text-slate-600 mt-1">Reason: {edge.justification}</p>}
                      </li>
                    ))}
                  </ol>
                ) : <p className="text-sm text-slate-500">No verified relationships.</p>}
              </>
            ) : (
              <p className="text-sm italic text-slate-500">Select Generate Full Report to build the graph from the same original transcript snapshot.</p>
            )}
          </section>

          <section className="transcript-appendix mb-8">
            <h2 className="section-heading">4. Original Transcripts</h2>
            <p className="text-sm text-slate-600 mb-6">Complete saved transcription for every group, in group order. Text is not summarized, translated, or attributed to individual members. Empty and offline groups are retained.</p>
            {report.groups.map((group, index) => <div key={group.id} className="transcript-group mb-8">
              <h3 className="text-lg font-bold mb-2">Group {index + 1}: {group.name}</h3>
              <p className="text-sm mb-4"><strong>Members:</strong> {group.members?.length ? group.members.join(', ') : 'Not provided'}</p>
              <div className="transcript-text whitespace-pre-wrap break-words text-sm leading-7">{group.transcript || 'No transcription recorded for this group.'}</div>
            </div>)}
            {!report.groups.length && <p className="text-sm text-slate-500">No groups recorded.</p>}
          </section>
          <footer className="border-t pt-4 text-xs text-slate-500">
            AI-generated analysis of the saved original transcripts. Review interpretations against the source text. Source groups identify contributions and do not imply unanimous endorsement.
          </footer>
        </article>
      )}
      <style jsx global>{`
        .section-heading { font-weight: 700; font-size: 1.25rem; border-bottom: 1px solid #ddd6fe; padding-bottom: 0.5rem; margin-bottom: 1rem; color: #252044; }
        .report-entry { break-inside: avoid; page-break-inside: avoid; border-left: 3px solid #ddd6fe; padding-left: 0.75rem; }
        .map-print-image { display: none; max-height: 780px; }
        @page { size: A4; margin: 17mm; }
        @media print {
          html, body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .no-print { display: none !important; }
          .report-sheet { box-shadow: none !important; margin: 0 !important; padding: 0 !important; max-width: none !important; }
          .map-print-image { display: block !important; max-height: 230mm; break-inside: avoid; page-break-inside: avoid; }
          section { break-inside: auto; }
          h2, h3 { break-after: avoid; page-break-after: avoid; }
          .transcript-appendix { break-before: page; page-break-before: always; }
          .transcript-group + .transcript-group { break-before: page; page-break-before: always; }
          .transcript-text { white-space: pre-wrap; overflow-wrap: anywhere; orphans: 3; widows: 3; }
        }
      `}</style>
    </main>
  );
}
