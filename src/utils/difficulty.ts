"use client";
import type { ParsedSong, NoteEvent } from '../midi/types'

export type Difficulty = "easy" | "medium" | "expert";

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

// ─── Track Analysis ─────────────────────────────────────────────────────────

type TrackStats = {
  id: number;
  count: number;
  avgPitch: number;
  polyRatio: number;
}

function analyzeTracks(notes: NoteEvent[]): { melodyTrack: number, bassTrack: number } {
  const trackGroups = new Map<number, NoteEvent[]>();
  for (const n of notes) {
    if (!trackGroups.has(n.track)) trackGroups.set(n.track, []);
    trackGroups.get(n.track)!.push(n);
  }

  const stats: TrackStats[] = [];
  for (const [id, tNotes] of trackGroups.entries()) {
    // Pitch
    let sumPitch = 0;
    for (const n of tNotes) sumPitch += n.midi;
    const avgPitch = sumPitch / tNotes.length;

    // Polyphony
    let overlaps = 0;
    for (let i = 0; i < tNotes.length - 1; i++) {
      if (tNotes[i+1].time < tNotes[i].time + tNotes[i].duration - 0.01) overlaps++;
    }
    const polyRatio = overlaps / tNotes.length;

    stats.push({ id, count: tNotes.length, avgPitch, polyRatio });
  }

  // Sort by note count descending to avoid picking a 5-note track
  stats.sort((a, b) => b.count - a.count);

  // Melody track: prefers avg pitch 60-84, favors lower polyphony
  let melodyTrack = stats[0].id;
  let bestMelodyScore = -Infinity;
  
  // Bass track: prefers avg pitch < 60
  let bassTrack = stats[0].id;
  let bestBassScore = -Infinity;

  for (const s of stats) {
    // Only consider tracks with a meaningful amount of notes (at least 5% of max)
    if (s.count < stats[0].count * 0.05) continue;

    let mScore = 0;
    if (s.avgPitch >= 60 && s.avgPitch <= 84) mScore += 50; // vocal range
    else if (s.avgPitch > 84) mScore -= 20; // too high (piccolo/bells)
    else mScore -= 20; // too low
    mScore -= s.polyRatio * 30; // penalize highly polyphonic tracks
    mScore += (s.count / stats[0].count) * 20; // favor tracks with more notes

    if (mScore > bestMelodyScore) {
      bestMelodyScore = mScore;
      melodyTrack = s.id;
    }

    let bScore = 0;
    if (s.avgPitch < 60) bScore += 50; // bass range
    bScore += (s.count / stats[0].count) * 20;
    if (bScore > bestBassScore) {
      bestBassScore = bScore;
      bassTrack = s.id;
    }
  }

  // Fallback if no distinct bass track was found
  if (bestBassScore === -Infinity) bassTrack = melodyTrack;

  return { melodyTrack, bassTrack };
}

// ─── Reductions ─────────────────────────────────────────────────────────────

function reduceMedium(song: ParsedSong, clusters: NoteEvent[][], roles: { melodyTrack: number, bassTrack: number }): NoteEvent[] {
  const out: NoteEvent[] = [];
  
  for (const cluster of clusters) {
    // Filter to notes in our primary tracks to avoid stray percussion/flute noise
    const validNotes = cluster.filter(n => n.track === roles.melodyTrack || n.track === roles.bassTrack);
    if (validNotes.length === 0) continue; // cluster was just noise tracks
    
    if (validNotes.length <= 2) {
      out.push(...validNotes);
      continue;
    }

    const melodyNotes = validNotes.filter(n => n.track === roles.melodyTrack);
    const bassNotes = validNotes.filter(n => n.track === roles.bassTrack);

    // Get the skyline melody (highest pitch of melody track)
    const top = melodyNotes.length > 0 
      ? melodyNotes.reduce((top, n) => (n.midi > top.midi ? n : top))
      : validNotes.reduce((top, n) => (n.midi > top.midi ? n : top));
      
    // Get the baseline bass (lowest pitch of bass track)
    const bottom = bassNotes.length > 0
      ? bassNotes.reduce((low, n) => (n.midi < low.midi ? n : low))
      : validNotes.reduce((low, n) => (n.midi < low.midi ? n : low));

    out.push(top);
    if (bottom.id !== top.id) out.push(bottom);
  }
  return out;
}

function reduceEasy(song: ParsedSong, clusters: NoteEvent[][], roles: { melodyTrack: number, bassTrack: number }): NoteEvent[] {
  const out: NoteEvent[] = [];
  
  let windowNotes: NoteEvent[] = [];
  let windowEnd = -Infinity;

  const flushWindow = () => {
    if (windowNotes.length === 0) return;
    // Pick the longest note in the window (most likely structural melody)
    const chosen = windowNotes.reduce((best, n) =>
      n.duration > best.duration ? n : best
    );
    out.push(chosen);
    windowNotes = [];
  };

  for (const cluster of clusters) {
    const melodyNotes = cluster.filter(n => n.track === roles.melodyTrack);
    if (melodyNotes.length === 0) continue;

    const top = melodyNotes.reduce((top, n) => (n.midi > top.midi ? n : top));
    
    if (top.time >= windowEnd) {
      flushWindow();
      windowNotes = [top];
      const bpm = getTempoAt(song, top.time);
      const beatDuration = 60 / bpm;
      windowEnd = top.time + (beatDuration * 0.5); // Half-beat window
    } else {
      windowNotes.push(top);
    }
  }
  flushWindow();

  // Add bass root on downbeats
  const downbeats = getDownbeats(song);
  let nextDownbeatIdx = 0;
  
  for (const cluster of clusters) {
    const bassNotes = cluster.filter(n => n.track === roles.bassTrack);
    if (bassNotes.length === 0) continue;

    const time = cluster[0].time;
    while (nextDownbeatIdx < downbeats.length && time > downbeats[nextDownbeatIdx] + 0.15) {
      nextDownbeatIdx++;
    }
    
    if (nextDownbeatIdx < downbeats.length) {
      const dbTime = downbeats[nextDownbeatIdx];
      if (Math.abs(time - dbTime) <= 0.15) {
        const bottom = bassNotes.reduce((low, n) => (n.midi < low.midi ? n : low));
        out.push(bottom);
        nextDownbeatIdx++;
      }
    }
  }
  
  const unique = new Map<number, NoteEvent>();
  for (const n of out) unique.set(n.id, n);
  
  return Array.from(unique.values());
}

export function applyDifficulty(song: ParsedSong, difficulty: Difficulty): ParsedSong {
  if (difficulty === "expert" || !song.notes.length) return song;

  const sortedNotes = [...song.notes].sort((a, b) => a.time - b.time);
  
  // Isolate the melody and bass tracks
  const roles = analyzeTracks(sortedNotes);
  
  const clusters = clusterByOnset(sortedNotes);

  const newNotes =
    difficulty === "medium" 
      ? reduceMedium(song, clusters, roles) 
      : reduceEasy(song, clusters, roles);

  newNotes.sort((a, b) => a.time - b.time);

  return {
    ...song,
    notes: newNotes,
  };
}

export function getAllowedMidiNotes(
  filteredSong: ParsedSong | null,
  difficulty: Difficulty,
): Set<number> | null {
  if (difficulty === "expert" || !filteredSong) return null;
  const set = new Set<number>();
  for (const n of filteredSong.notes) set.add(n.midi);
  return set;
}