'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { Sparkles, ArrowRight, ArrowLeft, User, Calendar, Music2, Zap, Check, Sprout, Target } from 'lucide-react';

const GENRES = [
  'Classical', 'Jazz', 'Pop', 'EDM', 'Lo-Fi Hip Hop',
  'R&B', 'Rock', 'Ambient / New Age', 'Country', 'Hip Hop',
];

const EXPERIENCE_LEVELS = [
  {
    id: 'beginner',
    label: 'Beginner',
    desc: 'Just starting out. Learning notes and basic melodies.',
    icon: Sprout,
    color: 'text-emerald-400',
    bg: 'bg-emerald-400',
    border: 'border-emerald-400',
  },
  {
    id: 'intermediate',
    label: 'Intermediate',
    desc: 'Comfortable with scales and chords. Can play simple songs.',
    icon: Target,
    color: 'text-blue-400',
    bg: 'bg-blue-400',
    border: 'border-blue-400',
  },
  {
    id: 'expert',
    label: 'Expert',
    desc: 'Advanced player. Improvising, complex compositions.',
    icon: Zap,
    color: 'text-fuchsia-400',
    bg: 'bg-fuchsia-400',
    border: 'border-fuchsia-400',
  },
];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState(1);
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [age, setAge] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [experience, setExperience] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);

  const checkUsername = async (val: string) => {
    if (!val || val.length < 3) { setUsernameAvailable(null); return; }
    setUsernameChecking(true);
    const { data } = await supabase.from('profiles').select('id').eq('username', val).maybeSingle();
    setUsernameAvailable(!data);
    setUsernameChecking(false);
  };

  const handleUsernameChange = (val: string) => {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9_]/g, '');
    setUsername(cleaned);
    setUsernameAvailable(null);
    const timer = setTimeout(() => checkUsername(cleaned), 600);
    return () => clearTimeout(timer);
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev =>
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  };

  const handleNext = () => {
    setError(null);
    if (step === 1) {
      if (!username || username.length < 3) { setError('Username must be at least 3 characters.'); return; }
      if (usernameAvailable === false) { setError('That username is already taken.'); return; }
      if (!fullName.trim()) { setError('Please enter your name.'); return; }
      const ageNum = parseInt(age);
      if (!age || isNaN(ageNum) || ageNum < 5 || ageNum > 120) { setError('Please enter a valid age.'); return; }
    }
    setStep(s => s + 1);
  };

  const handleFinish = async () => {
    if (selectedGenres.length === 0) { setError('Pick at least one genre you love.'); return; }
    if (!experience) { setError('Please select your experience level.'); return; }
    setLoading(true);
    setError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }

    const { error: upsertError } = await supabase.from('profiles').upsert({
      id: user.id,
      username,
      full_name: fullName.trim(),
      age: parseInt(age),
      fav_genres: selectedGenres,
      experience_level: experience,
      onboarding_complete: true,
    });

    if (upsertError) {
      setError(upsertError.message);
      setLoading(false);
      return;
    }

    router.push('/visualizer');
  };

  const progressPct = ((step - 1) / 2) * 100;

  return (
    <div className="min-h-screen bg-neutral-950 text-white relative overflow-hidden flex flex-col justify-center items-center p-4">
      {/* Background Magic */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top_left,_var(--tw-gradient-stops))] from-fuchsia-900/30 via-neutral-950 to-neutral-950" />
        <div className="absolute bottom-0 right-0 w-[600px] h-[600px] bg-emerald-900/20 rounded-full blur-[120px]" />
        <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] bg-purple-900/15 rounded-full blur-[100px]" />
      </div>

      {/* Floating stardust / fireflies */}
      <div className="absolute inset-0 z-0 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-20 animate-pulse pointer-events-none" />

      <div className="z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 text-emerald-300/70 text-sm font-medium mb-3">
            <Sparkles className="w-4 h-4" />
            Step {step} of 2
          </div>
          <div className="w-full bg-white/10 rounded-full h-1 mb-6">
            <div 
              className="bg-emerald-400 h-1 rounded-full transition-all duration-500 ease-out" 
              style={{ width: step === 1 ? '50%' : '100%' }}
            />
          </div>
        </div>

        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 shadow-[0_0_60px_rgba(217,70,239,0.1)] relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-fuchsia-500/20 blur-[70px] rounded-full pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-emerald-500/10 blur-[70px] rounded-full pointer-events-none" />

          {/* ── STEP 1: Basic Info ── */}
          {step === 1 && (
            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="text-center mb-6">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <User className="w-5 h-5 text-fuchsia-400" />
                  <h1 className="text-2xl font-bold tracking-tight">Welcome, Mage!</h1>
                </div>
                <p className="text-white/50 text-sm">Tell us a bit about yourself to personalise your journey.</p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
                  {error}
                </div>
              )}

              {/* Username */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Username</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 font-medium">@</span>
                  <input
                    type="text"
                    value={username}
                    onChange={e => handleUsernameChange(e.target.value)}
                    placeholder="yourname"
                    maxLength={24}
                    className="w-full bg-black/30 border border-white/10 rounded-xl py-3 pl-9 pr-10 text-white placeholder-white/20 focus:outline-none focus:border-fuchsia-500/50 focus:ring-1 focus:ring-fuchsia-500/50 transition-all"
                  />
                  {username.length >= 3 && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 text-base">
                      {usernameChecking ? (
                        <span className="text-white/30 animate-pulse">...</span>
                      ) : usernameAvailable === true ? (
                        <span className="text-emerald-400">✓</span>
                      ) : usernameAvailable === false ? (
                        <span className="text-red-400">✗</span>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>

              {/* Full Name */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-white/50 uppercase tracking-wider">Full Name</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Aria Nightshade"
                  className="w-full bg-black/30 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-fuchsia-500/50 focus:ring-1 focus:ring-fuchsia-500/50 transition-all"
                />
              </div>

              {/* Age */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" /> Age
                </label>
                <input
                  type="number"
                  value={age}
                  onChange={e => setAge(e.target.value)}
                  placeholder="25"
                  min={5}
                  max={120}
                  className="w-full bg-black/30 border border-white/10 rounded-xl py-3 px-4 text-white placeholder-white/20 focus:outline-none focus:border-fuchsia-500/50 focus:ring-1 focus:ring-fuchsia-500/50 transition-all"
                />
              </div>
            </div>
          )}

          {/* ── STEP 2: Preferences ── */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-500">
              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-200 text-sm">
                  {error}
                </div>
              )}

              {/* Genres */}
              <div>
                <div className="mb-4">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Music2 className="w-5 h-5 text-emerald-400" />
                    <h2 className="text-xl font-bold tracking-tight">Your Sound</h2>
                  </div>
                  <p className="text-white/50 text-sm text-center">What music moves your soul? Pick all that apply.</p>
                </div>
                
                <div className="flex flex-wrap justify-center gap-2.5">
                  {GENRES.map(g => {
                    const active = selectedGenres.includes(g);
                    return (
                      <button
                        key={g}
                        onClick={() => {
                          if (active) setSelectedGenres(prev => prev.filter(x => x !== g));
                          else setSelectedGenres(prev => [...prev, g]);
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all duration-200 ${
                          active
                            ? 'bg-gradient-to-r from-emerald-500/30 to-teal-500/30 border-emerald-400/50 text-emerald-200 shadow-[0_0_15px_rgba(52,211,153,0.2)]'
                            : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10 hover:text-white hover:border-white/20'
                        }`}
                      >
                        {active && <Check className="w-3.5 h-3.5" />}
                        {g}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="h-px bg-white/10 w-full my-6" />

              {/* Experience */}
              <div>
                <div className="mb-4">
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <Zap className="w-5 h-5 text-amber-400" />
                    <h2 className="text-xl font-bold tracking-tight">Your Level</h2>
                  </div>
                  <p className="text-white/50 text-sm text-center">Be honest — we'll tailor the experience just for you.</p>
                </div>

                <div className="space-y-3">
                  {EXPERIENCE_LEVELS.map(level => {
                    const active = experience === level.id;
                    const Icon = level.icon;
                    return (
                      <button
                        key={level.id}
                        onClick={() => setExperience(level.id)}
                        className={`w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all duration-200 ${
                          active
                            ? 'bg-white/10 border-white/30'
                            : 'bg-white/5 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${active ? `${level.bg}/20 border border-${level.border}/30` : 'bg-black/30'}`}>
                          <Icon className={`w-5 h-5 ${active ? level.color : 'text-white/50'}`} />
                        </div>
                        <div className="flex-1">
                          <div className={`font-semibold text-sm ${active ? 'text-white' : 'text-white/80'}`}>{level.label}</div>
                          <div className="text-xs text-white/50">{level.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Footer Buttons */}
          <div className="mt-8 flex items-center justify-between border-t border-white/10 pt-6">
            {step === 1 ? (
              <div />
            ) : (
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white text-sm font-medium transition-all"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}

            {step === 1 ? (
              <button
                onClick={() => {
                  setError(null);
                  if (!username || !fullName) { setError('Username and full name are required'); return; }
                  if (usernameAvailable === false) { setError('Please choose another username'); return; }
                  setStep(2);
                }}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white font-semibold text-sm transition-all shadow-[0_0_20px_rgba(217,70,239,0.3)]"
              >
                Continue <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={loading || !experience || selectedGenres.length === 0}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all shadow-[0_0_20px_rgba(52,211,153,0.3)]"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                ) : (
                  <><Sparkles className="w-4 h-4" /> Begin</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
