import fs from 'node:fs';

const shell=fs.readFileSync('src/components/AdminShell.astro','utf8');
const engine=fs.readFileSync('worker/visual-family-engine.js','utf8');

const must=(condition,message)=>{if(!condition)throw new Error(message)};

must(shell.includes('class="mobilebar"'),'Admin shell must expose a mobile header.');
must(shell.includes('id="mobileMenu"'),'Admin shell must expose a mobile navigation control.');
must(shell.includes('nav-open'),'Admin shell must support the mobile drawer state.');
must(shell.includes('@media(max-width:700px)'),'Admin shell must include the phone breakpoint.');
must(shell.includes('.admin-table thead'){true}:false,'');
