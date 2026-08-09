"use client";
import type { ParsedSong, NoteEvent } from '../midi/types'

export type Difficulty = "easy" | "medium" | "expert";

// Notes whose onsets fall within this many seconds of each other are
// treated as one "chord". Reduction always happens WITHIN a chord, never
// across chords — so thinning notes out never shifts *when* something
// plays, only *how many* notes sound at that instant. This is what keeps
// the rhythm (and therefore the recognizable tune) intact.
const CHORD_EPSILON_SEC = 0.05;

// Group already-time-sorted notes into simultaneous clusters.
function clusterByOnset(notes: NoteEvent[]): NoteEvent[][] {
  const clusters: NoteEvent[][] = [];
  let current: NoteEvent[] = [];
  let clusterStart = -Infinity;

  for (const note of notes) {
    if (current.length === 0 || note.time - clusterStart <= CHORD_EPSILON_SEC) {
      if (current.length === 0) clusterStart = note.time;
      current.push(note);
    } else {
      clusters.push(current);
      current = [note];
      clusterStart = note.time;
    }
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

// Piano-writing convention: the highest note in a chord usually carries
// the melody (right hand / top voice); the lowest carries the harmonic
// root (left hand / bass). Keeping both is what preserves the tune's
// shape even after inner voices are dropped.
function melodyNote(cluster: NoteEvent[]): NoteEvent {
  return cluster.reduce((top, n) => (n.midi > top.midi ? n : top));
}
function bassNote(cluster: NoteEvent[]): NoteEvent {
  return cluster.reduce((low, n) => (n.midi < low.midi ? n : low));
}

function getTempoAt(song: ParsedSong, time: number): number {
  if (!song.tempos || song.tempos.length === 0) return 120;
  let best = song.tempos[0].bpm;
  for (const t of song.tempos) {
    if (t.time <= time + 0.001) best = t.bpm;
    else break;
  }
  return best || 120;
}

function getDownbeats(song: ParsedSong): number[] {
  const downbeats: number[] = [];
  const tempos = song.tempos?.length ? song.tempos : [{ time: 0, bpm: 120 }];
  const sigs = song.timeSignatures?.length ? song.timeSignatures : [{ time: 0, timeSignature: [4, 4] }];
  
  let time = 0;
  let tempoIdx = 0;
  let sigIdx = 0;
  
  const end = song.duration + 10;
  
  while (time < end) {
    while (tempoIdx < tempos.length - 1 && time >= tempos[tempoIdx + 1].time - 0.001) tempoIdx++;
    while (sigIdx < sigs.length - 1 && time >= sigs[sigIdx + 1].time - 0.001) sigIdx++;
    
    const bpm = tempos[tempoIdx].bpm || 120;
    const num = sigs[sigIdx].timeSignature[0] || 4;
    
    downbeats.push(time);
    
    const beatDuration = 60 / bpm;
    time += beatDuration * num;
  }
  
  return downbeats;
}

/**
 * MEDIUM — thin dense chords, keep the tune.
 * Every chord keeps its melody note (top voice) and bass note (bottom
 * voice); only inner harmony notes beyond that are dropped. Every
 * rhythmic onset in the original survives — chords just get thinner,
 * not sparser in time.
 */
function reduceMedium(song: ParsedSong, clusters: NoteEvent[][]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const cluster of clusters) {
    if (cluster.length <= 2) {
      out.push(...cluster);
      continue;
    }
    const top = melodyNote(cluster);
    const bottom = bassNote(cluster);
    out.push(top);
    if (bottom.id !== top.id) out.push(bottom);
  }
  return out;
}

/**
 * EASY — single-note melody line + downbeat bass, rhythmically thinned.
 * 1. Thin the melody: limit note density to eighth-notes based on the current tempo.
 * 2. Keep the bass: add the lowest note of the cluster on the first beat of every measure.
 */
function reduceEasy(song: ParsedSong, clusters: NoteEvent[][]): NoteEvent[] {
  const out: NoteEvent[] = [];
  
  // 1. Thin the melody line
  let windowNotes: NoteEvent[] = [];
  let windowEnd = -Infinity;

  const flushWindow = () => {
    if (windowNotes.length === 0) return;
    const chosen = windowNotes.reduce((best, n) =>
      n.duration > best.duration ? n : best
    );
    out.push(chosen);
    windowNotes = [];
  };

  for (const cluster of clusters) {
    const top = melodyNote(cluster);
    if (top.time >= windowEnd) {
      flushWindow();
      windowNotes = [top];
      const bpm = getTempoAt(song, top.time);
      // Window is half a beat (eighth note). Scales naturally with tempo.
      const beatDuration = 60 / bpm;
      windowEnd = top.time + (beatDuration * 0.5);
    } else {
      windowNotes.push(top);
    }
  }
  flushWindow();

  // 2. Add bass root on downbeats
  const downbeats = getDownbeats(song);
  let nextDownbeatIdx = 0;
  
  for (const cluster of clusters) {
    const time = cluster[0].time;
    while (nextDownbeatIdx < downbeats.length && time > downbeats[nextDownbeatIdx] + 0.15) {
      nextDownbeatIdx++;
    }
    
    if (nextDownbeatIdx < downbeats.length) {
      const dbTime = downbeats[nextDownbeatIdx];
      if (Math.abs(time - dbTime) <= 0.15) {
        const bottom = bassNote(cluster);
        out.push(bottom);
        nextDownbeatIdx++; // Consume this downbeat so we only add one bass note per measure
      }
    }
  }
  
  // Deduplicate in case the melody and bass were the same note
  const unique = new Map<number, NoteEvent>();
  for (const n of out) unique.set(n.id, n);
  
  return Array.from(unique.values());
}


export function applyDifficulty(song: ParsedSong, difficulty: Difficulty): ParsedSong {
  if (difficulty === "expert" || !song.notes.length) return song;

  const sortedNotes = [...song.notes].sort((a, b) => a.time - b.time);
  const clusters = clusterByOnset(sortedNotes);

  const newNotes =
    difficulty === "medium" ? reduceMedium(song, clusters) : reduceEasy(song, clusters);

  newNotes.sort((a, b) => a.time - b.time);

  return {
    ...song,
    notes: newNotes,
  };
}

/**
 * Returns the set of MIDI pitches that are playable at the given difficulty,
 * derived from the already-filtered song (the output of applyDifficulty).
 * Returns null for "expert" (all keys are allowed).
 * Used by the keyboard / PC-input layer to restrict which keys trigger sound.
 */
export function getAllowedMidiNotes(
  filteredSong: ParsedSong | null,
  difficulty: Difficulty,
): Set<number> | null {
  if (difficulty === "expert" || !filteredSong) return null;
  const set = new Set<number>();
  for (const n of filteredSong.notes) set.add(n.midi);
  return set;
}