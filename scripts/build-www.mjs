// Build www/ for Capacitor iOS bundling — Apple 2.5.2 compliant.
//
// Produces a fully self-contained native bundle: no remote CDN code.
//  - Copies local vendor React / ReactDOM (production) + Supabase UMD into www/vendor/
//  - Transpiles the inline `<script type="text/babel">` app block  -> www/app.js
//  - Transpiles ios-frame.jsx                                     -> www/ios-frame.js
//  - Rewrites www/index.html to load the local files (no unpkg/jsdelivr/text-babel)
//
// The repo-root index.html (dev/web/Vercel) is NEVER modified — only www/ output.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

// Babel standalone (build-time only; never shipped into www/)
const Babel = require('./vendor/babel.min.js');

function transpile(src, filename) {
  // presets:['react'] → JSX only. Modern JS is left untouched.
  return Babel.transform(src, { presets: ['react'], filename }).code;
}

// ── read source index.html ────────────────────────────────────
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// ── 1) extract inline `<script type="text/babel">…</script>` app block ──
// The inline block opens with EXACTLY `<script type="text/babel">` (no src),
// which does not collide with `<script type="text/babel" src="ios-frame.jsx">`.
const OPEN = '<script type="text/babel">';
const openIdx = html.indexOf(OPEN);
if (openIdx === -1) throw new Error('inline <script type="text/babel"> block not found');
const contentStart = openIdx + OPEN.length;
const closeIdx = html.indexOf('</script>', contentStart);
if (closeIdx === -1) throw new Error('closing </script> for inline app block not found');
const appCode = html.slice(contentStart, closeIdx);
const blockEnd = closeIdx + '</script>'.length;
// splice the whole <script…>…</script> span out, replace with app.js reference.
// `defer` is REQUIRED: text/babel scripts are executed by Babel standalone at
// DOMContentLoaded (after <div id="root"> exists). A plain sync script here would
// run at parse time — before #root — and the app would never mount.
html = html.slice(0, openIdx) + '<script src="app.js" defer></script>' + html.slice(blockEnd);

// ── 2) ios-frame.jsx (text/babel with src) → ios-frame.js ──────
const iosFrameSrc = fs.readFileSync(path.join(ROOT, 'ios-frame.jsx'), 'utf8');
const iosFrameOut = transpile(iosFrameSrc, 'ios-frame.jsx');
const IOS_TAG = '<script type="text/babel" src="ios-frame.jsx"></script>';
if (!html.includes(IOS_TAG)) throw new Error('ios-frame.jsx script tag not found');
html = html.replace(IOS_TAG, '<script src="ios-frame.js" defer></script>'); // defer: same DOMContentLoaded timing as text/babel

// ── 3) swap remote vendor <script> tags for local production copies ──
// indexOf-based span replacement keyed on the remote URL (integrity hashes vary,
// so we don't hardcode the full tag text).
function replaceScriptByUrl(str, urlSub, replacement) {
  const u = str.indexOf(urlSub);
  if (u === -1) throw new Error('remote script not found: ' + urlSub);
  const start = str.lastIndexOf('<script', u);
  const end = str.indexOf('</script>', u) + '</script>'.length;
  return str.slice(0, start) + replacement + str.slice(end);
}
// Babel standalone is a runtime transpiler — no longer needed → remove entirely.
html = replaceScriptByUrl(html, 'unpkg.com/@babel/standalone', '');
html = replaceScriptByUrl(html, 'unpkg.com/react-dom@', '<script src="vendor/react-dom.production.min.js"></script>');
html = replaceScriptByUrl(html, 'unpkg.com/react@', '<script src="vendor/react.production.min.js"></script>');
html = replaceScriptByUrl(html, '@supabase/supabase-js', '<script src="vendor/supabase.js"></script>');

// ── write www/ ─────────────────────────────────────────────────
fs.rmSync(WWW, { recursive: true, force: true });
fs.mkdirSync(path.join(WWW, 'vendor'), { recursive: true });

fs.writeFileSync(path.join(WWW, 'index.html'), html);
fs.writeFileSync(path.join(WWW, 'app.js'), transpile(appCode, 'app.jsx'));
fs.writeFileSync(path.join(WWW, 'ios-frame.js'), iosFrameOut);

// vendor copies (committed local sources)
for (const f of ['react.production.min.js', 'react-dom.production.min.js', 'supabase.js']) {
  fs.copyFileSync(path.join(ROOT, 'vendor', f), path.join(WWW, 'vendor', f));
}

// image/ assets
fs.cpSync(path.join(ROOT, 'image'), path.join(WWW, 'image'), { recursive: true });

console.log('✓ www/ built (self-contained, no remote code)');
