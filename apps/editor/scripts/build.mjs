import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = require(join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript')); }
await mkdir('dist', { recursive: true });
await copyFile('index.html', 'dist/index.html');
await copyFile('src/styles.css', 'dist/styles.css');
// Use the TypeScript parser rather than regex so code examples inside strings
// are preserved. Only local modules from this explicit allowlist are bundled.
const names = ['model', 'zip', 'spine', 'images', 'io', 'app'];
const chunks = ['(()=>{const factories=Object.create(null), cache=Object.create(null);'];
for (const name of names) {
  const source = await readFile(`dist/${name}.js`, 'utf8');
  const ast = ts.createSourceFile(`${name}.js`, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const dependency = statement.moduleSpecifier.text;
    if (!names.some(n => dependency === `./${n}.js`)) throw new Error(`Unsupported import: ${dependency}`);
  }
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  chunks.push(`factories['./${name}.js']=(module,exports,require)=>{\n${js}\n};`);
}
chunks.push(`function require(id){if(cache[id])return cache[id].exports;if(!factories[id])throw new Error('Unknown module: '+id);const m={exports:{}};cache[id]=m;factories[id](m,m.exports,require);return m.exports;}require('./app.js');})();`);
const code = chunks.join('\n');
await writeFile('dist/standalone.js', code);
const css = await readFile('src/styles.css', 'utf8');
const html = (await readFile('index.html', 'utf8'))
  .replace('<link rel="stylesheet" href="./styles.css">', () => `<style>${css}</style>`)
  .replace('<script type="module" src="./app.js"></script>', () => `<script>${code.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile('dist/AI-Bone-Studio.html', html);
console.log('Built dist/ and dist/AI-Bone-Studio.html (standalone, no network dependencies).');
