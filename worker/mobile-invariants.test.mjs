import fs from 'node:fs';

const shell=fs.readFileSync('src/components/AdminShell.astro','utf8');
const engine=fs.readFileSync('worker/visual-family-engine.js','utf8');
const globalCss=fs.readFileSync('src/styles/global.css','utf8');
const mobileCss=fs.readFileSync('src/styles/admin-mobile-polish.css','utf8');

const must=(condition,message)=>{if(!condition)throw new Error(message)};

must(shell.includes('class="mobilebar"'),'Admin shell must expose a mobile header.');
must(shell.includes('id="mobileMenu"'),'Admin shell must expose a mobile navigation control.');
must(shell.includes('nav-open'),'Admin shell must support the mobile drawer state.');
must(shell.includes('@media(max-width:700px)'),'Admin shell must include the phone breakpoint.');
must(shell.includes(':global(.admin-table thead){display:none}'),'Admin tables must switch away from desktop headers on phones.');
must(shell.includes('data-label'),'Admin table rows must receive mobile field labels.');
must(shell.includes('min-height:44px'),'Admin mobile controls must meet the touch-target baseline.');
must(shell.includes('env(safe-area-inset-bottom)'),'Admin layout must account for mobile safe areas.');
must(globalCss.includes("@import './admin-mobile-polish.css';"),'Admin mobile polish stylesheet must load after the page redesign styles.');
must(mobileCss.includes('env(safe-area-inset-top)'),'Mobile admin header and drawer must account for top safe areas.');
must(mobileCss.includes('overflow-x:hidden'),'Mobile admin must prevent accidental page-level horizontal overflow.');
must(mobileCss.includes('overflow-x:auto!important'),'Intentional horizontal controls must scroll inside their own containers.');
must(mobileCss.includes('grid-template-columns:minmax(0,1fr)!important'),'Dense mobile grids must collapse to a single safe column.');
must(mobileCss.includes('.admin-table td::before'),'Phone table cards must retain field labels.');
must(mobileCss.includes('@media(max-width:360px)'),'Admin mobile layout must include a narrow-phone fallback.');
must(engine.includes('name="viewport" content="width=device-width,initial-scale=1"'),'Concept sites must include the responsive viewport meta tag.');
must(engine.includes('@media(max-width:760px)'),'Concept design system must include a phone/tablet breakpoint.');
must(engine.includes('.intro,.cards,.story,.contact-box{grid-template-columns:1fr}'),'Concept content grids must collapse to one column.');

console.log('Mobile responsiveness invariants passed.');
