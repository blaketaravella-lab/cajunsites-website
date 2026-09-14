import fs from 'node:fs';
const source=fs.readFileSync('worker/concept-factory.js','utf8');
if(source.includes("deployed HTML does not reference both local AI image assets")) throw new Error('Deployment verification must not require rendered HTML to reference every packaged image asset.');
if(!source.includes("Concept packaging failed: generated HTML does not reference both local AI image assets.")) throw new Error('Packaging must still verify both local AI image references before deployment.');
if(source.includes("asset is not served as an image")) throw new Error('Deployment verification must not trust response MIME headers as the image integrity check.');
if(!source.includes('function isWebp(bytes)')) throw new Error('Deployment verification must inspect WebP file signatures.');
if(!source.includes('new Uint8Array(await response.arrayBuffer())')) throw new Error('Deployment verification must inspect deployed asset bytes.');
if(!source.includes('asset did not return valid WebP image bytes')) throw new Error('Deployment verification must reject non-WebP payloads with a diagnostic error.');
console.log('Concept verification invariants passed.');
