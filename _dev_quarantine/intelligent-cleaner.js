const fs = require('fs');
const path = require('path');

const win1252ToUnicode = [
  0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, 0x0008, 0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x000e, 0x000f,
  0x0010, 0x0011, 0x0012, 0x0013, 0x0014, 0x0015, 0x0016, 0x0017, 0x0018, 0x0019, 0x001a, 0x001b, 0x001c, 0x001d, 0x001e, 0x001f,
  0x0020, 0x0021, 0x0022, 0x0023, 0x0024, 0x0025, 0x0026, 0x0027, 0x0028, 0x0029, 0x002a, 0x002b, 0x002c, 0x002d, 0x002e, 0x002f,
  0x0030, 0x0031, 0x0032, 0x0033, 0x0034, 0x0035, 0x0036, 0x0037, 0x0038, 0x0039, 0x003a, 0x003b, 0x003c, 0x003d, 0x003e, 0x003f,
  0x0040, 0x0041, 0x0042, 0x0043, 0x0044, 0x0045, 0x0046, 0x0047, 0x0048, 0x0049, 0x004a, 0x004b, 0x004c, 0x004d, 0x004e, 0x004f,
  0x0050, 0x0051, 0x0052, 0x0053, 0x0054, 0x0055, 0x0056, 0x0057, 0x0058, 0x0059, 0x005a, 0x005b, 0x005c, 0x005d, 0x005e, 0x005f,
  0x0060, 0x0061, 0x0062, 0x0063, 0x0064, 0x0065, 0x0066, 0x0067, 0x0068, 0x0069, 0x006a, 0x006b, 0x006c, 0x006d, 0x006e, 0x006f,
  0x0070, 0x0071, 0x0072, 0x0073, 0x0074, 0x0075, 0x0076, 0x0077, 0x0078, 0x0079, 0x007a, 0x007b, 0x007c, 0x007d, 0x007e, 0x007f,
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
  0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7, 0x00a8, 0x00a9, 0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af,
  0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4, 0x00b5, 0x00b6, 0x00b7, 0x00b8, 0x00b9, 0x00ba, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x00bf,
  0x00c0, 0x00c1, 0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00c6, 0x00c7, 0x00c8, 0x00c9, 0x00ca, 0x00cb, 0x00cc, 0x00cd, 0x00ce, 0x00cf,
  0x00d0, 0x00d1, 0x00d2, 0x00d3, 0x00d4, 0x00d5, 0x00d6, 0x00d7, 0x00d8, 0x00d9, 0x00da, 0x00db, 0x00dc, 0x00dd, 0x00de, 0x00df,
  0x00e0, 0x00e1, 0x00e2, 0x00e3, 0x00e4, 0x00e5, 0x00e6, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x00ec, 0x00ed, 0x00ee, 0x00ef,
  0x00f0, 0x00f1, 0x00f2, 0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f7, 0x00f8, 0x00f9, 0x00fa, 0x00fb, 0x00fc, 0x00fd, 0x00fe, 0xff
];

const unicodeToWin1252 = {};
for (let i = 0; i < 256; i++) {
  unicodeToWin1252[win1252ToUnicode[i]] = i;
}

function decodeWindows1252ToUtf8(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (unicodeToWin1252[code] !== undefined) {
      bytes.push(unicodeToWin1252[code]);
    } else if (code <= 0xFF) {
      bytes.push(code);
    } else {
      const utf8Buf = Buffer.from(str[i], 'utf8');
      for (let j = 0; j < utf8Buf.length; j++) {
        bytes.push(utf8Buf[j]);
      }
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function autoDecode(str) {
  let current = str;
  for (let i = 0; i < 8; i++) {
    if (!/[^\x00-\x7F]/.test(current)) {
      return current;
    }
    
    try {
      const decoded = decodeWindows1252ToUtf8(current);
      if (decoded.includes('\uFFFD')) {
        return current;
      }
      if (decoded === current) {
        return current;
      }
      current = decoded;
    } catch (e) {
      return current;
    }
  }
  return current;
}

const rootDir = __dirname;

// 1. Fix modules/init.js using anchor-based extraction
const initPath = path.join(rootDir, 'modules', 'init.js');
if (fs.existsSync(initPath)) {
  let initContent = fs.readFileSync(initPath, 'utf8');
  const lines = initContent.split('\n');

  // Line 148 (0-indexed 147): // [mojibake] MIGRACIÓN AUTOMÁTICA DE DATOS...
  const line148 = lines[147];
  if (line148 && line148.includes('MIGRACIÓN AUTOMÁTICA')) {
    const startIdx = line148.indexOf('// ') + 3;
    const endIdx = line148.indexOf('MIGRACIÓN AUTOMÁTICA');
    const mojibakePattern = line148.slice(startIdx, endIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted init.js line 148 pattern: "${mojibakePattern}"`);
      // Since it is 3 horizontal lines, one line is mojibakePattern / 3
      // We can just replace all occurrences of this pattern in the file with "───"
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      initContent = initContent.replace(new RegExp(escaped, 'g'), '───');
    }
  }

  // Line 155 (0-indexed 154): // [mojibake] ⚡ PERFORMANCE SYSTEM...
  const line155 = lines[154];
  if (line155 && line155.includes('PERFORMANCE SYSTEM')) {
    const startIdx = line155.indexOf('// ') + 3;
    const endIdx = line155.indexOf('⚡');
    const mojibakePattern = line155.slice(startIdx, endIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted init.js line 155 pattern: "${mojibakePattern}"`);
      // It is repeated bullets. Let's find one bullet pattern:
      // The single bullet pattern is " "
      // We can just replace the whole line prefix or replace all occurrences of the pattern
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      // Replace with "• • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • • "
      const cleanBullets = '• '.repeat(mojibakePattern.split('•').length - 1);
      initContent = initContent.replace(new RegExp(escaped, 'g'), cleanBullets);
    }
  }

  // Line 157 (0-indexed 156): // [mojibake]
  const line157 = lines[156];
  if (line157 && line157.trim().startsWith('//') && line157.includes(' {
    const startIdx = line157.indexOf('// ') + 3;
    const mojibakePattern = line157.slice(startIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted init.js line 157 pattern: "${mojibakePattern}"`);
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const cleanBullets = '• '.repeat(mojibakePattern.split('•').length - 1);
      initContent = initContent.replace(new RegExp(escaped, 'g'), cleanBullets);
    }
  }

  // Line 243 (0-indexed 242): // [mojibake] GitHub sync...
  const line243 = lines[242];
  if (line243 && line243.includes('GitHub sync')) {
    const startIdx = line243.indexOf('// ') + 3;
    const endIdx = line243.indexOf('GitHub sync');
    const mojibakePattern = line243.slice(startIdx, endIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted init.js line 243 pattern: "${mojibakePattern}"`);
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      initContent = initContent.replace(new RegExp(escaped, 'g'), '── ');
    }
  }

  // Line 905 (0-indexed 904): // [mojibake]
  const line905 = lines[904];
  if (line905 && line905.trim().startsWith('//') && line905.includes(' {
    const startIdx = line905.indexOf('// ') + 3;
    const mojibakePattern = line905.slice(startIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted init.js line 905 pattern: "${mojibakePattern}"`);
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const cleanBullets = '• '.repeat(mojibakePattern.split('•').length - 1);
      initContent = initContent.replace(new RegExp(escaped, 'g'), cleanBullets);
    }
  }

  fs.writeFileSync(initPath, initContent, 'utf8');
}

// 2. Fix app.html line 68, 71, 74 using anchor-based extraction
const htmlPath = path.join(rootDir, 'app.html');
if (fs.existsSync(htmlPath)) {
  let htmlContent = fs.readFileSync(htmlPath, 'utf8');
  const lines = htmlContent.split('\n');

  // Line 68 (0-indexed 67): <!-- [mojibake] MÓVIL: overlay del sidebar...
  const line68 = lines[67];
  if (line68 && line68.includes('MÓVIL: overlay del sidebar')) {
    const startIdx = line68.indexOf('<!-- ') + 5;
    const endIdx = line68.indexOf('MÓVIL: overlay');
    const mojibakePattern = line68.slice(startIdx, endIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted app.html line 68 pattern: "${mojibakePattern}"`);
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      htmlContent = htmlContent.replace(new RegExp(escaped, 'g'), '── ');
    }
  }

  fs.writeFileSync(htmlPath, htmlContent, 'utf8');
}

// 3. Fix modules/ai-email.js box drawings using anchors
const aiEmailPath = path.join(rootDir, 'modules', 'ai-email.js');
if (fs.existsSync(aiEmailPath)) {
  let content = fs.readFileSync(aiEmailPath, 'utf8');
  const lines = content.split('\n');
  
  // Line 10 (0-indexed 9): // [mojibake]
  const line10 = lines[9];
  if (line10 && line10.includes(' {
    const startIdx = line10.indexOf('// ') + 3;
    const mojibakePattern = line10.slice(startIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted ai-email.js line 10 pattern: "${mojibakePattern}"`);
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      content = content.replace(new RegExp(escaped, 'g'), '═'.repeat(mojibakePattern.length / 4));
    }
  }
  
  // Line 16 (0-indexed 15): // [mojibake] Abrir modal
  const line16 = lines[15];
  if (line16 && line16.includes('Abrir modal')) {
    const startIdx = line16.indexOf('// ') + 3;
    const endIdx = line16.indexOf('Abrir modal');
    const mojibakePattern = line16.slice(startIdx, endIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted ai-email.js line 16 pattern: "${mojibakePattern}"`);
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      content = content.replace(new RegExp(escaped, 'g'), '── ');
    }
  }

  // Line 46 (0-indexed 45): // [mojibake] NUEVAS FUNCIONES
  const line46 = lines[45];
  if (line46 && line46.includes('NUEVAS FUNCIONES')) {
    const startIdx = line46.indexOf('// ') + 3;
    const endIdx = line46.indexOf('NUEVAS FUNCIONES');
    const mojibakePattern = line46.slice(startIdx, endIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted ai-email.js line 46 pattern: "${mojibakePattern}"`);
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      content = content.replace(new RegExp(escaped, 'g'), '── ');
    }
  }

  fs.writeFileSync(aiEmailPath, content, 'utf8');
}

// 4. Fix modules/ui.js box drawings using anchors
const uiPath = path.join(rootDir, 'modules', 'ui.js');
if (fs.existsSync(uiPath)) {
  let content = fs.readFileSync(uiPath, 'utf8');
  const lines = content.split('\n');
  
  // Line 1256 (0-indexed 1255): // [mojibake]
  const line1256 = lines[1255];
  if (line1256 && line1256.includes(' {
    const startIdx = line1256.indexOf('// ') + 3;
    const mojibakePattern = line1256.slice(startIdx).trim();
    if (mojibakePattern) {
      console.log(`Extracted ui.js line 1256 pattern: "${mojibakePattern}"`);
      const escaped = mojibakePattern.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      content = content.replace(new RegExp(escaped, 'g'), '═'.repeat(mojibakePattern.length / 4));
    }
  }

  fs.writeFileSync(uiPath, content, 'utf8');
}

// 5. Run auto-decoder on all non-ASCII blocks in all files recursively
function walk(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      if (file !== 'node_modules' && file !== '.git' && file !== 'assets') {
        results = results.concat(walk(fullPath));
      }
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

const files = walk(rootDir);
const nonAsciiRegex = /[^\x00-\x7F]+/g;

files.forEach(file => {
  if (file.endsWith('.jpg') || file.endsWith('.png') || file.endsWith('.gif') || file.endsWith('.ico') || 
      file.endsWith('.woff') || file.endsWith('.woff2') || file.endsWith('.ttf') || 
      file === __filename || file.includes('clean-encoding.js') || file.includes('decode-file.js') ||
      file.includes('find-mojibake.js') || file.includes('print-mappings.js') || file.includes('test-decode') ||
      file.includes('check-correct-accents.js') || file.includes('check-decoded-lines.js') || file.includes('test-auto-clean.js') ||
      file.includes('print-line-68.js') || file.includes('print-file-mojibake-bytes.js') || file.includes('print-char-codes.js') ||
      file.includes('test-manual-passes.js') || file.includes('test-auto-decode.js') || file.includes('test-decode-init.js') ||
      file.includes('generate-mixed.js') || file.includes('decode-init-prefix.js') || file.includes('final-cleaner.js')) {
    return;
  }

  try {
    let content = fs.readFileSync(file, 'utf8');
    let originalContent = content;

    content = content.replace(nonAsciiRegex, (match) => {
      // Decode the non-ASCII match block
      return autoDecode(match);
    });

    if (content !== originalContent) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`Auto-decoded file: ${path.relative(rootDir, file)}`);
    }
  } catch (err) {
    console.error(`Error auto-decoding ${file}: ${err.message}`);
  }
});

console.log('Intelligent cleanup completed.');
