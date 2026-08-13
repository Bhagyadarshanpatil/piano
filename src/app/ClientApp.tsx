"use client";

import { useState, useEffect, useCallback } from "react";
import { Scene } from "../scene/Scene";
import { useStore } from "../store";
import { audioEngine } from "../audio/engine";
import { parseMidi } from "../midi/parse";
import { playSong, pauseSong } from "../audio/playback";
import { applyDifficulty, type Difficulty } from "../utils/difficulty";
import type { ParsedSong } from "../midi/types";
import Link from 'next/link';

function splitMonoTrack(song: ParsedSong): ParsedSong {
  if (!song.notes.length) return song;
  const trackIds = new Set(song.notes.map((n) => n.track));
  if (trackIds.size > 1) return song;

  // Mono-track! Split by pitch: >= C4 (60) is track 1 (Melody), < C4 is track 2 (Bass)
  const newNotes = song.notes.map((n) => ({
    ...n,
    track: n.midi >= 60 ? 1 : 2,
  }));
  return { ...song, notes: newNotes };
}

// ── Module-level ref: set of MIDI pitches the user is allowed to press.
// null = no restriction (expert mode). Written by ClientApp whenever the
// difficulty or song changes; read by Keyboard.tsx and pcInput.ts.

// ── Icons (inline SVG — no extra deps) ─────────────────────────────────────
function IconUpload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}
function IconPlay() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
}
function IconPause() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </svg>
  );
}
function IconStop() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

type LibrarySong = {
  id: string;
  title: string;
  artist: string;
  genre?: string;
  difficulty_level?: string;
  file_url: string;
};

export default function ClientApp() {
  const [originalSong, setOriginalSong] = useState<ParsedSong | null>(null);
  const [songName, setSongName] = useState<string>("");
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>("expert");
  const [practiceMode, setPracticeMode] = useState(false);
  const [fetchingLibrary, setFetchingLibrary] = useState(false);
  const [librarySongs, setLibrarySongs] = useState<LibrarySong[]>([]);
  const [recentSongs, setRecentSongs] = useState<LibrarySong[]>([]);
  const [activeLibrarySong, setActiveLibrarySong] = useState<LibrarySong | null>(null);
  const [chromaSync, setChromaSync] = useState(true);

  // Sync track colors when song, difficulty, or chromaSync changes
  useEffect(() => {
    if (!originalSong) return;
    
    // We want the keyboard glow to follow the note color
    const update: any = { keyGlowFollowNote: true };
    
    if (chromaSync) {
      const trackIdxs = new Set<number>();
      for (const n of useStore.getState().song?.notes || []) trackIdxs.add(n.track);
      
      const overrides: Record<string, string> = {};
      // Vibrant neon palette starting with the original cyan
      const palette = ["#5ad7ff", "#33e680", "#e6991a", "#cc33e6", "#e6334d", "#e6e633"];
      let cIdx = 0;
      for (const t of Array.from(trackIdxs).sort((a,b)=>a-b)) {
        overrides[String(t)] = palette[cIdx % palette.length];
        cIdx++;
      }
      update.trackColors = overrides;
    } else {
      update.trackColors = {};
    }
    useStore.getState().updateSettings(update);
  }, [originalSong, difficulty, chromaSync]);

  const addRecentSong = useCallback((song: LibrarySong) => {
    setRecentSongs((prev) => {
      const filtered = prev.filter((s) => s.id !== song.id);
      const updated = [song, ...filtered].slice(0, 5); // Keep last 5
      localStorage.setItem("aether_recent_songs", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const transport = useStore((s) => s.transport);
  const playbackRate = useStore((s) => s.settings.playbackRate);
  const currentKeyboardSize = useStore((s) => s.settings.keyboardSize);

  const isPlaying = transport === "playing";

  // Sync practiceMode → audio engine: mute only auto-scheduled song notes.
  // triggerKey() (user key presses) always stays audible.
  useEffect(() => {
    audioEngine.setSongPlaybackMuted(practiceMode);
  }, [practiceMode]);

  // Keep audio engine rate in sync with store
  useEffect(() => {
    audioEngine.setRate(playbackRate);
  }, [playbackRate]);

  const handleFetchLibrary = useCallback(async () => {
    setFetchingLibrary(true);
    try {
      const res = await fetch('/api/library');
      if (!res.ok) throw new Error('Failed to fetch library');
      const data = await res.json();
      setLibrarySongs(data.tracks || []);
      console.log('Library loaded:', data.tracks);
    } catch (err) {
      console.error(err);
    } finally {
      setFetchingLibrary(false);
    }
  }, []);

  // Load recently played on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("aether_recent_songs");
      if (stored) setRecentSongs(JSON.parse(stored));
    } catch {
      // ignore
    }
    // Auto-load library
    handleFetchLibrary();
  }, [handleFetchLibrary]);

  // Eagerly initialize audio engine so piano keys are playable immediately
  useEffect(() => {
    audioEngine.init().catch(console.error);
  }, []);

  const handleLoadLibrarySong = useCallback(async (song: LibrarySong, selectedDiff: Difficulty) => {
    setUploading(true);
    setLoadProgress(null);
    try {
      audioEngine.stop();
      useStore.getState().setTransport("stopped");
      
      if (!audioEngine.isReady()) {
        audioEngine.init((p) => setLoadProgress(p)).catch(console.error);
      }

      // Load the file directly from Supabase storage or via proxy if external
      let songUrl = song.file_url;
      if (!songUrl) throw new Error("No URL found for song");

      // Bypasses browser CORS for external URLs (like the bitmidi.com links we just inserted)
      if (songUrl.startsWith('http') && !songUrl.includes('supabase.co')) {
        songUrl = `/api/proxy-midi?url=${encodeURIComponent(songUrl)}`;
      }

      const response = await fetch(songUrl);
      const arrayBuffer = await response.arrayBuffer();
      let parsedSong = await parseMidi(arrayBuffer, song.title);
      parsedSong = splitMonoTrack(parsedSong);

      setOriginalSong(parsedSong);
      setSongName(song.title);
      setActiveLibrarySong(song);

      // Apply difficulty heuristic on library files
      const filtered = applyDifficulty(parsedSong, selectedDiff);
      useStore.getState().setSong(filtered, { resetTimeline: true });
      addRecentSong(song);
    } catch (err) {
      console.error("MIDI parse failed:", err);
    } finally {
      setUploading(false);
    }
  }, [addRecentSong]);

  const handleDifficultyChange = useCallback(async (d: Difficulty) => {
    // Reset playback position
    audioEngine.stop();
    useStore.getState().setTransport("stopped");

    setDifficulty(d);
    
    if (activeLibrarySong) {
      // Fetch new file from Supabase
      await handleLoadLibrarySong(activeLibrarySong, d);
    } else if (originalSong) {
      // Local upload, use heuristic
      const filtered = applyDifficulty(originalSong, d);
      useStore.getState().setSong(filtered, { resetTimeline: true });
    }
  }, [activeLibrarySong, originalSong, handleLoadLibrarySong]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-uploaded
    e.target.value = "";

    setUploading(true);
    setLoadProgress(null);

    try {
      audioEngine.stop();
      useStore.getState().setTransport("stopped");

      // Start audio engine load immediately on user gesture
      if (!audioEngine.isReady()) {
        audioEngine.init((p) => setLoadProgress(p)).catch(console.error);
      }

      const arrayBuffer = await file.arrayBuffer();
      let parsedSong = await parseMidi(arrayBuffer, file.name);
      parsedSong = splitMonoTrack(parsedSong);

      setOriginalSong(parsedSong);
      setSongName(file.name.replace(/\.midi?$/i, ""));
      setActiveLibrarySong(null);

      // Load into store (engine.loadSong is called inside setSong)
      const filtered = applyDifficulty(parsedSong, difficulty);
      useStore.getState().setSong(filtered, { resetTimeline: true });
    } catch (err) {
      console.error("MIDI parse failed:", err);
    } finally {
      setUploading(false);
    }
  }, [difficulty]);

  const handlePlayPause = useCallback(async () => {
    if (!originalSong) return;
    if (isPlaying) {
      pauseSong();
    } else {
      await playSong();
    }
  }, [isPlaying, originalSong]);

  const handleStop = useCallback(() => {
    audioEngine.stop();
    useStore.getState().setTransport("stopped");
  }, []);

  const handleSpeedChange = useCallback((rate: number) => {
    useStore.getState().updateSettings({ playbackRate: rate });
  }, []);

  return (
    <main className="relative w-full h-screen overflow-hidden text-white bg-black">
      {/* ── 3-D Scene ───────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        <Scene />
      </div>

      {/* ── UI overlay (pointer-events-none so scene gets mouse) ──── */}
      <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden font-sans">

        {/* ── Left Panel ───────────────────────────────────────────── */}
        <div className={`absolute top-6 left-6 bottom-32 w-[340px] flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto ${isPlaying ? '-translate-x-[120%]' : 'translate-x-0'}`}>
          <div className="flex-1 rounded-2xl bg-[#0a0a12]/50 backdrop-blur-2xl border border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.6)] p-6 flex flex-col gap-6 overflow-y-auto">
            {/* Title */}
            <div>
              <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-teal-300 to-purple-400 mb-1 tracking-tight">
                Aether Keys
              </h1>
              {songName ? (
                <p className="text-sm text-gray-400 truncate">🎵 {songName}</p>
              ) : (
                <p className="text-sm text-gray-500">Upload a MIDI file to begin</p>
              )}
            </div>

            {/* Upload Button */}
            <label className={`flex items-center justify-center gap-2 px-4 py-3 rounded-xl border transition-all duration-200 text-sm font-semibold ${uploading ? 'bg-teal-400/10 border-teal-400/20 text-teal-300 cursor-default' : 'bg-white/5 border-white/10 text-white hover:bg-white/10 cursor-pointer'}`}>
              <IconUpload />
              <span>{uploading ? "Loading…" : "Upload MIDI"}</span>
              <input
                type="file"
                accept=".mid,.midi"
                className="hidden"
                onChange={handleFileUpload}
                disabled={uploading}
              />
            </label>

            {/* Sample load progress bar */}
            {loadProgress && loadProgress.total > 0 && loadProgress.loaded < loadProgress.total && (
              <div>
                <div className="text-xs text-gray-400 mb-1.5 font-medium">
                  Loading piano samples… {Math.round((loadProgress.loaded / loadProgress.total) * 100)}%
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-teal-400 to-purple-400 transition-all duration-300 ease-out"
                    style={{ width: `${(loadProgress.loaded / loadProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Controls (Disabled when no song) */}
            <div className={`flex flex-col gap-6 transition-opacity duration-300 ${originalSong ? 'opacity-100 pointer-events-auto' : 'opacity-40 pointer-events-none'}`}>
              
              {/* Difficulty Settings */}
              <div>
                <div className="text-xs text-gray-400 mb-2 font-semibold tracking-wider uppercase">Difficulty</div>
                <div className="flex gap-1.5 bg-black/40 p-1 rounded-xl">
                  {(["easy", "medium", "expert"] as Difficulty[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => handleDifficultyChange(d)}
                      className={`flex-1 py-2 text-xs font-bold rounded-lg capitalize transition-all duration-200 ${difficulty === d ? 'bg-gradient-to-br from-teal-500 to-purple-600 text-white shadow-lg' : 'bg-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              {/* Practice / Auto-Play toggle */}
              <button
                onClick={() => setPracticeMode((m) => !m)}
                title={practiceMode ? "MIDI track muted — press keys to play" : "MIDI track plays automatically"}
                className={`w-full py-3 px-4 flex items-center justify-center gap-2.5 text-sm font-semibold rounded-xl border transition-all duration-200 ${practiceMode ? 'bg-gradient-to-br from-teal-500/20 to-purple-600/20 border-teal-500/30 text-teal-300' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-300'}`}
              >
                <span className="text-lg">{practiceMode ? "🎹" : "🔊"}</span>
                {practiceMode ? "Practice Mode" : "Auto-Play Mode"}
              </button>

              {/* ColorX toggle */}
              <button
                onClick={() => setChromaSync((m) => !m)}
                title={chromaSync ? "Distinct colors for Melody & Bass" : "ColorX Multi Color Mode"}
                className={`w-full py-3 px-4 flex items-center justify-center gap-2.5 text-sm font-semibold rounded-xl border transition-all duration-200 ${chromaSync ? 'bg-gradient-to-br from-pink-500/20 to-orange-500/20 border-pink-500/30 text-pink-300' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-300'}`}
              >
                <span className="text-lg">{chromaSync ? "🌈" : "⬜"}</span>
                {chromaSync ? "ColorX: ON" : "ColorX: OFF"}
              </button>
            </div>
            
            <div className="mt-auto pt-4 border-t border-white/5">
              <div className="text-xs text-gray-500 mb-2 font-semibold tracking-wider uppercase">Recently Played</div>
              {recentSongs.length === 0 ? (
                <div className="text-sm text-gray-600 italic">No recent songs...</div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[150px] overflow-y-auto pr-1">
                  {recentSongs.map((song) => (
                    <button
                      key={song.id}
                      onClick={() => handleLoadLibrarySong(song, difficulty)}
                      disabled={uploading}
                      className="text-left px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-teal-300 text-sm transition-colors duration-200 truncate"
                    >
                      🎵 {song.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Panel ───────────────────────────────────────────── */}
        <div className={`absolute top-6 right-6 bottom-32 w-[340px] flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto ${isPlaying ? 'translate-x-[120%]' : 'translate-x-0'}`}>
          <div className="flex-1 rounded-2xl bg-[#0a0a12]/50 backdrop-blur-2xl border border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.6)] p-6 flex flex-col gap-6 overflow-y-auto">
            
            {/* Profile Button */}
            <div>
              <Link 
                href="/profile"
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-fuchsia-600/20 to-purple-600/20 hover:from-fuchsia-600/40 hover:to-purple-600/40 border border-fuchsia-500/30 rounded-xl text-fuchsia-100 font-semibold transition-all shadow-[0_0_15px_rgba(217,70,239,0.15)]"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                My Profile
              </Link>
            </div>

            {/* Keyboard Size Settings */}
            <div>
              <div className="text-xs text-gray-400 mb-2 font-semibold tracking-wider uppercase">Keyboard Size</div>
              <div className="grid grid-cols-4 gap-1.5 bg-black/40 p-1 rounded-xl">
                {[36, 44, 61, 88].map((size) => {
                  return (
                    <button
                      key={size}
                      onClick={() => {
                        useStore.getState().updateSettings({ 
                          keyboardSize: Number(size) as any,
                        });
                      }}
                      className={`py-2 text-xs font-bold rounded-lg transition-all duration-200 ${Number(currentKeyboardSize) === size ? 'bg-white/20 text-white shadow-lg' : 'bg-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                    >
                      {size}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="text-xs text-gray-400 font-semibold tracking-wider uppercase">Supabase Library</div>

              {/* Render Library Songs */}
              {librarySongs.length > 0 && (
                <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto pr-1">
                  {librarySongs.map((song) => (
                    <button
                      key={song.id}
                      onClick={() => handleLoadLibrarySong(song, difficulty)}
                      disabled={uploading}
                      className="text-left px-3 py-2.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-teal-300 text-sm transition-colors duration-200 truncate"
                    >
                      🎵 {song.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── Bottom Controls ───────────────────────────────────────────── */}
        <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col gap-4 items-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto ${originalSong ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 pointer-events-none'}`}>
          <div className="rounded-3xl bg-[#0a0a12]/70 backdrop-blur-3xl border border-white/10 shadow-[0_16px_60px_rgba(0,0,0,0.7)] px-8 py-5 flex flex-col gap-5 items-center">
            
            {/* Play/Pause/Stop */}
            <div className="flex items-center gap-4">
              <button
                onClick={handleStop}
                className="p-3 rounded-full border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white transition-all duration-200"
                title="Stop"
              >
                <IconStop />
              </button>

              <button
                onClick={handlePlayPause}
                className={`flex items-center justify-center gap-2 px-8 py-3.5 rounded-full font-bold text-base shadow-xl transition-all duration-300 ${isPlaying ? 'bg-gradient-to-r from-amber-600 to-orange-600 text-white shadow-orange-900/30 hover:shadow-orange-900/50 hover:scale-105' : 'bg-gradient-to-r from-teal-500 to-purple-600 text-white shadow-teal-900/30 hover:shadow-teal-900/50 hover:scale-105'}`}
              >
                {isPlaying ? <IconPause /> : <IconPlay />}
                {isPlaying ? "Pause" : "Play"}
              </button>
            </div>

            {/* Speed control */}
            <div className="flex flex-col items-center gap-2">
              <div className="text-[10px] text-gray-400 font-semibold tracking-widest uppercase">Speed</div>
              <div className="flex gap-1 bg-black/40 p-1 rounded-xl">
                {SPEED_STEPS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSpeedChange(s)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all duration-200 ${playbackRate === s ? 'bg-gradient-to-br from-teal-400 to-purple-400 text-white shadow-md' : 'bg-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>

          </div>
        </div>

      </div>
    </main>
  );
}
