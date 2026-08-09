"use client";

import { useState, useEffect, useCallback } from "react";
import { Scene } from "../scene/Scene";
import { useStore } from "../store";
import { audioEngine } from "../audio/engine";
import { parseMidi } from "../midi/parse";
import { playSong, pauseSong } from "../audio/playback";
import { applyDifficulty, getAllowedMidiNotes, type Difficulty } from "../utils/difficulty";
import type { ParsedSong } from "../midi/types";

// ── Module-level ref: set of MIDI pitches the user is allowed to press.
// null = no restriction (expert mode). Written by ClientApp whenever the
// difficulty or song changes; read by Keyboard.tsx and pcInput.ts.
export let allowedMidiNotes: Set<number> | null = null;

// ── Icons (inline SVG — no extra deps) ─────────────────────────────────────
function IconUpload() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/>
      <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
  );
}
function IconPlay() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  );
}
function IconPause() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16"/>
      <rect x="14" y="4" width="4" height="16"/>
    </svg>
  );
}
function IconStop() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
    </svg>
  );
}

const SPEED_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export default function ClientApp() {
  const [difficulty, setDifficulty] = useState<Difficulty>("expert");
  const [originalSong, setOriginalSong] = useState<ParsedSong | null>(null);
  const [songName, setSongName]         = useState<string>("");
  const [loadProgress, setLoadProgress] = useState<{ loaded: number; total: number } | null>(null);
  const [uploading, setUploading]       = useState(false);
  // practiceMode = true  → MIDI track is muted; user must press keys to hear notes.
  // practiceMode = false → MIDI track plays automatically (classic playback).
  const [practiceMode, setPracticeMode] = useState(true);

  const transport   = useStore((s) => s.transport);
  const playbackRate = useStore((s) => s.settings.playbackRate);

  const isPlaying = transport === "playing";

  // Apply difficulty whenever it or the base song changes
  useEffect(() => {
    if (!originalSong) return;
    const filtered = applyDifficulty(originalSong, difficulty);
    // Update the allowed-notes gate for keyboard / PC-input
    allowedMidiNotes = getAllowedMidiNotes(filtered, difficulty);
    useStore.getState().setSong(filtered, { resetTimeline: false });
  }, [difficulty, originalSong]);

  // Sync practiceMode → audio engine: mute only auto-scheduled song notes.
  // triggerKey() (user key presses) always stays audible.
  useEffect(() => {
    audioEngine.setSongPlaybackMuted(practiceMode);
  }, [practiceMode]);

  // Keep audio engine rate in sync with store
  useEffect(() => {
    audioEngine.setRate(playbackRate);
  }, [playbackRate]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input so same file can be re-uploaded
    e.target.value = "";

    setUploading(true);
    setLoadProgress(null);

    try {
      // Start audio engine load immediately on user gesture
      if (!audioEngine.isReady()) {
        audioEngine.init((p) => setLoadProgress(p)).catch(console.error);
      }

      const arrayBuffer = await file.arrayBuffer();
      const parsedSong  = await parseMidi(arrayBuffer, file.name);

      setOriginalSong(parsedSong);
      setSongName(file.name.replace(/\.midi?$/i, ""));

      // Load into store (engine.loadSong is called inside setSong)
      const filtered = applyDifficulty(parsedSong, difficulty);
      // Update allowed-notes gate
      allowedMidiNotes = getAllowedMidiNotes(filtered, difficulty);
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
      <div className="absolute inset-0 z-10 pointer-events-none p-5 flex flex-col justify-between">

        {/* ── Top panel ───────────────────────────────────────────── */}
        <div
          style={{
            background: "rgba(10,10,18,0.75)",
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: "20px 24px",
            maxWidth: 380,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            pointerEvents: "auto",
            boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
          }}
        >
          {/* Title */}
          <div>
            <h1 style={{
              fontSize: 22,
              fontWeight: 700,
              background: "linear-gradient(135deg,#5eead4,#a78bfa)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              marginBottom: 2,
            }}>
              Aether Keys
            </h1>
            {songName
              ? <p style={{ fontSize: 12, color: "#a0a0b0", marginTop: 2 }}>🎵 {songName}</p>
              : <p style={{ fontSize: 12, color: "#6b6b80" }}>Upload a MIDI file to begin</p>}
          </div>

          {/* Upload button */}
          <label style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "10px 18px",
            background: uploading ? "rgba(94,234,212,0.12)" : "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.13)",
            borderRadius: 10,
            cursor: uploading ? "default" : "pointer",
            fontSize: 14,
            fontWeight: 500,
            transition: "background 0.2s",
          }}
            onMouseEnter={e => { if (!uploading) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.12)" }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = uploading ? "rgba(94,234,212,0.12)" : "rgba(255,255,255,0.07)" }}
          >
            <IconUpload />
            <span>{uploading ? "Loading…" : "Upload MIDI"}</span>
            <input
              type="file"
              accept=".mid,.midi"
              style={{ display: "none" }}
              onChange={handleFileUpload}
              disabled={uploading}
            />
          </label>

          {/* Sample load progress bar */}
          {loadProgress && loadProgress.total > 0 && loadProgress.loaded < loadProgress.total && (
            <div>
              <div style={{ fontSize: 11, color: "#7c7c8a", marginBottom: 4 }}>
                Loading piano samples… {Math.round((loadProgress.loaded / loadProgress.total) * 100)}%
              </div>
              <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2 }}>
                <div style={{
                  height: "100%",
                  width: `${(loadProgress.loaded / loadProgress.total) * 100}%`,
                  background: "linear-gradient(90deg,#5eead4,#a78bfa)",
                  borderRadius: 2,
                  transition: "width 0.3s",
                }} />
              </div>
            </div>
          )}

          {/* ── Controls (Always visible, disabled when no song) ──────────────── */}
          <div style={{ opacity: originalSong ? 1 : 0.4, pointerEvents: originalSong ? "auto" : "none" }}>
            <>
              {/* Difficulty */}
              <div style={{ display: "flex", gap: 4, background: "rgba(0,0,0,0.35)", borderRadius: 8, padding: 4 }}>
                {(["easy", "medium", "expert"] as Difficulty[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    style={{
                      flex: 1,
                      padding: "7px 0",
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 6,
                      border: "none",
                      cursor: "pointer",
                      textTransform: "capitalize",
                      transition: "all 0.15s",
                      background: difficulty === d
                        ? "linear-gradient(135deg,#14b8a6,#6d28d9)"
                        : "transparent",
                      color: difficulty === d ? "#fff" : "#6b6b80",
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>

              {/* Practice / Auto-Play toggle */}
              <button
                onClick={() => setPracticeMode((m) => !m)}
                title={practiceMode ? "MIDI track muted — press keys to play" : "MIDI track plays automatically"}
                style={{
                  width: "100%",
                  padding: "8px 0",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.12)",
                  cursor: "pointer",
                  transition: "all 0.2s",
                  background: practiceMode
                    ? "linear-gradient(135deg,rgba(20,184,166,0.25),rgba(109,40,217,0.25))"
                    : "rgba(255,255,255,0.06)",
                  color: practiceMode ? "#5eead4" : "#6b6b80",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 14 }}>{practiceMode ? "🎹" : "🔊"}</span>
                {practiceMode ? "Practice Mode (press keys)" : "Auto-Play Mode"}
              </button>

              {/* Transport: Play/Pause + Stop */}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={handlePlayPause}
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "11px 0",
                    borderRadius: 10,
                    border: "none",
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 14,
                    background: isPlaying
                      ? "linear-gradient(135deg,#854d0e,#a16207)"
                      : "linear-gradient(135deg,#14b8a6,#6d28d9)",
                    color: "#fff",
                    boxShadow: isPlaying
                      ? "0 4px 20px rgba(202,138,4,0.3)"
                      : "0 4px 20px rgba(20,184,166,0.3)",
                    transition: "all 0.2s",
                  }}
                >
                  {isPlaying ? <IconPause /> : <IconPlay />}
                  {isPlaying ? "Pause" : "Play"}
                </button>
                <button
                  onClick={handleStop}
                  style={{
                    padding: "11px 14px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.1)",
                    cursor: "pointer",
                    background: "rgba(255,255,255,0.05)",
                    color: "#9ca3af",
                    transition: "all 0.2s",
                  }}
                  title="Stop"
                >
                  <IconStop />
                </button>
              </div>

              {/* Speed control */}
              <div>
                <div style={{ fontSize: 11, color: "#7c7c8a", marginBottom: 6, fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Speed — {playbackRate}×
                </div>
                <div style={{ display: "flex", gap: 3 }}>
                  {SPEED_STEPS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSpeedChange(s)}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 6,
                        border: "none",
                        cursor: "pointer",
                        background: playbackRate === s
                          ? "linear-gradient(135deg,#5eead4,#a78bfa)"
                          : "rgba(255,255,255,0.06)",
                        color: playbackRate === s ? "#fff" : "#6b6b80",
                        transition: "all 0.15s",
                      }}
                    >
                      {s}×
                    </button>
                  ))}
                </div>
              </div>
            </>
          </div>
        </div>

        {/* spacer */}
        <div />
      </div>
    </main>
  );
}
