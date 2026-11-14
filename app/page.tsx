import Link from 'next/link';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex flex-col items-center justify-center px-4">
      <div className="text-center mb-14">
        <h1 className="text-6xl font-extrabold tracking-tight">
          <span className="text-[#d83b11]">Class</span><span className="text-emerald-600">Discuss</span>
        </h1>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        <Link
          href="/instructor/create"
          className="group relative px-12 py-6 bg-[#d83b11] text-white text-xl font-semibold rounded-2xl
                     hover:bg-[#bb3210] active:scale-95 transition-all shadow-lg shadow-orange-200"
        >
          I am an Instructor
        </Link>

        <Link
          href="/student/join"
          className="group relative px-12 py-6 bg-emerald-600 text-white text-xl font-semibold rounded-2xl
                     hover:bg-emerald-700 active:scale-95 transition-all shadow-lg shadow-emerald-200"
        >
          I am a Student
        </Link>
      </div>

    </main>
  );
}
