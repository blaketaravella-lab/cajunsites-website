import fs from 'node:fs';
const source=fs.readFileSync('worker/concept-factory.js','utf8');
if(source.includes("deployed HTML does not reference both local AI image assets")) throw new Error('Deployment verification must not require rendered HTML to reference every packaged image asset.');
if(!source.includes("Concept packaging failed: generated HTML does not reference both local AI image assets.")) throw new Error('Packaging must still verify both local AI image references before deployment.');
if(!source.includes("asset is not served as an image")) throw new Error('Deployment verification must validate that image assets are actually served as images.');
console.log('Concept verification invariants passed.');
