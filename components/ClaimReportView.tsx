'use client';
import { useEffect, useRef } from 'react';
import { claimReportHtml } from '@/lib/claimReportExport';
import { initOverallMaps } from '@/lib/overallMapView';
import { REPORT_PIPELINE_VERSION } from '@/lib/reportVersion';

// Isolate the portable report's typography while retaining native details and
// in-page navigation. The HTML generator escapes every piece of source text.
export default function ClaimReportView({ report }: { report: unknown }) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef(report); current.current = report;
  const version = (report as { mapVersion?: string | null }).mapVersion;
  useEffect(() => {
    if (!host.current) return;
    const root = host.current.shadowRoot || host.current.attachShadow({ mode: 'open' });
    const html = claimReportHtml(current.current);
    const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';
    const content = html.match(/<main>([\s\S]*?)<\/main>/)?.[1] || '';
    root.innerHTML = '<style>:host{display:block;color:#213047;font:16px/1.7 system-ui,sans-serif;background:#f2f4f7}' + css + '</style><main>' + content + '</main>';
    const disposeMaps = initOverallMaps(root);
    const reveal = (id: string) => {
      const target = root.getElementById(id);
      if (!target) return;
      let parent: HTMLElement | null = target;
      while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const click = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      const button = element?.closest('button');
      if (button?.id === 'expand-claims' || button?.id === 'collapse-claims') {
        root.querySelectorAll<HTMLDetailsElement>('details.claim').forEach(d => { d.open = button.id === 'expand-claims'; }); return;
      }
      if (button?.id === 'expand-transcripts' || button?.id === 'collapse-transcripts') {
        root.querySelectorAll<HTMLDetailsElement>('details.transcript-group').forEach(d => { d.open = button.id === 'expand-transcripts'; }); return;
      }
      const anchor = element?.closest('a');
      const id = anchor?.getAttribute('data-open-target') || (anchor?.getAttribute('href')?.startsWith('#') ? anchor.getAttribute('href')?.slice(1) : null);
      if (id) { event.preventDefault(); reveal(id); }
    };
    root.addEventListener('click', click);
    if (window.location.hash) reveal(decodeURIComponent(window.location.hash.slice(1)));
    return () => { root.removeEventListener('click', click); disposeMaps(); };
  }, [version]);
  return <div ref={host} className="claim-report-view" data-report-pipeline={REPORT_PIPELINE_VERSION} />;
}
