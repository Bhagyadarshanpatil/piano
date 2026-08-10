import sys
import os
import mido
import numpy as np
from sklearn.mixture import GaussianMixture

def get_absolute_notes(mid):
    """
    Parses a mido.MidiFile and returns a list of notes with absolute timing.
    Each note is a dict: { 'pitch': int, 'velocity': int, 'start': float, 'end': float, 'track_idx': int, 'msg': mido.Message }
    """
    notes = []
    
    for i, track in enumerate(mid.tracks):
        abs_time = 0.0
        active_notes = {}  # pitch -> note dict
        
        for msg in track:
            # mido times are in ticks. Convert to absolute time (seconds) if tempo is known,
            # or just use cumulative ticks since we just need relative clustering.
            # Using ticks is fine for clustering and filtering.
            abs_time += msg.time
            
            if msg.type == 'note_on' and msg.velocity > 0:
                # Start note
                active_notes[msg.note] = {
                    'pitch': msg.note,
                    'velocity': msg.velocity,
                    'start': abs_time,
                    'end': abs_time, # Will be updated on note_off
                    'track_idx': i,
                    'msg_on': msg
                }
            elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                if msg.note in active_notes:
                    note = active_notes.pop(msg.note)
                    note['end'] = abs_time
                    notes.append(note)
                    
        # Flush any hanging notes
        for note in active_notes.values():
            note['end'] = abs_time
            notes.append(note)
            
    return notes

def cluster_notes(notes):
    """
    Uses Gaussian Mixture Models to cluster notes into Melody, Accompaniment, and Bass.
    """
    if len(notes) == 0:
        return notes
        
    # Features: [pitch, velocity]
    X = np.array([[n['pitch'], n['velocity']] for n in notes])
    
    # We assume 3 clusters: Melody (High pitch), Accompaniment (Mid pitch), Bass (Low pitch)
    # If the song is very simple, GMM might fail, so we fallback gracefully.
    n_components = min(3, len(np.unique(X[:, 0])))
    
    gmm = GaussianMixture(n_components=n_components, random_state=42)
    labels = gmm.fit_predict(X)
    
    # Identify which cluster is which by their mean pitch
    means = gmm.means_[:, 0]
    sorted_indices = np.argsort(means)
    
    if n_components == 3:
        bass_label = sorted_indices[0]
        acc_label = sorted_indices[1]
        melody_label = sorted_indices[2]
    elif n_components == 2:
        bass_label = sorted_indices[0]
        acc_label = sorted_indices[0] # Merge bass and acc
        melody_label = sorted_indices[1]
    else:
        bass_label = acc_label = melody_label = 0
        
    for i, n in enumerate(notes):
        lbl = labels[i]
        if lbl == melody_label:
            n['cluster'] = 'melody'
        elif lbl == bass_label:
            n['cluster'] = 'bass'
        else:
            n['cluster'] = 'accompaniment'
            
    return notes

def generate_easy(mid, notes, output_path):
    """
    Easy Mode: Strictly isolate the ML-identified Melody cluster.
    Apply a basic heuristic (keeping only the highest pitch if start-times overlap) to ensure 100% monophonic.
    """
    melody_notes = [n for n in notes if n['cluster'] == 'melody']
    
    # Sort by start time, then by pitch descending
    melody_notes.sort(key=lambda x: (x['start'], -x['pitch']))
    
    # Monophonic filter: Keep only the highest pitch for any given start-time window (e.g., 50 ticks)
    monophonic_notes = []
    last_start = -1000
    
    for n in melody_notes:
        # If this note starts at roughly the same time as the last one we added, skip it 
        # (since we sorted by pitch descending, the first one we add is the highest)
        if n['start'] > last_start + 50: 
            monophonic_notes.append(n)
            last_start = n['start']
            
    reconstruct_midi(mid, monophonic_notes, output_path)

def generate_medium(mid, notes, output_path):
    """
    Medium Mode: Keep Melody and Bass. Prune Accompaniment (remove fast notes).
    """
    # Calculate average duration of accompaniment notes to identify "fast" notes
    acc_notes = [n for n in notes if n['cluster'] == 'accompaniment']
    if acc_notes:
        durations = [n['end'] - n['start'] for n in acc_notes]
        median_dur = np.median(durations)
    else:
        median_dur = 0
        
    filtered_notes = []
    for n in notes:
        if n['cluster'] in ['melody', 'bass']:
            filtered_notes.append(n)
        elif n['cluster'] == 'accompaniment':
            duration = n['end'] - n['start']
            # Keep structural chords (longer notes), discard fast arpeggios
            if duration >= median_dur * 0.8: 
                filtered_notes.append(n)
                
    reconstruct_midi(mid, filtered_notes, output_path)

def reconstruct_midi(original_mid, filtered_notes, output_path):
    """
    Rebuilds a MIDI file keeping only the filtered_notes, preserving tempo and other meta messages.
    """
    new_mid = mido.MidiFile(ticks_per_beat=original_mid.ticks_per_beat)
    
    # Group notes by track
    notes_by_track = {}
    for n in filtered_notes:
        t = n['track_idx']
        if t not in notes_by_track:
            notes_by_track[t] = []
        notes_by_track[t].append(n)
        
    for i, orig_track in enumerate(original_mid.tracks):
        new_track = mido.MidiTrack()
        new_mid.tracks.append(new_track)
        
        # Extract meta messages (tempo, time signature, etc.)
        meta_msgs = []
        abs_time = 0
        for msg in orig_track:
            abs_time += msg.time
            if msg.is_meta or msg.type not in ['note_on', 'note_off']:
                meta_msgs.append((abs_time, msg))
                
        # Get note events for this track
        track_notes = notes_by_track.get(i, [])
        events = []
        for n in track_notes:
            events.append((n['start'], 'note_on', n['pitch'], n['velocity']))
            events.append((n['end'], 'note_off', n['pitch'], 0))
            
        # Combine and sort all events by absolute time
        all_events = []
        for time, msg in meta_msgs:
            all_events.append({'time': time, 'type': 'meta', 'msg': msg})
        for time, ev_type, pitch, vel in events:
            all_events.append({'time': time, 'type': ev_type, 'pitch': pitch, 'velocity': vel})
            
        # Sort by time. If tie, note_off before note_on
        all_events.sort(key=lambda x: (x['time'], 0 if x['type'] == 'note_off' else 1))
        
        # Convert absolute time back to delta time
        last_time = 0
        for ev in all_events:
            delta = int(ev['time'] - last_time)
            last_time = ev['time']
            
            if ev['type'] == 'meta':
                msg = ev['msg'].copy()
                msg.time = delta
                new_track.append(msg)
            else:
                msg_type = ev['type']
                new_track.append(mido.Message(msg_type, note=ev['pitch'], velocity=ev['velocity'], time=delta))
                
    new_mid.save(output_path)
    print(f"Saved: {output_path}")

def process_file(filepath, out_dir=None):
    print(f"Processing: {filepath}")
    mid = mido.MidiFile(filepath)
    
    notes = get_absolute_notes(mid)
    print(f"Found {len(notes)} notes.")
    
    notes = cluster_notes(notes)
    
    # Determine base name for outputs
    file_basename = os.path.basename(filepath)
    name_only = os.path.splitext(file_basename)[0]
    
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        base_path = os.path.join(out_dir, name_only)
    else:
        # Default to same directory as input
        base_path = os.path.splitext(filepath)[0]
    
    # Save Expert (Original)
    expert_path = f"{base_path}_expert.mid"
    mid.save(expert_path)
    print(f"Saved: {expert_path}")
    
    # Save Medium
    medium_path = f"{base_path}_medium.mid"
    generate_medium(mid, notes, medium_path)
    
    # Save Easy
    easy_path = f"{base_path}_easy.mid"
    generate_easy(mid, notes, easy_path)
    
    print("Done!")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python generate_difficulties.py <path_to_midi_file>")
        sys.exit(1)
        
    process_file(sys.argv[1])
