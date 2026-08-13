import Link from 'next/link';
import { Sparkles, Music4, ArrowRight } from 'lucide-react';

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

      <main className="z-10 relative flex flex-col items-center justify-center p-6 max-w-4xl w-full">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 md:p-10 shadow-[0_0_50px_rgba(16,185,129,0.15)] flex flex-col items-center text-center relative overflow-hidden">
          {/* Inner Glows */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-emerald-500/30 blur-[80px] rounded-full pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-cyan-500/20 blur-[80px] rounded-full pointer-events-none" />

          {/* Icon Badge */}
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 mb-6 shadow-[0_0_30px_rgba(52,211,153,0.4)]">
            <Music4 className="w-8 h-8 text-white" />
          </div>

          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight mb-4 bg-clip-text text-transparent bg-gradient-to-r from-emerald-200 via-teal-100 to-cyan-200 drop-shadow-[0_0_15px_rgba(52,211,153,0.5)]">
            Sonaris Piano
          </h1>

          <p className="text-base md:text-lg text-emerald-100/70 max-w-xl mb-8 leading-relaxed">
            Experience the next generation of piano visualization. Upload your MIDI files, connect your keyboard, and watch your music come to life in a stunning 3D environment.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto mb-6">
            <Link
              href="/signup"
              className="w-full sm:w-auto px-6 py-3 rounded-full bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-sm transition-all shadow-[0_0_20px_rgba(52,211,153,0.4)] hover:shadow-[0_0_30px_rgba(52,211,153,0.6)] flex items-center justify-center gap-2 hover:scale-105"
            >
              Get Started <ArrowRight className="w-4 h-4" />
            </Link>
            
            <Link
              href="/login"
              className="w-full sm:w-auto px-6 py-3 rounded-full bg-white/5 hover:bg-white/10 text-white font-semibold text-sm transition-all border border-white/10 hover:border-white/20 flex items-center justify-center gap-2 hover:scale-105"
            >
              Sign In
            </Link>
          </div>

          {/* Ghost / Guest link */}
          <Link
            href="/visualizer"
            className="text-sm text-white/30 hover:text-white/60 transition-colors duration-200 underline underline-offset-4 decoration-white/20 hover:decoration-white/40 flex items-center gap-1.5"
          >
            <Sparkles className="w-4 h-4" />
            Continue without logging in
          </Link>
        </div>
      </main>
    </div>
  );
}
