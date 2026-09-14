import fs from 'node:fs';

const shell = fs.readFileSync('src/components/AdminShell.astro','utf8');
const css = fs.readFileSync('src/styles/admin-nav-fix.css','utf8');
const global = fs.readFileSync('src/styles/global.css','utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

must(shell.includes('class="nav-group-label"'), 'Admin shell must render explicit navigation group labels.');
must(css.includes('body.cs-admin .nav-group-label'), 'Navigation hardening must target nav-group-label.');
must(css.includes('position: static !important'), 'Navigation labels must remain in normal document flow.');
must(css.includes('flex-direction: column !important'), 'Navigation groups must stack labels and links vertically.');
must(css.includes('min-height: 38px !important'), 'Navigation links must preserve row height.');
must(global.trim().endsWith("@import './admin-nav-fix.css';"), 'Navigation fix must load last in the admin CSS stack.');

console.log('Admin navigation invariants passed.');
