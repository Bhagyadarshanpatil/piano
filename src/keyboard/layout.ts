// Piano: 88 keys, MIDI 21 (A0) .. 108 (C8)
// Top-down layout viewed straight on. White keys are flat planes in XY (a
// keyboard of 88 boxes filled the perspective edges with their side colour
// and tore visible gaps); black keys are boxes that protrude in +Z so the
// flash light at the hit line can cast their silhouette as shadow on the
// adjacent white surfaces.
//   x = lateral position
//   y = position along the keyboard (front=0, back=WHITE_KEY_LENGTH)
//   z = 0 for white keys (plane). Black keys span [0, BLACK_KEY_THICKNESS].
export function getKeyboardBounds(size: number) {
  switch (size) {
    case 36: return { min: 48, max: 83 } // C3..B5
    case 44: return { min: 41, max: 84 } // F2..C6
    case 61: return { min: 36, max: 96 } // C2..C7
    case 88:
    default: return { min: 21, max: 108 } // A0..C8
  }
}

// Proportions follow a real grand piano (mid-spec) at 1mm = 0.01 world units:
//   white key 23.5 × 147.5 mm
//   black key 13.7 × 95 mm × ~9 mm tall above the white surface
// 52 × 0.235 = 12.22 world units total — matches the visible width of the
// default 16:9 viewport (FOV 32, z = 12 → ~12.23) so the keyboard spans
// edge-to-edge with no side gap.
export const WHITE_KEY_WIDTH = 0.235
export const WHITE_KEY_LENGTH = 1.475
export const BLACK_KEY_WIDTH = 0.137
export const BLACK_KEY_LENGTH = 0.95
// Vertical extrusion of the black keys above the white surface. Drives the
// per-fragment shadow projection in the white-key shader (taller key →
// longer shadow), and the press-down animation depth.
export const BLACK_KEY_THICKNESS = 0.09

const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10])

export function isBlackKey(midi: number): boolean {
  return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12)
}

export type KeyInfo = {
  midi: number
  isBlack: boolean
  whiteIndex: number
  x: number // world-x of key center
  yLocal: number // local-y center within the keyboard group (0 = front edge)
  zCenter: number
  width: number
  length: number
  thickness: number
}

function buildLayout(size: number): { keys: KeyInfo[]; totalWidth: number; whiteCount: number } {
  const { min: midiMin, max: midiMax } = getKeyboardBounds(size)
  const keyCount = midiMax - midiMin + 1

  const keys: KeyInfo[] = []
  let whiteIdx = 0
  const whiteIndices: number[] = new Array(keyCount).fill(0)
  const isBlackArr: boolean[] = new Array(keyCount).fill(false)
  for (let i = 0; i < keyCount; i++) {
    const midi = midiMin + i
    const black = isBlackKey(midi)
    isBlackArr[i] = black
    if (!black) {
      whiteIndices[i] = whiteIdx
      whiteIdx++
    } else {
      whiteIndices[i] = whiteIdx - 1
    }
  }
  const whiteCount = whiteIdx
  const totalWidth = whiteCount * WHITE_KEY_WIDTH
  const xOffset = -totalWidth / 2 + WHITE_KEY_WIDTH / 2

  for (let i = 0; i < keyCount; i++) {
    const midi = midiMin + i
    const black = isBlackArr[i]
    const wi = whiteIndices[i]
    const xWhite = xOffset + wi * WHITE_KEY_WIDTH
    const x = black ? xWhite + WHITE_KEY_WIDTH / 2 : xWhite
    keys.push({
      midi,
      isBlack: black,
      whiteIndex: wi,
      x,
      // Front of keyboard is local-y=0 (visually toward bottom of screen).
      // White key center sits at half-length up from the front.
      // Black key sits at the back portion. We extend it 0.01 past the white
      // key's back edge so there's no sub-pixel sliver of white showing
      // through at the shared edge.
      yLocal: black ? WHITE_KEY_LENGTH - BLACK_KEY_LENGTH / 2 + 0.01 : WHITE_KEY_LENGTH / 2,
      // White keys are flat planes (z=0). Black keys are boxes whose
      // BOTTOM sits on z=0; their box-center is at half-thickness so the
      // top face lands at z=BLACK_KEY_THICKNESS.
      zCenter: black ? BLACK_KEY_THICKNESS / 2 : 0,
      width: black ? BLACK_KEY_WIDTH : WHITE_KEY_WIDTH,
      length: black ? BLACK_KEY_LENGTH : WHITE_KEY_LENGTH,
      thickness: black ? BLACK_KEY_THICKNESS : 0,
    })
  }
  return { keys, totalWidth, whiteCount }
}

const layoutCache = new Map<number, ReturnType<typeof buildLayout>>()

export function getKeyboardLayout(size: number) {
  if (!layoutCache.has(size)) {
    layoutCache.set(size, buildLayout(size))
  }
  return layoutCache.get(size)!
}

export function keyForMidi(midi: number, size: number): KeyInfo | null {
  const layout = getKeyboardLayout(size)
  const { min } = getKeyboardBounds(size)
  const idx = midi - min
  if (idx < 0 || idx >= layout.keys.length) return null
  return layout.keys[idx]
}

/**
 * Adjacent black keys for a given white key. White keys can have at most
 * two black neighbours (one on each side, at ±1 semitone). Used by the
 * shadow shader: the white surface only needs to project its immediate
 * neighbours, never every black key on the keyboard.
 */
export function adjacentBlackKeys(midi: number, size: number): {
  left: KeyInfo | null
  right: KeyInfo | null
} {
  const k = keyForMidi(midi, size)
  if (!k || k.isBlack) return { left: null, right: null }
  const candidateLeft = keyForMidi(midi - 1, size)
  const candidateRight = keyForMidi(midi + 1, size)
  return {
    left: candidateLeft && candidateLeft.isBlack ? candidateLeft : null,
    right: candidateRight && candidateRight.isBlack ? candidateRight : null,
  }
}

// Notes hit the back edge of the keyboard.
export function noteHitYWorld(keyboardYWorld: number): number {
  return keyboardYWorld + WHITE_KEY_LENGTH
}

// Fixed 88-key layout used by whiteKeyShader to precompute the maximum possible black key shadows
export const KEYBOARD_LAYOUT_88 = getKeyboardLayout(88)
