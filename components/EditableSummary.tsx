'use client';

import { useState, useEffect, useRef } from 'react';
import { type Group } from '@/lib/api';

interface Bullet {
  id: string;
  text: string;
  edited: boolean;
}

interface Props {
  group: Group;
  isEditable: boolean;
}

function parseBulletTexts(summary: string): string[] {
  return summary
    .split('\n')
    .map((l) => l.replace(/^[•\-\*]\s*/, '').trim())
    .filter(Boolean);
}

export default function EditableSummary({ group, isEditable }: Props) {
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const prevSummaryRef = useRef('');
  const idCounter = useRef(0);

  function makeId() {
    return `b-${idCounter.current++}`;
  }

  // Merge incoming AI summary with locally edited bullets
  useEffect(() => {
    if (group.summary === prevSummaryRef.current) return;
    prevSummaryRef.current = group.summary;

    const newTexts = parseBulletTexts(group.summary);

    setBullets((prev) => {
      const edited = prev.filter((b) => b.edited);
      const nonEdited = prev.filter((b) => !b.edited);

      // Replace non-edited slots with new AI bullets (positional)
      const updatedNonEdited = newTexts.slice(0, nonEdited.length).map((text, i) => ({
        id: nonEdited[i]?.id ?? makeId(),
        text,
        edited: false,
      }));

      // Any extra new bullets beyond existing non-edited count
      const extras = newTexts.slice(nonEdited.length).map((text) => ({
        id: makeId(),
        text,
        edited: false,
      }));

      // Layout: fresh AI bullets | student-edited bullets | genuinely new AI bullets
      return [...updatedNonEdited, ...edited, ...extras];
    });
  }, [group.summary]);

  function handleEdit(id: string, text: string) {
    setBullets((prev) => prev.map((b) => (b.id === id ? { ...b, text, edited: true } : b)));
  }

  function handleDelete(id: string) {
    setBullets((prev) => prev.filter((b) => b.id !== id));
  }

  function handleAdd() {
    setBullets((prev) => [...prev, { id: makeId(), text: '', edited: true }]);
  }

  // Auto-resize textarea
  function autoResize(el: HTMLTextAreaElement) {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  return (
    <div className="max-w-2xl">
      {/* Group header */}
      <div className="mb-5">
        <h2 className="text-2xl font-bold text-gray-900">{group.name}</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          {group.members.join(', ')}
          {!isEditable && (
            <span className="ml-2 text-amber-500 font-medium">(read-only view)</span>
          )}
        </p>
      </div>

      {/* Bullet list */}
      <div className="space-y-2">
        {bullets.length === 0 && (
          <p className="text-gray-300 italic text-sm">
            Select Generate AI Summary to summarize the saved discussion.
          </p>
        )}

        {bullets.map((bullet) => (
          <div key={bullet.id} className="group flex items-start gap-2">
            <span className="text-emerald-500 mt-2 flex-shrink-0 text-base">•</span>

            {isEditable ? (
              <textarea
                value={bullet.text}
                onChange={(e) => {
                  handleEdit(bullet.id, e.target.value);
                  autoResize(e.target);
                }}
                onFocus={(e) => autoResize(e.target)}
                rows={1}
                placeholder="Enter bullet point…"
                className={`flex-1 resize-none overflow-hidden bg-transparent text-sm py-1.5
                            border-b border-transparent hover:border-gray-200
                            focus:border-emerald-400 focus:outline-none leading-relaxed
                            ${bullet.edited ? 'text-blue-700' : 'text-gray-700'}`}
              />
            ) : (
              <p className="flex-1 text-sm text-gray-700 py-1.5 leading-relaxed">{bullet.text}</p>
            )}

            {isEditable && (
              <button
                onClick={() => handleDelete(bullet.id)}
                aria-label="Delete bullet"
                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400
                           transition-opacity text-lg leading-none mt-1.5 flex-shrink-0"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>

      {isEditable && (
        <button
          onClick={handleAdd}
          className="mt-4 text-sm text-emerald-600 hover:text-emerald-700 font-medium transition-colors"
        >
          + Add bullet point
        </button>
      )}

      {isEditable && bullets.some((b) => b.edited) && (
        <p className="mt-3 text-xs text-blue-400">
          Blue bullets are your edits — they won&apos;t be overwritten by AI updates.
        </p>
      )}
    </div>
  );
}
