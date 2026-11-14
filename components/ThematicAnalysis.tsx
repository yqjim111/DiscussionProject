export type ThematicSource = { source_id: string; group_id: string; group_name?: string; original_quote: string; source_kind?: string };
type Code = { code_id: string; label: string; meaning: string; source_ids: string[]; sources: ThematicSource[] };
type Evidence = { code_ids: string[]; sources: ThematicSource[]; group_ids: string[] };
export type ThematicData = {
  status: 'completed' | 'unavailable'; generated_at: string; last_attempt_at?: string; warning?: string; review_status: string;
  codes: Code[];
  themes: (Evidence & { theme_id: string; name: string; central_concept: string; definition: string; inclusion: string; exclusion: string; qualifications: string; topic_relevance: string; development: string })[];
  axes: { axis_id: string; name: string; dimension: string; relationship: string; left_pole: Evidence & { label: string; definition: string }; right_pole: Evidence & { label: string; definition: string }; theme_ids: string[]; rationale: string; qualifications: string }[];
  unassigned_code_ids: string[]; alternative_interpretations: string[]; limitations: string[]; review_questions: string[];
};

export default function ThematicAnalysis({ analysis, onGenerate, busy = false, stage }: { analysis?: ThematicData | null; onGenerate?: () => void; busy?: boolean; stage?: string }) {
  const codes = new Map((analysis?.codes || []).map(c => [c.code_id, c]));
  function sources(items: ThematicSource[]) {
    return <div className="space-y-2 mt-3">{items.map(source => <blockquote key={source.source_id} className="border-l-2 border-orange-200 pl-3 text-sm break-words">
      <p className="text-xs text-slate-500">{source.group_name || source.group_id} · {source.source_kind === 'manual' ? 'Student-written point' : 'Original transcription'}</p>
      <p className="whitespace-pre-wrap">{source.original_quote}</p>
    </blockquote>)}</div>;
  }
  return <section className="thematic-analysis space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-bold text-xl">Thematic Analysis</h2>
      {onGenerate && <button onClick={onGenerate} disabled={busy} className="rounded-xl bg-indigo-600 text-white font-semibold px-4 py-2 disabled:opacity-40">
        {busy ? 'Generating…' : analysis?.status === 'completed' ? 'Regenerate Thematic Analysis' : 'Generate Thematic Analysis'}
      </button>}
    </div>
    {busy && <p role="status" className="text-sm text-indigo-700">{stage || 'Generating in the background…'} You can leave and return to this page.</p>}
    {!analysis && <p className="text-sm text-slate-600">Thematic analysis has not been generated for this saved discussion.</p>}
    {analysis && <>
      <p className="text-sm text-slate-600">AI-assisted draft · Review themes and both axis poles against the original evidence. Axes describe interpretive contrasts, not scores or groups of students.</p>
      {analysis.warning && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{analysis.warning}</p>}
      {analysis.status === 'completed' && <>
        <h3 className="font-bold text-lg">Themes</h3>
        {!analysis.themes.length && <p className="text-sm text-slate-500">No defensible theme pattern was identified in this input.</p>}
        <div className="grid md:grid-cols-2 gap-4">{analysis.themes.map(theme => <article key={theme.theme_id} className="rounded-xl border border-slate-200 p-4 space-y-3 min-w-0">
          <h4 className="font-bold">{theme.name}</h4>
          <p className="text-xs text-slate-500">{theme.development === 'CANDIDATE' ? 'Tentative candidate' : 'Developing pattern'} · {theme.topic_relevance.replace(/_/g, ' ')} · {theme.group_ids.length} source groups</p>
          <p className="text-sm"><strong>Central concept:</strong> {theme.central_concept}</p>
          <p className="text-sm">{theme.definition}</p>
          <p className="text-sm"><strong>Includes:</strong> {theme.inclusion}</p>
          <p className="text-sm"><strong>Excludes:</strong> {theme.exclusion}</p>
          {theme.qualifications && <p className="text-sm"><strong>Qualifications:</strong> {theme.qualifications}</p>}
          <details className="text-sm"><summary className="font-semibold cursor-pointer">Codes and original evidence</summary>
            {theme.code_ids.map(id => <div key={id} className="mt-3"><strong>{codes.get(id)?.label}</strong><p>{codes.get(id)?.meaning}</p></div>)}
            {sources(theme.sources)}
          </details>
        </article>)}</div>
        <h3 className="font-bold text-lg">Axes · Two Poles</h3>
        {!analysis.axes.length && <p className="text-sm text-slate-600">No two-pole axis is supported by this discussion. A missing opposite is not invented.</p>}
        {analysis.axes.map(axis => <article key={axis.axis_id} className="rounded-xl border border-slate-200 p-4 space-y-3">
          <h4 className="font-bold">{axis.name}</h4>
          <p className="text-sm"><strong>Dimension:</strong> {axis.dimension} · {axis.relationship === 'TENSION' ? 'Coexisting priorities / tension' : 'Continuum'}</p>
          <div className="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-start">
            {[axis.left_pole, axis.right_pole].map((pole, i) => <div key={i} className={i ? 'md:col-start-3 rounded-lg bg-slate-50 p-4 min-w-0' : 'rounded-lg bg-slate-50 p-4 min-w-0'}>
              <h5 className="font-semibold">{pole.label}</h5><p className="text-sm mt-2">{pole.definition}</p>
              <details className="text-sm mt-3"><summary className="cursor-pointer font-semibold">Supporting original evidence</summary>{sources(pole.sources)}</details>
            </div>)}
          </div>
          <p className="text-center text-slate-500 text-sm">{axis.left_pole.label} ↔ {axis.right_pole.label}</p>
          <p className="text-sm"><strong>Why this axis:</strong> {axis.rationale}</p>
          {axis.qualifications && <p className="text-sm"><strong>Intermediate / both-and positions:</strong> {axis.qualifications}</p>}
        </article>)}
        {analysis.unassigned_code_ids.length > 0 && <details className="text-sm"><summary className="cursor-pointer font-semibold">Unassigned meanings / minority observations ({analysis.unassigned_code_ids.length})</summary>
          {analysis.unassigned_code_ids.map(id => <div key={id} className="mt-3"><strong>{codes.get(id)?.label}</strong><p>{codes.get(id)?.meaning}</p>{sources(codes.get(id)?.sources || [])}</div>)}
        </details>}
        {(['alternative_interpretations', 'limitations', 'review_questions'] as const).map(key => analysis[key].length > 0 && <div key={key}>
          <h3 className="font-bold">{key === 'alternative_interpretations' ? 'Alternative interpretations' : key === 'limitations' ? 'Limitations' : 'Questions for instructor review'}</h3>
          <ul className="list-disc pl-5 text-sm space-y-1 mt-2">{analysis[key].map((item, i) => <li key={i}>{item}</li>)}</ul>
        </div>)}
      </>}
    </>}
  </section>;
}
