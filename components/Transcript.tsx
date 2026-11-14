'use client';

import { useEffect, useRef } from 'react';

export default function Transcript({ text = '' }: { text?: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [text]);
  return <div ref={viewport} onScroll={() => {
    const element = viewport.current;
    if (element) follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
  }} className="min-h-0 flex-1 overflow-y-auto whitespace-normal break-words text-sm leading-7 text-gray-700">
    {text.replace(/\s+/g, ' ').trim() || <p className="italic text-gray-400">No transcription yet. Start recording; saved text will appear while you speak.</p>}
  </div>;
}
