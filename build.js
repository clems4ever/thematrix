// Builds the site into dist/: inlines shaders/ into matrix.js.
const fs = require('fs'), path = require('path');
const root = __dirname, out = path.join(root, 'dist');

// Reads a shader, replacing '#include "file"' lines with that file's source.
function shader(file) {
  const src = fs.readFileSync(path.join(root, 'shaders', file), 'utf8');
  return src.replace(/^\s*#include\s+"(.+)"\s*$/gm, (_, f) => shader(f).trimEnd());
}

const js = fs.readFileSync(path.join(root, 'matrix.js'), 'utf8')
  .replace(/shader\('([^']+)'\)/g, (_, f) => JSON.stringify(shader(f)));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
fs.writeFileSync(path.join(out, 'matrix.js'), js);
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
