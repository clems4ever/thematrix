// Builds the site into dist/: inlines shaders/ into matrix.js and minifies everything.
const fs = require('fs'), path = require('path');
const esbuild = require('esbuild');
const root = __dirname, out = path.join(root, 'dist');

// Reads a shader, replacing '#include "file"' lines with that file's source.
function shader(file) {
  const src = fs.readFileSync(path.join(root, 'shaders', file), 'utf8');
  return src.replace(/^\s*#include\s+"(.+)"\s*$/gm, (_, f) => shader(f).trimEnd());
}

// Strips comments and whitespace. Preprocessor lines keep their own line.
// Spaces around + and - are kept so that e.g. "a - -b" cannot become "a--b".
function minifyGlsl(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => l.startsWith('#') ? `\n${l}\n` : l.replace(/\s+/g, ' ').replace(/\s*([{}()[\];,=*/<>!&|?:])\s*/g, '$1'))
    .join(' ')
    .replace(/ *\n */g, '\n').replace(/^\n/, '');
}

const js = fs.readFileSync(path.join(root, 'matrix.js'), 'utf8')
  .replace(/shader\('([^']+)'\)/g, (_, f) => JSON.stringify(minifyGlsl(shader(f))));

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  .replace(/<style>([\s\S]*?)<\/style>/, (_, css) =>
    `<style>${esbuild.transformSync(css, { loader: 'css', minify: true }).code.trim()}</style>`)
  .replace(/>\s+</g, '><');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
fs.writeFileSync(path.join(out, 'matrix.js'), esbuild.transformSync(js, { minify: true, target: 'es2020' }).code);
fs.writeFileSync(path.join(out, 'index.html'), html);
