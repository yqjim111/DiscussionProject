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
  return <section className="thematic-analysis space-y-5 text-base">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-bold">Thematic Analysis</h2>
      {onGenerate && <button onClick={onGenerate} disabled={busy} className="rounded-xl bg-indigo-600 text-white font-semibold px-4 py-2 disabled:opacity-40">
        {busy ? 'Generating…' : analysis?.status === 'completed' ? 'Regenerate Thematic Analysis' : 'Generate Thematic Analysis'}
      </button>}
    </div>
    {busy && <p role="status" className="text-sm text-indigo-700">{stage || 'Generating in the background…'} You can leave and return to this page.</p>}
    {!analysis && <p className="text-sm text-slate-600">Thematic analysis has not been generated for this saved discussion.</p>}
    {analysis && <>
      {analysis.warning && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{analysis.warning}</p>}
      {analysis.status === 'completed' && <>
        <h3 className="font-bold">Themes</h3>
        {!analysis.themes.length && <p>No themes identified.</p>}
        <div className="space-y-5">{analysis.themes.map(theme => <article key={theme.theme_id} className="space-y-2">
          <h4 className="font-semibold">{theme.name}</h4>
          <p className="leading-relaxed">{theme.definition}</p>
          <p className="text-sm"><strong>Conditions and boundaries:</strong> {theme.qualifications}</p>
          <details className="text-sm"><summary className="cursor-pointer text-indigo-700">Original evidence</summary>{theme.sources.map((source, i) => <blockquote key={i} className="whitespace-pre-wrap border-l-2 pl-3 my-2"><strong>{source.group_name || source.group_id}</strong><br />{source.original_quote}</blockquote>)}</details>
        </article>)}</div>
        <h3 className="font-bold">Axes</h3>
        {!analysis.axes.length && <p>No axes identified.</p>}
        <div className="space-y-5">{analysis.axes.map(axis => <article key={axis.axis_id} className="space-y-2">
          <h4 className="font-semibold">{axis.left_pole.label} ↔ {axis.right_pole.label}</h4>
          <p className="leading-relaxed">{axis.left_pole.definition} {axis.right_pole.definition}</p>
        </article>)}</div>
      </>}
    </>}
  </section>;
}
