'use client';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import DownloadTranscriptionButton from '@/components/DownloadTranscriptionButton';
export default function TranscriptionDownloadPage() {
  const { roomCode } = useParams();
  return <main className="min-h-screen bg-slate-50 p-8"><div className="max-w-3xl mx-auto bg-white border rounded-xl p-8 space-y-6">
    <h1 className="text-2xl font-bold">Original transcriptions</h1>
    <DownloadTranscriptionButton roomCode={String(roomCode)} className="bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl px-6 py-3 font-semibold disabled:opacity-50" />
    <div><Link href={'/instructor/' + roomCode} className="text-indigo-700">Back to Instructor Dashboard</Link></div>
  </div></main>;
}
