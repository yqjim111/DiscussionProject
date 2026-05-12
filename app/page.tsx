import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex flex-col items-center justify-center px-4">
      <div className="text-center mb-14">
        <h1 className="text-6xl font-extrabold text-gray-900 tracking-tight mb-3">
          Class<span className="text-indigo-600">Discuss</span>
        </h1>
        <p className="text-gray-500 text-xl max-w-md">
          Real-time AI summarization for classroom group discussions
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        <Link
          href="/instructor/create"
          className="group relative px-12 py-6 bg-indigo-600 text-white text-xl font-semibold rounded-2xl
                     hover:bg-indigo-700 active:scale-95 transition-all shadow-lg shadow-indigo-200"
        >
          <span className="block text-2xl mb-1">👩‍🏫</span>
          I am an Instructor
        </Link>

        <Link
          href="/student/join"
          className="group relative px-12 py-6 bg-emerald-600 text-white text-xl font-semibold rounded-2xl
                     hover:bg-emerald-700 active:scale-95 transition-all shadow-lg shadow-emerald-200"
        >
          <span className="block text-2xl mb-1">🎓</span>
          I am a Student
        </Link>
      </div>

      <p className="mt-16 text-gray-400 text-sm">
        No account required &mdash; just enter a room code and start discussing.
      </p>
    </main>
  );
}
