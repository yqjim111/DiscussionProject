import { type Group } from '@/lib/api';

interface Props {
  group: Group;
  onBroadcast: () => void;
}

function parseBullets(summary: string): string[] {
  return summary
    .split('\n')
    .map((l) => l.replace(/^[•\-\*]\s*/, '').trim())
    .filter(Boolean);
}

export default function GroupCard({ group, onBroadcast }: Props) {
  const bullets = group.summary ? parseBullets(group.summary) : [];

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col gap-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 leading-tight">{group.name}</h3>
        <p className="text-sm text-gray-400 mt-0.5 truncate">{group.members.join(', ')}</p>
      </div>

      {/* Live summary bullets */}
      <div className="flex-1 min-h-[80px]">
        {bullets.length > 0 ? (
          <ul className="space-y-1.5">
            {bullets.map((b, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="text-indigo-400 flex-shrink-0 mt-0.5">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-300 italic">
            Waiting for discussion to begin…
          </p>
        )}
      </div>

      {/* Broadcast button */}
      <button
        onClick={onBroadcast}
        disabled={!group.summary}
        className="w-full py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg
                   hover:bg-indigo-700 disabled:opacity-30 transition-colors"
      >
        Broadcast to Class
      </button>
    </div>
  );
}
