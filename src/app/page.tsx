import Link from 'next/link';
import { Sparkles, Music, LogIn, UserPlus } from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-neutral-950 text-white relative overflow-hidden flex flex-col justify-center items-center">
      {/* Magical Forest Background */}
      <div className="absolute inset-0 z-0 opacity-40">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/40 via-neutral-950 to-neutral-950" />
        <div className="absolute bottom-0 right-0 w-[800px] h-[800px] bg-teal-900/20 rounded-full blur-[120px] mix-blend-screen" />
        <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-emerald-700/20 rounded-full blur-[100px] mix-blend-screen" />
      </div>

      {/* Floating stardust */}
      <div className="absolute inset-0 z-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20 animate-pulse" />

      <main className="z-10 relative flex flex-col items-center justify-center p-8 max-w-5xl w-full">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-16 md:p-20 shadow-[0_0_50px_rgba(16,185,129,0.15)] flex flex-col items-center text-center relative overflow-hidden">
          {/* Inner Glows */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/30 blur-[80px] rounded-full pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-teal-500/30 blur-[80px] rounded-full pointer-events-none" />

          {/* Icon Badge */}
          <div className="flex items-center justify-center w-24 h-24 rounded-full bg-white/5 border border-white/20 mb-10 shadow-[0_0_30px_rgba(52,211,153,0.3)]">
            <Music className="w-12 h-12 text-emerald-300" />
          </div>

          <h1 className="text-6xl md:text-8xl font-extrabold tracking-tight mb-8 bg-clip-text text-transparent bg-gradient-to-r from-emerald-200 via-teal-100 to-cyan-200 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]">
            Sonaris Piano
          </h1>

          <p className="text-xl md:text-2xl text-emerald-100/70 max-w-3xl mb-14 leading-relaxed">
            Step into an enchanted realm of musical mastery. Experience a mesmerizing 3D piano visualizer where every keystroke illuminates the ancient forest.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row gap-6 w-full justify-center mb-6">
            {/* Sign In */}
            <Link
              href="/login"
              className="group relative inline-flex items-center justify-center gap-2 px-10 py-5 text-lg font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-full overflow-hidden transition-all duration-300 hover:scale-105 shadow-[0_0_30px_rgba(16,185,129,0.4)] hover:shadow-[0_0_40px_rgba(16,185,129,0.6)]"
            >
              <LogIn className="w-6 h-6" />
              Sign In
            </Link>

            {/* Sign Up */}
            <Link
              href="/signup"
              className="group inline-flex items-center justify-center gap-2 px-10 py-5 text-lg font-semibold text-white bg-white/5 border border-white/20 rounded-full backdrop-blur-md transition-all duration-300 hover:bg-white/10 hover:border-emerald-400/40 hover:shadow-[0_0_20px_rgba(52,211,153,0.15)] hover:scale-105"
            >
              <UserPlus className="w-6 h-6" />
              Create Account
            </Link>
          </div>

          {/* Ghost / Guest link */}
          <Link
            href="/visualizer"
            className="text-base text-white/30 hover:text-white/60 transition-colors duration-200 underline underline-offset-4 decoration-white/20 hover:decoration-white/40 flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4" />
            Continue without logging in
          </Link>
        </div>
      </main>
    </div>
  );
}
