const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = [
  'app.html',
  ...fs.readdirSync(path.join(root, 'modules'))
    .filter(name => name.endsWith('.js'))
    .map(name => path.join('modules', name)),
];

const upperSpanish = 'A-Z\\u00c1\\u00c9\\u00cd\\u00d3\\u00da\\u00dc\\u00d1\\u00bf';
const badVisiblePrefixes = [
  new RegExp(`^x(?:[\\w}\`&"'~]|\\uFE0F|\\s)+[${upperSpanish}]`),
  new RegExp(`^S0\\uFE0F?\\s+[${upperSpanish}]`),
  new RegExp(`^\\u00ba\\s+[${upperSpanish}]`),
];
const badQuestionMarkWords = /[A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00dc\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1][?][A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00dc\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1]|[?][A-Za-z\u00c1\u00c9\u00cd\u00d3\u00da\u00dc\u00d1\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1]/;
const knownBrokenText = /autom\u00b2|pesta[?]a|a[?]ade|conversaci[?]n|verificaci[?]n|c[?]mo|cr[?]tico|b[?]squeda|d[?]as|configuraci[?]n|actualizaci[?]n|informaci[?]n/i;
const mojibakeMarker = /[\u00c2\u00c3\u00e2\uFFFD]/;
const directTextTag = /<(h[1-6]|button|label|option|a|span|p)[^>]*>([^<]{1,240})<\/\1>/g;
const errors = [];

for (const rel of files) {
  const fullPath = path.join(root, rel);
  const text = fs.readFileSync(fullPath, 'utf8');

  for (const match of text.matchAll(directTextTag)) {
    const clean = match[2].replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    if (badVisiblePrefixes.some(regex => regex.test(clean))) {
      errors.push(`${rel}:${line} texto visible sospechoso: ${clean}`);
    }
    if (badQuestionMarkWords.test(clean)) {
      errors.push(`${rel}:${line} posible acento perdido en texto visible: ${clean}`);
    }
  }

  for (const marker of ['\u00c3\u201a', '\u00c3\u0192', '\u00c3\u00a2\u00e2\u201a\u00ac', '\u00c3\u00a2\u00c5\u201c', '\u00c3\u00a2\u00e2\u20ac\u00a0', '\u00c3\u00b0\u00c5\u00b8', '\uFFFD']) {
    if (text.includes(marker)) errors.push(`${rel}: marcador de codificacion sospechoso ${JSON.stringify(marker)}`);
  }
  const mojibakeMatch = text.match(mojibakeMarker);
  if (mojibakeMatch) {
    const index = mojibakeMatch.index || 0;
    const line = text.slice(0, index).split(/\r?\n/).length;
    errors.push(`${rel}:${line} marcador mojibake visible: ${mojibakeMatch[0]}`);
  }

  const brokenMatch = text.match(knownBrokenText);
  if (brokenMatch) {
    const index = brokenMatch.index || 0;
    const line = text.slice(0, index).split(/\r?\n/).length;
    errors.push(`${rel}:${line} texto corrupto conocido: ${brokenMatch[0]}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log('quality-check OK');
