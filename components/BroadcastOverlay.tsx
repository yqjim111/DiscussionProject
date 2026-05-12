interface BroadcastData {
  groupId: string;
  groupName: string;
  summary: string;
}

interface Props {
  data: BroadcastData;
  onDismiss: () => void;
}

function parseBullets(summary: string): string[] {
  return summary
    .split('\n')
    .map((l) => l.replace(/^[•\-\*]\s*/, '').trim())
    .filter(Boolean);
}

export default function BroadcastOverlay({ data, onDismiss }: Props) {
  const bullets = parseBullets(data.summary);

  return (
    <div className="fixed inset-0 bg-indigo-950/90 flex items-center justify-center z-50 p-6 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-8">
        <div className="inline-block px-3 py-1 bg-indigo-100 text-indigo-700 text-xs font-semibold
                        uppercase tracking-widest rounded-full mb-4">
          Instructor Broadcast
        </div>

        <h2 className="text-2xl font-bold text-gray-900 mb-1">{data.groupName}</h2>
        <p className="text-gray-400 text-sm mb-6">Discussion Summary</p>

        <ul className="space-y-3 mb-8">
          {bullets.map((b, i) => (
            <li key={i} className="flex gap-3 text-gray-700">
              <span className="text-indigo-500 font-bold flex-shrink-0 mt-0.5">•</span>
              <span className="leading-relaxed">{b}</span>
            </li>
          ))}
        </ul>

        <button
          onClick={onDismiss}
          className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl
                     hover:bg-indigo-700 transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
