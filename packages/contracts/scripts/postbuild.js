// Marks the ESM output directory as ES modules so bundlers/Node parse dist/esm/*.js
// with `export`/`import` syntax (the CJS build in dist/cjs stays CommonJS).
const fs = require('fs');
const path = require('path');

const esmDir = path.join(__dirname, '..', 'dist', 'esm');
fs.mkdirSync(esmDir, { recursive: true });
fs.writeFileSync(path.join(esmDir, 'package.json'), JSON.stringify({ type: 'module' }, null, 2));
console.log('contracts: wrote dist/esm/package.json ({ type: module })');
