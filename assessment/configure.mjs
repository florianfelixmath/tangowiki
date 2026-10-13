import fs from 'node:fs/promises';
const url = process.argv[2];
if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url || '')) {
  throw new Error('Pass the public Apps Script deployment URL ending in /exec.');
}
await fs.writeFile(new URL('../quartz/static/assessment/config.js', import.meta.url),
  `// Public Apps Script deployment URL. No credentials belong here.\nwindow.ASSESSMENT_DEPLOYMENT_URL = ${JSON.stringify(url)};\n`);
console.log('Assessment deployment URL configured.');
