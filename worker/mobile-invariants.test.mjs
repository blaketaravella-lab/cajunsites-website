import fs from 'node:fs';

const shell=fs.readFileSync('src/components/AdminShell.astro','utf8');
const engine=fs.readFileSync('worker/visual-family-engine.js','utf8');

const must=(condition,message)=>{if(!condition)throw new Error(message)};

must(shell.includes('class="mobilebar"'),'Admin shell must expose a mobile header.');
must(shell.includes('id="mobileMenu"'),'Admin shell must expose a mobile navigation control.');
must(shell.includes('nav-open'),'Admin shell must support the mobile drawer state.');
must(shell.includes('@media(max-width:700px)'),'Admin shell must include the phone breakpoint.');
must(shell.includes(':global(.admin-table thead){display:none}'),'Admin tables must switch away from desktop headers on phones.');
must(shell.includes('data-label'),'Admin table rows must receive mobile field labels.');
must(shell.includes('min-height:44px'),'Admin mobile controls must meet the touch-target baseline.');
must(shell.includes('env(safe-area-inset-bottom)'),'Admin layout must account for mobile safe areas.');
must(engine.includes('name="viewport" content="width=device-width,initial-scale=1"'),'Concept sites must include the responsive viewport meta tag.');
must(engine.includes('@media(max-width:760px)'),'Concept design system must include a phone/tablet breakpoint.');
must(engine.includes('.intro,.cards,.story,.contact-box{grid-template-columns:1fr}'),'Concept content grids must collapse to one column.');

console.log('Mobile responsiveness invariants passed.');
