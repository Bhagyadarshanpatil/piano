const fs = require('node:fs')
const path = require('node:path')

const distDir = path.join(__dirname, '..', 'node_modules', '@react-three', 'fiber', 'dist')
const marker = 'function createTimerClock('

function buildFactory(namespace) {
  return `function createTimerClock(${namespace}) {
  let timer
  const connectTimer = () => {
    if (typeof document !== 'undefined' && typeof timer.connect === 'function') {
      timer.connect(document)
    }
  }
  const resetTimer = () => {
    if (timer && typeof timer.dispose === 'function') {
      timer.dispose()
    }
    timer = new ${namespace}.Timer()
    connectTimer()
  }
  resetTimer()
  return {
    autoStart: true,
    running: true,
    elapsedTime: 0,
    oldTime: 0,
    start() {
      this.running = true
      this.elapsedTime = 0
      this.oldTime = 0
      resetTimer()
      return this
    },
    stop() {
      this.running = false
      return this
    },
    getDelta() {
      if (!this.running) return 0
      timer.update()
      this.oldTime = this.elapsedTime
      this.elapsedTime = timer.getElapsed()
      return timer.getDelta()
    },
    getElapsedTime() {
      if (!this.running) return this.elapsedTime
      timer.update()
      this.oldTime = this.elapsedTime
      this.elapsedTime = timer.getElapsed()
      return this.elapsedTime
    }
  }
}

`
}

function patchFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  if (source.includes(marker)) {
    return false
  }

  const namespace = source.includes('new THREE__namespace.Clock()') ? 'THREE__namespace' : 'THREE'
  const next = source
    .replace('var threeTypes =', `${buildFactory(namespace)}var threeTypes =`)
    .replace(`clock: new ${namespace}.Clock(),`, `clock: createTimerClock(${namespace}),`)

  if (next === source) {
    throw new Error(`Unable to patch ${filePath}`)
  }

  fs.writeFileSync(filePath, next)
  return true
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.warn('Skipping react-three-fiber clock patch: dist directory not found.')
    return
  }

  const files = fs
    .readdirSync(distDir)
    .filter((name) => /^events-.*\.(cjs\.dev|cjs\.prod|esm)\.js$/.test(name))

  let patched = 0
  for (const name of files) {
    if (patchFile(path.join(distDir, name))) {
      patched += 1
    }
  }

  if (patched > 0) {
    console.log(`Patched ${patched} react-three-fiber clock bundle(s).`)
  } else {
    console.log('react-three-fiber clock patch already applied.')
  }
}

main()
