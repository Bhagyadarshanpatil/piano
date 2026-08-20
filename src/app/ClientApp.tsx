"use client";

import { useState, useEffect, useCallback } from "react";
import * as Tone from "tone";
import { Scene } from "../scene/Scene";
import { useStore } from "../store";
import { audioEngine } from "../audio/engine";
import { parseMidi } from "../midi/parse";
import { playSong, pauseSong } from "../audio/playback";
import { applyDifficulty, type Difficulty } from "../utils/difficulty";
import type { ParsedSong } from "../midi/types";
import { useMicInput } from "../audio/useMicInput";
import { usePolyMicInput } from "../audio/usePolyMicInput";
import { polyMicInput } from "../audio/polyMicInput";
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
  useEffect(() => {
    const handleFirstInteraction = async () => {
      await Tone.start();
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
    window.addEventListener('pointerdown', handleFirstInteraction);
    window.addEventListener('keydown', handleFirstInteraction);
    return () => {
      window.removeEventListener('pointerdown', handleFirstInteraction);
      window.removeEventListener('keydown', handleFirstInteraction);
    };
  }, []);

  // Preload the BasicPitch model in the background immediately on mount.
  // This ensures the model + TF.js WebGL shaders are warm before the user
  // clicks the poly-mic button, eliminating the perceived load delay.
  useEffect(() => {
    polyMicInput.preload();
  }, []);

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
  const { isListening, toggleListening, supported: micSupported } = useMicInput();
  const { isListening: isPolyListening, toggleListening: togglePolyListening, supported: polySupported } = usePolyMicInput();

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

  const fetchRecentlyPlayed = useCallback(async () => {
    try {
      const res = await fetch('/api/recently-played');
      if (res.ok) {
        const data = await res.json();
        setRecentSongs(data);
      }
    } catch (err) {
      console.error('Failed to fetch recent songs:', err);
    }
  }, []);

  const addRecentSong = useCallback(async (song: LibrarySong) => {
    // Optimistically update UI
    setRecentSongs((prev) => {
      const filtered = prev.filter((s) => s.id !== song.id);
      return [song, ...filtered].slice(0, 10);
    });

    try {
      await fetch('/api/recently-played', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: song.id })
      });
      // Sync with server state
      fetchRecentlyPlayed();
    } catch (err) {
      console.error('Failed to log recent song:', err);
    }
  }, [fetchRecentlyPlayed]);

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

  // Load recently played and library on mount
  useEffect(() => {
    fetchRecentlyPlayed();
    handleFetchLibrary();
  }, [handleFetchLibrary, fetchRecentlyPlayed]);

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
        <div className={`absolute top-6 left-6 bottom-32 w-[17.5rem] flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto ${isPlaying ? '-translate-x-[120%]' : 'translate-x-0'}`}>
          <div className="flex-1 rounded-2xl bg-[#0a0a12]/50 backdrop-blur-2xl border border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.6)] p-6 flex flex-col gap-6 overflow-y-auto">
            {/* Title */}
            <div>
              <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-br from-teal-300 to-purple-400 mb-1 tracking-tight">
                Sonaris Piano
              </h1>
              {songName ? (
                <p className="text-sm text-gray-400 truncate">🎵 {songName}</p>
              ) : (
                <p className="text-sm text-gray-500">Upload a MIDI file to begin</p>
              )}
            </div>

            {/* Upload Button */}
            <label className={`flex items-center justify-center gap-2 px-3 py-2 rounded-xl border transition-all duration-200 text-sm font-semibold ${uploading ? 'bg-teal-400/10 border-teal-400/20 text-teal-300 cursor-default' : 'bg-white/5 border-white/10 text-white hover:bg-white/10 cursor-pointer'}`}>
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
                <span className="flex items-center justify-center opacity-80">{practiceMode ? <IconKeyboard /> : <IconAutoPlay />}</span>
                {practiceMode ? "Practice Mode" : "Auto-Play Mode"}
              </button>

              {/* ColorX toggle */}
              <button
                onClick={() => setChromaSync((m) => !m)}
                title={chromaSync ? "Distinct colors for Melody & Bass" : "ColorX Multi Color Mode"}
                className={`w-full py-3 px-4 flex items-center justify-center gap-2.5 text-sm font-semibold rounded-xl border transition-all duration-200 ${chromaSync ? 'bg-gradient-to-br from-pink-500/20 to-orange-500/20 border-pink-500/30 text-pink-300' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-300'}`}
              >
                <span className="flex items-center justify-center opacity-80">{chromaSync ? <IconPalette /> : <IconPalette />}</span>
                {chromaSync ? "ColorX: ON" : "ColorX: OFF"}
              </button>
            </div>

            {/* Mic toggle (Always enabled) */}
            <div className="flex flex-col gap-6">
              {micSupported && (
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => {
                      if (isPolyListening) togglePolyListening()
                      toggleListening()
                    }}
                    title={isListening ? "Microphone active — play your instrument" : "Enable microphone to play with real instrument"}
                    className={`w-full py-3 px-4 flex items-center justify-center gap-2.5 text-sm font-semibold rounded-xl border transition-all duration-200 ${isListening ? 'bg-gradient-to-br from-red-500/20 to-orange-600/20 border-red-500/30 text-red-300 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-gray-300'}`}
                  >
                    <span className={`flex items-center justify-center opacity-80 ${isListening ? 'animate-pulse' : ''}`}><IconMic /></span>
                    {isListening ? "Mic: ON (Standard)" : "Mic: OFF"}
                  </button>
                  {polySupported && (
                    <button
                      onClick={() => {
                        if (isListening) toggleListening()
                        togglePolyListening()
                      }}
                      title={isPolyListening ? "Polyphonic Mic active" : "Enable Polyphonic AI Mic (Detects Chords, uses more CPU)"}
                      className={`w-full py-2.5 px-4 flex items-center justify-center gap-2.5 text-xs font-semibold rounded-xl border transition-all duration-200 ${isPolyListening ? 'bg-gradient-to-br from-purple-500/20 to-pink-600/20 border-purple-500/30 text-purple-300 shadow-[0_0_15px_rgba(168,85,247,0.2)]' : 'bg-white/5 border-white/10 text-gray-500 hover:bg-white/10 hover:text-gray-400'}`}
                    >
                      <span className={`flex items-center justify-center opacity-80 ${isPolyListening ? 'animate-pulse' : ''}`}><IconMic /></span>
                      {isPolyListening ? "Mic: Polyphonic AI (ON)" : "Polyphonic AI Mode (Detect Chords)"}
                    </button>
                  )}
                </div>
              )}
            </div>
            
            <div className="mt-auto pt-4 border-t border-white/5">
              <div className="text-xs text-gray-500 mb-2 font-semibold tracking-wider uppercase">Recently Played</div>
              {recentSongs.length === 0 ? (
                <div className="text-sm text-gray-600 italic">No recent songs...</div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[9.375rem] overflow-y-auto pr-1">
                  {recentSongs.map((song) => (
                    <button
                      key={song.id}
                      onClick={() => handleLoadLibrarySong(song, difficulty)}
                      disabled={uploading}
                      className="text-left flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-teal-300 text-sm transition-colors duration-200 truncate"
                    >
                      <IconMusic /> <span className="truncate">{song.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Panel ───────────────────────────────────────────── */}
        <div className={`absolute top-6 right-6 bottom-32 w-[17.5rem] flex flex-col transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto ${isPlaying ? 'translate-x-[120%]' : 'translate-x-0'}`}>
          <div className="flex-1 rounded-2xl bg-[#0a0a12]/50 backdrop-blur-2xl border border-white/10 shadow-[0_8px_40px_rgba(0,0,0,0.6)] p-6 flex flex-col gap-6 overflow-y-auto">
            
            {/* Profile Button */}
            <div>
              <Link 
                href="/profile"
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gradient-to-r from-fuchsia-600/20 to-purple-600/20 hover:from-fuchsia-600/40 hover:to-purple-600/40 border border-fuchsia-500/30 rounded-xl text-fuchsia-100 font-semibold transition-all shadow-[0_0_15px_rgba(217,70,239,0.15)]"
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
              <div className="text-sm text-gray-400 mb-2 font-semibold tracking-wider uppercase">Keyboard Size</div>
              <div className="grid grid-cols-4 gap-1.5 bg-black/40 p-1 rounded-xl">
                {[36, 44, 61, 88].map((size) => {
                  return (
                    <button
                      key={size}
                      onClick={() => {
                        const numKeys = Number(size);
                        let whiteKeys = 52;
                        if (numKeys === 61) whiteKeys = 36;
                        if (numKeys === 44) whiteKeys = 25;
                        if (numKeys === 36) whiteKeys = 21;
                        const ratio = whiteKeys / 52;
                        
                        useStore.getState().updateSettings({ 
                          keyboardSize: numKeys as any
                        });
                      }}
                      className={`py-2 text-sm font-bold rounded-lg transition-all duration-200 ${Number(currentKeyboardSize) === size ? 'bg-white/20 text-white shadow-lg' : 'bg-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                    >
                      {size}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div className="text-sm text-gray-400 font-semibold tracking-wider uppercase">Supabase Library</div>

              {/* Render Library Songs */}
              {librarySongs.length > 0 && (
                <div className="flex flex-col gap-2 max-h-[18.75rem] overflow-y-auto pr-1">
                  {librarySongs.map((song) => (
                    <button
                      key={song.id}
                      onClick={() => handleLoadLibrarySong(song, difficulty)}
                      disabled={uploading}
                      className="text-left flex items-center gap-2 px-3 py-2.5 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg text-teal-300 text-base transition-colors duration-200 truncate"
                    >
                      <IconMusic /> <span className="truncate">{song.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── Bottom Controls ───────────────────────────────────────────── */}
        <div className={`absolute left-1/2 -translate-x-1/2 flex flex-col gap-4 items-center transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] pointer-events-auto group ${originalSong ? 'opacity-100' : 'opacity-0 translate-y-8 pointer-events-none'} ${isPlaying ? 'bottom-0 translate-y-[65%] hover:translate-y-0' : 'bottom-4 translate-y-0'}`}>
          <div className={`transition-all duration-700 bg-[#0a0a12]/70 backdrop-blur-3xl border border-white/10 shadow-[0_16px_60px_rgba(0,0,0,0.7)] flex flex-col items-center overflow-hidden ${isPlaying ? 'rounded-t-2xl px-6 py-2 gap-0 border-b-0' : 'rounded-3xl px-4 py-3 gap-3'}`}>
            
            {/* Play/Pause/Stop */}
            <div className={`flex items-center transition-all duration-700 ${isPlaying ? 'gap-0' : 'gap-4'}`}>
              <div className={`transition-all duration-700 overflow-hidden ${isPlaying ? 'w-0 opacity-0' : 'w-[2.625rem] opacity-100'}`}>
                <button
                  onClick={handleStop}
                  className="w-[2.625rem] h-[2.625rem] flex items-center justify-center rounded-full border border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white transition-all duration-200"
                  title="Stop"
                >
                  <IconStop />
                </button>
              </div>

              <button
                onClick={handlePlayPause}
                className={`flex items-center justify-center font-bold transition-all duration-700 ${isPlaying ? 'text-gray-400 hover:text-white bg-transparent shadow-none p-0 w-[2.625rem] h-[1.5rem]' : 'bg-gradient-to-r from-teal-500 to-purple-600 text-white shadow-teal-900/30 shadow-xl hover:shadow-teal-900/50 hover:scale-105 rounded-full px-4 py-1.5 gap-2 text-sm w-[5.625rem]'}`}
              >
                {isPlaying ? <IconPause /> : <IconPlay />}
                <span className={`transition-all duration-700 overflow-hidden whitespace-nowrap ${isPlaying ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>
                  Play
                </span>
              </button>
            </div>

            {/* Speed control */}
            <div className={`flex flex-col items-center transition-all duration-700 overflow-hidden ${isPlaying ? 'max-h-0 opacity-0' : 'max-h-[6.25rem] opacity-100'}`}>
              <div className="text-xs text-gray-400 font-semibold tracking-widest uppercase mb-2">Speed</div>
              <div className="flex gap-1 bg-black/40 p-1 rounded-xl">
                {SPEED_STEPS.map((s) => (
                  <button
                    key={s}
                    onClick={() => handleSpeedChange(s)}
                    className={`px-3 py-1.5 text-sm font-bold rounded-lg transition-all duration-200 ${playbackRate === s ? 'bg-gradient-to-br from-teal-400 to-purple-400 text-white shadow-md' : 'bg-transparent text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
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

function IconMusic() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18V5l12-2v13"></path>
      <circle cx="6" cy="18" r="3"></circle>
      <circle cx="18" cy="16" r="3"></circle>
    </svg>
  );
}

function IconKeyboard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="2" ry="2"></rect>
      <line x1="6" y1="4" x2="6" y2="12"></line>
      <line x1="10" y1="4" x2="10" y2="12"></line>
      <line x1="14" y1="4" x2="14" y2="12"></line>
      <line x1="18" y1="4" x2="18" y2="12"></line>
      <line x1="2" y1="12" x2="22" y2="12"></line>
    </svg>
  );
}

function IconAutoPlay() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
    </svg>
  );
}

function IconPalette() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle>
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle>
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle>
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle>
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.6 1.5-1.5 0-.4-.1-.7-.3-1-.2-.3-.3-.7-.3-1.1 0-.8.7-1.4 1.5-1.4h2.1c3.1 0 5.6-2.5 5.6-5.6C22 6.5 17.5 2 12 2z"></path>
    </svg>
  );
}

function IconMic() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="22"></line>
    </svg>
  );
}
