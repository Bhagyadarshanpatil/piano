'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { LogIn, Mail, Lock, AlertCircle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    // Check if user has completed onboarding
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('onboarding_complete')
        .eq('id', user.id)
        .maybeSingle();

      if (!profile || !profile.onboarding_complete) {
        router.push('/onboarding');
      } else {
        router.push('/visualizer');
      }
    }
    router.refresh();
  };

  const handleOAuthGoogle = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setError(error.message); setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white relative overflow-hidden flex flex-col justify-center items-center p-4">
      {/* Background */}
      <div className="absolute inset-0 z-0 opacity-40">
        <div className="absolute top-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/30 via-neutral-950 to-neutral-950" />
        <div className="absolute bottom-1/4 left-0 w-[600px] h-[600px] bg-indigo-900/20 rounded-full blur-[120px] mix-blend-screen" />
      </div>

      <Link href="/" className="absolute top-8 left-8 z-20 flex items-center gap-2 text-white/50 hover:text-white transition-colors text-sm">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      <main className="z-10 w-full max-w-md">
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-[0_0_50px_rgba(79,70,229,0.15)] relative overflow-hidden">
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-500/20 blur-[80px] rounded-full pointer-events-none" />

          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight mb-2 bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 to-cyan-200">
              Welcome Back
            </h1>
            <p className="text-white/50 text-sm">Sign in to resume your magical journey</p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-start gap-3 text-red-200">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-white/60 uppercase tracking-wider pl-1">Email</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                  placeholder="mage@sonarispiano.com"
                  suppressHydrationWarning
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-white/60 uppercase tracking-wider pl-1">Password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-black/20 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white placeholder-white/20 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 transition-all"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button type="button" className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-4 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all shadow-[0_0_20px_rgba(99,102,241,0.4)] mt-2"
            >
              <LogIn className="w-5 h-5" />
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <div className="mt-6 flex items-center gap-4">
            <div className="h-px bg-white/10 flex-1" />
            <span className="text-xs text-white/40 font-medium">OR</span>
            <div className="h-px bg-white/10 flex-1" />
          </div>

          <button
            onClick={handleOAuthGoogle}
            disabled={loading}
            className="mt-6 w-full flex items-center justify-center gap-3 py-3.5 px-4 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 disabled:opacity-50 rounded-xl transition-all text-white font-medium"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Continue with Google
          </button>

          <p className="mt-6 text-center text-sm text-white/40">
            Don't have an account?{' '}
            <Link href="/signup" className="text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
              Sign up free
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
