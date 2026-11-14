import { categories } from '@/lib/argumentMapView';

export default function ArgumentMapLegend() {
  return <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600 my-3" aria-label="Node colors">
    {Object.entries(categories).map(([key, category]) => <span key={key} className="inline-flex items-center gap-1.5">
      <span className="inline-block w-3 h-3 rounded border" style={{ backgroundColor: category.fill, borderColor: category.border }} />{category.label}
    </span>)}
    <span>Gray also marks older or excerpt-only nodes that have not been classified. Select a node for details.</span>
  </div>;
}
