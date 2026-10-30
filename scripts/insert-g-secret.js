// Replaces the __G_ANA_SECRET__ placeholder in the built page with the Google Analytics ID.
// Run after `npm run build`: npm run insert_g_secret -- G-XXXXXXXXXX
import { readFileSync, writeFileSync } from 'node:fs';

const id = process.argv[2];
if (!id) {
  console.error('usage: npm run insert_g_secret -- <GA ID>');
  process.exit(1);
}
const file = 'dist/index.html';
const html = readFileSync(file, 'utf8');
if (!html.includes('__G_ANA_SECRET__')) {
  console.error(`${file} has no __G_ANA_SECRET__ placeholder`);
  process.exit(1);
}
writeFileSync(file, html.replaceAll('__G_ANA_SECRET__', id));
console.log(`inserted GA ID into ${file}`);
