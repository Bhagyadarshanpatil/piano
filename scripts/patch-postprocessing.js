const fs = require('node:fs')
const path = require('node:path')

const distDir = path.join(__dirname, '..', 'node_modules', '@react-three', 'postprocessing', 'dist')

function patchFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  
  // We're looking to extract `ref` from the props object in wrapEffect,
  // preventing it from entering JSON.stringify(props) in React 19 where
  // ref is passed as a standard prop.
  const regex1 = /function\(\{blendFunction:([^=]+)=([^,]+),opacity:([^=]+)=([^,]+),\.\.\.([^\}]+)\}\)\{/;
  const regex2 = /\/\*@__PURE__\*\/([a-zA-Z0-9_$]+)\(([^,]+),\{camera:([^,]+),"blendMode-blendFunction":([^,]+),"blendMode-opacity-value":([^,]+),\.\.\.([^,]+),args:([^\}]+)\}\)/;

  if (source.includes('ref:__patchRef')) {
    return false // Already patched
  }

  if (regex1.test(source) && regex2.test(source)) {
    let next = source.replace(regex1, 'function({blendFunction:$1=$2,opacity:$3=$4,ref:__patchRef,...$5}){');
    next = next.replace(regex2, '/*@__PURE__*/$1($2,{ref:__patchRef,camera:$3,"blendMode-blendFunction":$4,"blendMode-opacity-value":$5,...$6,args:$7})');
    
    fs.writeFileSync(filePath, next)
    return true
  }

  throw new Error(`Unable to patch ${filePath}: regex patterns didn't match.`)
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.warn('Skipping postprocessing patch: dist directory not found.')
    return
  }

  const files = fs
    .readdirSync(distDir)
    .filter((name) => /^index\.(js|cjs|mjs)$/.test(name))

  let patched = 0
  for (const name of files) {
    if (patchFile(path.join(distDir, name))) {
      patched += 1
    }
  }

  if (patched > 0) {
    console.log(`Patched ${patched} react-three-postprocessing bundle(s) for React 19 ref support.`)
  } else {
    console.log('react-three-postprocessing patch already applied.')
  }
}

main()
