const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
function isBlackKey(midi) { return BLACK_PITCH_CLASSES.has(((midi % 12) + 12) % 12); }
function getBounds(size) {
  switch(size) { case 36: return [48,83]; case 44: return [41,84]; case 61: return [36,96]; default: return [21,108]; }
}
function test(size) {
  let [midiMin, midiMax] = getBounds(size);
  let keyCount = midiMax - midiMin + 1;
  let whiteIdx = 0;
  let whiteIndices = new Array(keyCount).fill(0);
  let isBlackArr = new Array(keyCount).fill(false);
  let keys = [];
  for (let i = 0; i < keyCount; i++) {
    let midi = midiMin + i;
    let black = isBlackKey(midi);
    isBlackArr[i] = black;
    if (!black) { whiteIndices[i] = whiteIdx; whiteIdx++; } else { whiteIndices[i] = whiteIdx - 1; }
    keys.push({midi, black, wi: whiteIndices[i]});
  }
  console.log('Size', size);
  console.log('First 5:', keys.slice(0,5));
  console.log('Last 5:', keys.slice(-5));
}
test(88); test(61); test(44); test(36);
