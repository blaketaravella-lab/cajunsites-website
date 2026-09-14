import fs from 'node:fs';

const shell = fs.readFileSync('src/components/AdminShell.astro','utf8');
const css = fs.readFileSync('src/styles/admin-sidebar-clean.css','utf8');
const global = fs.readFileSync('src/styles/global.css','utf8');
const must = (condition, message) => { if (!condition) throw new Error(message); };

must(shell.includes('class="nav-group-label"'), 'Admin shell must render explicit navigation group labels.');
must(css.includes('body.cs-admin .sidebar > .nav-group > .nav-group-label'), 'Final sidebar layer must target nav-group-label.');
must(css.includes('grid-template-rows: auto auto !important'), 'Navigation groups must reserve separate rows for labels and links.');
must(css.includes('grid-row: 1 !important'), 'Navigation labels must occupy their own grid row.');
must(css.includes('grid-row: 2 !important'), 'Navigation links must occupy a separate grid row.');
must(css.includes('height: 40px !important'), 'Navigation links must preserve a stable row height.');
must(global.trim().endsWith("@import './admin-sidebar-clean.css';"), 'Final stable sidebar composition must load last in the admin CSS stack.');

console.log('Admin navigation invariants passed.');
