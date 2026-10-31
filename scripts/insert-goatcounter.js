// Replaces the __GOATCOUNTER_CODE__ placeholder in the built page with your GoatCounter code
// (the "yourname" in yourname.goatcounter.com).
// Run after `npm run build`: npm run insert_goatcounter -- <code>
import { readFileSync, writeFileSync } from 'node:fs';

const code = process.argv[2];
if (!code) {
  console.error('usage: npm run insert_goatcounter -- <GoatCounter code>');
  process.exit(1);
}
const file = 'dist/index.html';
const html = readFileSync(file, 'utf8');
if (!html.includes('__GOATCOUNTER_CODE__')) {
  console.error(`${file} has no __GOATCOUNTER_CODE__ placeholder`);
  process.exit(1);
}
writeFileSync(file, html.replaceAll('__GOATCOUNTER_CODE__', code));
console.log(`inserted GoatCounter code into ${file}`);
