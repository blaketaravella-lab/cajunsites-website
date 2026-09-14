import fs from 'node:fs';

const css=fs.readFileSync('src/styles/admin-visual-alignment.css','utf8');
const global=fs.readFileSync('src/styles/global.css','utf8');
const must=(condition,message)=>{if(!condition)throw new Error(message)};

const visualImport="@import './admin-visual-alignment.css';";
const spacingImport="@import './admin-content-spacing.css';";
must(global.includes(visualImport),'Admin visual alignment must be loaded in the CSS stack.');
must(global.indexOf(visualImport)<global.indexOf(spacingImport),'Content spacing may load after visual alignment, but visual alignment must precede it.');
for(const selector of ['.focus-card','.intake-banner','.revenue-card','.security','.tax','.template-preview','.flow-step','.summary-box','.setting']){
  must(css.includes(selector),`Visual alignment must normalize ${selector}.`);
}
must(css.includes('background: #fff !important'),'Operational surfaces must normalize to quiet white surfaces.');
must(css.includes('font-weight: 600 !important'),'Legacy heavy micro-labels must be normalized.');
must(css.includes('--cs-purple-900'),'Purple brand semantics must remain present.');
must(css.includes('--cs-gold-500'),'Gold action/attention semantics must remain present.');

console.log('Admin visual alignment invariants passed.');
