'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import ThematicAnalysis, { type ThematicData } from '@/components/ThematicAnalysis';
import { categories } from '@/lib/argumentMapView';
import { renderMapSvg, reportMarkdown, zipFiles } from '@/lib/reportExport';

type Source = { group_id: string | null; speaker_id: string | null; original_quote: string };
type MapNode = { node_id: string; normalized_statement: string; primary_type: string; topic_position?: string | null; sources: Source[] };
type MapEdge = { edge_id: string; source_node_id: string; target_node_id: string; relationship_type: string; justification: string };
type MapData = { nodes: MapNode[]; edges: MapEdge[]; generation?: { mode: string; warning: string } };
type Report = {
  room: {
    code: string;
    instructor_name: string | null;
    teacher_topic: string | null;
    discussion_instructions: string | null;
    duration_minutes: number | null;
    created_at: string;
  };
  groups: { id: string; name: string; members: string[]; transcript: string; manualPoints?: { id: string; text: string }[] }[];
  overallSummary: string | null;
  contentAnalysis: {
    statements: { statement_id: string; statement: string; position: string | null; sources: { group_id: string; original_quote: string }[] }[];
  } | null;
  argumentMap: MapData | null;
  thematicAnalysis?: ThematicData | null;
  generatedAt: string | null;
  stale: boolean;
  summaryWarning?: string;
  sourceSnapshotAvailable?: boolean;
  mapVersion?: string | null;
  reportPending?: boolean;
  reportError?: string;
  job?: { id: string; status: string; stage: string; error?: string } | null;
};

const API_BASE = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export default function SessionReportPage() {
  const params = useParams();
  const roomCode = String(params.roomCode || '');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [mapImage, setMapImage] = useState<string | null>(null);
  const [mapSvg, setMapSvg] = useState<string | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const [generating, setGenerating] = useState(false);
  const requestVersion = useRef(0);

  function applyReport(result: Report) {
    setReport(previous => ({ ...result,
      // Status polling must not recreate the SVG when its graph is unchanged.
      argumentMap: previous && result.mapVersion && previous.mapVersion === result.mapVersion ? previous.argumentMap : result.argumentMap,
    }));
    setGenerating(Boolean(result.reportPending));
    setError(result.reportError || '');
  }

  useEffect(() => {
    let active = true;
    let autoRequested = false;
    const generateOnOpen = new URLSearchParams(window.location.search).get('generate') === '1';
    setLoading(true);
    const poll = async () => {
      const version = requestVersion.current;
      try {
        const response = await fetch(API_BASE + '/api/rooms/' + encodeURIComponent(roomCode) + '/report', { credentials: 'include', cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load session report');
        if (active && version === requestVersion.current) {
          applyReport(result);
          if (generateOnOpen && !autoRequested) { autoRequested = true; await generateReport(false); }
        }
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'Failed to load report'); }
      finally { if (active) setLoading(false); }
    };
    void poll();
    const interval = setInterval(poll, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [roomCode]);

  useEffect(() => {
    setMapImage(null); setMapSvg(null);
    if (!report?.argumentMap) return;
    try {
      const svg = renderMapSvg(report.argumentMap);
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      setMapSvg(svg); setMapImage(url);
      return () => URL.revokeObjectURL(url);
    } catch { setError('Unable to render the saved map. Please reload the report.'); }
  }, [report?.argumentMap]);

  function exportMarkdown() {
    if (!report?.argumentMap || !mapSvg) return;
    const files: Record<string, string> = { 'report.md': reportMarkdown(report), 'argument-map.svg': mapSvg };
    if (articleRef.current) {
      const clone = articleRef.current.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('img.map-static-image').forEach(img => img.setAttribute('src', 'argument-map.svg'));
      const css = Array.from(document.styleSheets).map(sheet => {
        try { return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n'); } catch { return ''; }
      }).join('\n');
      files['report.html'] = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ClassDiscuss Report</title><style>' + css + '</style></head><body class="font-sans"><div class="role-theme role-instructor bg-slate-100 py-6">' + clone.outerHTML + '</div></body></html>';
    }
    const archive = zipFiles(files);
    const url = URL.createObjectURL(new Blob([archive.buffer as ArrayBuffer], { type: 'application/zip' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'discussion-report-' + roomCode + '.zip'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function generateReport(refreshSummary = Boolean(report?.overallSummary && report?.thematicAnalysis?.status === 'completed')) {
    requestVersion.current++;
    setGenerating(true); setError('');
    try {
      const response = await fetch(API_BASE + '/api/rooms/' + encodeURIComponent(roomCode) + '/report/generate', {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshSummary })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to generate report');
      applyReport(result);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to generate report'); setGenerating(false); }
  }

  const map = report?.argumentMap;
  const statements = report?.contentAnalysis?.statements || [];
  function sourceNames(sources: { group_id: string | null }[]) {
    const ids = new Set(sources.map(source => source.group_id));
    return report?.groups.filter(group => ids.has(group.id)).map(group => group.name).join(', ') || 'Unknown group';
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-800">
      <div className="no-print max-w-5xl mx-auto px-5 py-5 flex flex-wrap justify-between items-center gap-3">
        <Link href={'/instructor/' + roomCode} className="text-indigo-700 font-semibold">← Back to Instructor Dashboard</Link>
        <button onClick={() => void generateReport()} disabled={loading || generating || !report}
          className="rounded-xl border border-indigo-600 text-indigo-700 disabled:opacity-40 font-semibold px-6 py-3">
          {generating ? 'Generating report…' : report?.overallSummary && report?.thematicAnalysis?.status === 'completed' ? 'Refresh report' : 'Generate Report'}
        </button>
        <button onClick={exportMarkdown} disabled={!mapSvg || generating}
          className="rounded-xl border border-indigo-600 text-indigo-700 disabled:opacity-40 font-semibold px-6 py-3">Export Markdown ZIP</button>
      </div>
      <p className="no-print max-w-5xl mx-auto px-5 pb-4 text-sm text-slate-600">Generate Report creates a shared Argument Map when needed, or reuses the saved map. Markdown exports use the same statements and graph, with an HTML copy of the page formatting.</p>
      {report?.stale && <p role="status" className="no-print max-w-5xl mx-auto px-5 pb-4 text-amber-700">Discussion data has changed since the saved Argument Map. Regenerate it from the Argument Map page to update this report. Exports keep the saved map and its transcript snapshot.</p>}
      {report && !map && <p className="no-print max-w-5xl mx-auto px-5 pb-4"><Link className="text-indigo-700 underline" href={'/instructor/' + roomCode + '/argument-map'}>Open Argument Map</Link></p>}
      {generating && <p role="status" className="no-print max-w-5xl mx-auto px-5 pb-4 text-indigo-700">{report?.job?.stage || 'Queueing generation…'} You can leave this page; generation continues in the background. The same map will appear on the Argument Map page.</p>}
      {report?.summaryWarning && <p role="status" className="no-print max-w-5xl mx-auto px-5 pb-4 text-amber-700">{report.summaryWarning}</p>}
      {map && report?.sourceSnapshotAvailable === false && <p role="status" className="no-print max-w-5xl mx-auto px-5 pb-4 text-amber-700">This older map has no complete saved input snapshot. The appendix shows currently saved transcripts; regenerate the map to capture a matching snapshot.</p>}
      {loading && <p className="max-w-5xl mx-auto px-5">Loading saved report…</p>}
      {error && <p role="alert" className="max-w-5xl mx-auto px-5 text-red-700">{error}</p>}
      {report && (
        <article ref={articleRef} className="report-sheet max-w-5xl mx-auto bg-white shadow-sm px-8 md:px-12 py-10 mb-10">
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
              : <p className="text-sm italic text-slate-500">Select Generate Report to add a high-level synthesis.</p>}
          </section>

          <section className="mb-8">
            <h2 className="section-heading">2. Content Analysis</h2>
            {report.contentAnalysis ? (
              statements.length ? <ol className="space-y-4 text-sm">
                {statements.map((statement, index) => <li key={statement.statement_id} className="report-entry">
                  <p><strong>Statement {index + 1}.</strong> {statement.statement} <span className="font-semibold text-indigo-800">({sourceNames(statement.sources)})</span></p>
                </li>)}
              </ol> : <p className="text-sm italic text-slate-500">No statements in the saved map.</p>
            ) : <p className="text-sm italic text-slate-500">Select Generate Report or generate an Argument Map to populate these statements.</p>}
          </section>

          <section className="mb-8">
            <h2 className="section-heading">3. Argument Map</h2>
            {map && <div className="mb-6 space-y-4">
              {Object.entries(categories).map(([position, category]) => <div key={position} className="position-block border rounded-lg p-4" style={{ borderColor: category.border }}>
                <h3 className="font-bold mb-2">{category.label}</h3>
                {map.nodes.some(n => n.topic_position === position) ? <ul className="space-y-2 text-sm">
                  {map.nodes.filter(n => n.topic_position === position).map(n => <li key={n.node_id}>• {n.normalized_statement} <span className="text-slate-500">({sourceNames(n.sources)})</span></li>)}
                </ul> : <p className="text-sm italic text-slate-500">No statements in this category.</p>}
              </div>)}
            </div>}
            {map ? (
              <>
                {map.generation?.warning && <p className="text-sm text-amber-800 mb-4">{map.generation.warning}</p>}
                <p className="text-sm text-slate-600 mb-3">{map.nodes.length} nodes · {map.edges.length} relationships</p>
                {mapImage ? <img src={mapImage} onError={() => { setError('Unable to load the map image.'); }} alt="Complete saved Argument Map" className="map-static-image w-full object-contain border rounded-lg" />
                  : <p className="text-xs text-slate-500 no-print">Preparing static diagram…</p>}
              </>
            ) : (
              <p className="text-sm italic text-slate-500">Select Generate Report to create the shared Argument Map. An existing map will be reused without a second analysis.</p>
            )}
          </section>

          <div className="mb-8 border-t pt-6"><ThematicAnalysis analysis={report.thematicAnalysis} /></div>

          <section className="transcript-appendix mb-8">
            <h2 className="section-heading">4. Original Transcripts</h2>
            {report.groups.map((group, index) => <div key={group.id} className="transcript-group mb-8">
              <h3 className="text-lg font-bold mb-2">Group {index + 1}: {group.name}</h3>
              <p className="text-sm mb-4"><strong>Members:</strong> {group.members?.length ? group.members.join(', ') : 'Not provided'}</p>
              <div className="transcript-text whitespace-normal break-words text-sm leading-7">{group.transcript || 'No transcription recorded for this group.'}</div>
              {group.manualPoints?.some(p => p.text.trim()) && <div className="mt-4"><h4 className="font-semibold text-sm mb-2">Student-written Contributions</h4><ul className="space-y-2 text-sm">{group.manualPoints.filter(p => p.text.trim()).map(p => <li key={p.id} className="whitespace-pre-wrap break-words">• {p.text}</li>)}</ul></div>}
            </div>)}
            {!report.groups.length && <p className="text-sm text-slate-500">No groups recorded.</p>}
          </section>
        </article>
      )}
      <style jsx global>{`
        .section-heading { font-weight: 700; font-size: 1.25rem; border-bottom: 1px solid #ddd6fe; padding-bottom: 0.5rem; margin-bottom: 1rem; color: #252044; }
        .report-entry { break-inside: avoid; page-break-inside: avoid; border-left: 3px solid #ddd6fe; padding-left: 0.75rem; }
        .map-static-image { display: block; height: auto; }
      `}</style>
    </main>
  );
}
