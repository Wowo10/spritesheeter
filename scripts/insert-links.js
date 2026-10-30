// Replaces the __KOFI_ACCOUNT__ and __GITHUB_ACCOUNT__ placeholders in the built page with your
// accounts, which shows the ko-fi and github buttons under the playground one.
// Run after `npm run build`: npm run insert_links -- <ko-fi name> <github user or user/repo>
// Pass - for either to leave that button hidden.
import { readFileSync, writeFileSync } from 'node:fs';

const [kofi, github] = process.argv.slice(2);
if (!kofi || !github) {
  console.error('usage: npm run insert_links -- <ko-fi name> <github user or user/repo>');
  process.exit(1);
}
const file = 'dist/index.html';
let html = readFileSync(file, 'utf8');
for (const [placeholder, value] of [['__KOFI_ACCOUNT__', kofi], ['__GITHUB_ACCOUNT__', github]]) {
  if (value === '-') continue;
  if (!html.includes(placeholder)) {
    console.error(`${file} has no ${placeholder} placeholder`);
    process.exit(1);
  }
  html = html.replaceAll(placeholder, value);
}
writeFileSync(file, html);
console.log(`inserted links into ${file}`);
