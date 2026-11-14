import { type Group } from '@/lib/api';

interface Props {
  group: Group;
  onBroadcast: () => void;
  onView: () => void;
}

function parseBullets(summary: string): string[] {
  return summary
    .split('\n')
    .map((l) => l.replace(/^[•\-\*]\s*/, '').trim())
    .filter(Boolean);
}

export default function GroupCard({ group, onBroadcast, onView }: Props) {
  const bullets = group.summary ? parseBullets(group.summary) : [];

  return (
    <div className={`rounded-xl border shadow-sm p-5 flex flex-col gap-4 ${group.online ? 'bg-white border-gray-100' : 'bg-gray-100 border-gray-300'}`}>
      {/* Header */}
      <div>
        <h3 className="text-lg font-bold text-gray-900 leading-tight"><button onClick={onView} className="text-left hover:underline">{group.name}</button></h3>
        <p className={`text-xs font-semibold mt-1 ${group.online ? 'text-emerald-700' : 'text-gray-500'}`}>{group.online ? 'Online' : 'Offline · saved discussion retained'}</p>
        <p className="text-sm text-gray-400 mt-0.5 truncate">{group.members.join(', ')}</p>
      </div>

      {/* Live summary bullets */}
      <div className="flex-1 min-h-[80px]">
        {bullets.length > 0 ? (
          <ul className="space-y-1.5">
            {bullets.slice(0, 4).map((b, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="text-indigo-400 flex-shrink-0 mt-0.5">•</span>
                <span className="line-clamp-3 break-words">{b}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-gray-300 italic">
            Waiting for students to select Generate AI Summary…
          </p>
        )}
      </div>

      <button onClick={onView} className="text-left font-semibold text-orange-700 text-sm">View Group{bullets.length > 4 ? ` · ${bullets.length - 4} more points` : ''} →</button>

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
