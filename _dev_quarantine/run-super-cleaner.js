// run-super-cleaner.js
const fs = require('fs');
const path = require('path');

// Load replacement map logic from existing super-cleaner (duplicate for self-contained script)
const win1252ToUnicode = [
  0x0000,0x0001,0x0002,0x0003,0x0004,0x0005,0x0006,0x0007,0x0008,0x0009,0x000a,0x000b,0x000c,0x000d,0x000e,0x000f,
  0x0010,0x0011,0x0012,0x0013,0x0014,0x0015,0x0016,0x0017,0x0018,0x0019,0x001a,0x001b,0x001c,0x001d,0x001e,0x001f,
  0x0020,0x0021,0x0022,0x0023,0x0024,0x0025,0x0026,0x0027,0x0028,0x0029,0x002a,0x002b,0x002c,0x002d,0x002e,0x002f,
  0x0030,0x0031,0x0032,0x0033,0x0034,0x0035,0x0036,0x0037,0x0038,0x0039,0x003a,0x003b,0x003c,0x003d,0x003e,0x003f,
  0x0040,0x0041,0x0042,0x0043,0x0044,0x0045,0x0046,0x0047,0x0048,0x0049,0x004a,0x004b,0x004c,0x004d,0x004e,0x004f,
  0x0050,0x0051,0x0052,0x0053,0x0054,0x0055,0x0056,0x0057,0x0058,0x0059,0x005a,0x005b,0x005c,0x005d,0x005e,0x005f,
  0x0060,0x0061,0x0062,0x0063,0x0064,0x0065,0x0066,0x0067,0x0068,0x0069,0x006a,0x006b,0x006c,0x006d,0x006e,0x006f,
  0x0070,0x0071,0x0072,0x0073,0x0074,0x0075,0x0076,0x0077,0x0078,0x0079,0x007a,0x007b,0x007c,0x007d,0x007e,0x007f,
  0x20ac,0x0081,0x201a,0x0192,0x201e,0x2026,0x2020,0x2021,0x02c6,0x2030,0x0160,0x2039,0x0152,0x008d,0x017d,0x008f,
  0x0090,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x02dc,0x2122,0x0161,0x203a,0x0153,0x009d,0x017e,0x0178,
  0x00a0,0x00a1,0x00a2,0x00a3,0x00a4,0x00a5,0x00a6,0x00a7,0x00a8,0x00a9,0x00aa,0x00ab,0x00ac,0x00ad,0x00ae,0x00af,
  0x00b0,0x00b1,0x00b2,0x00b3,0x00b4,0x00b5,0x00b6,0x00b7,0x00b8,0x00b9,0x00ba,0x00bb,0x00bc,0x00bd,0x00be,0x00bf,
  0x00c0,0x00c1,0x00c2,0x00c3,0x00c4,0x00c5,0x00c6,0x00c7,0x00c8,0x00c9,0x00ca,0x00cb,0x00cc,0x00cd,0x00ce,0x00cf,
  0x00d0,0x00d1,0x00d2,0x00d3,0x00d4,0x00d5,0x00d6,0x00d7,0x00d8,0x00d9,0x00da,0x00db,0x00dc,0x00dd,0x00de,0x00df,
  0x00e0,0x00e1,0x00e2,0x00e3,0x00e4,0x00e5,0x00e6,0x00e7,0x00e8,0x00e9,0x00ea,0x00eb,0x00ec,0x00ed,0x00ee,0x00ef,
  0x00f0,0x00f1,0x00f2,0x00f3,0x00f4,0x00f5,0x00f6,0x00f7,0x00f8,0x00f9,0x00fa,0x00fb,0x00fc,0x00fd,0x00fe,0x00ff
];

function encodeToMojibake(str) {
  const bytes = Buffer.from(str, 'utf8');
  let moj = '';
  for (const b of bytes) {
    moj += String.fromCharCode(win1252ToUnicode[b]);
  }
  return moj;
}

const unicodeToWin1252 = {};
for (let i = 0; i < 256; i++) {
  unicodeToWin1252[win1252ToUnicode[i]] = i;
}

function decodeWindows1252ToUtf8(str) {
  const bytes = [];
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (unicodeToWin1252[code] !== undefined) {
      bytes.push(unicodeToWin1252[code]);
    } else if (code <= 0xFF) {
      bytes.push(code);
    } else {
      const buf = Buffer.from(ch, 'utf8');
      for (const b of buf) bytes.push(b);
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function autoDecode(str) {
  let cur = str;
  for (let i = 0; i < 8; i++) {
    if (!/[^\x00-\x7F]/.test(cur)) return cur;
    const decoded = decodeWindows1252ToUtf8(cur);
    if (decoded.includes('\uFFFD') || decoded === cur) return cur;
    cur = decoded;
  }
  return cur;
}

// Build replacement map (same as super-cleaner)
const charsToClean = [
  'á','é','í','ó','ú','ñ','ü','Á','É','Í','Ó','Ú','Ñ','Ü','¿','¡','º','ª','€','—','–','→','←','↔','✔','✓','✖','✕','…','•','●','“','”','‘','’','²','³','·','½','¼','¾','«','»','─','═','║','╔','╗','╚','╝','╠','╣','╦','╩','╬','█','▲','▼','◀','▶','☰','☁','☁️','★','❓','📅','🎯','🏆','🔥','📊','⭐','✅','❌','🔍','🔔','⚙️','⚙','📂','📈','📉','📋','💡','🚀','💬','✉️','✉','⏳','🌙','✨','💻','📱','🔒','🔑','👤','👥','➕','✏️','✏','🗑️','🗑','💾','📥','📤','🔄','⚠️','🛑','ℹ️','💲','💵','💰','🏷️','📍','🗺️','📞','📧','🌐','🔗','🤖','🤝','⚡','🟡','🟢','🔵','⚪','⚫','🔴','🧡','💛','💚','💙','💜','🖤','🤍','🚪','🚫','💀','👍','👎','🎉','👑','💸','💼','🏢','🏥','🧠','\ufe0f'
];

const replacementMap = [];
charsToClean.forEach(clean => {
  let cur = clean;
  for (let pass = 1; pass <= 5; pass++) {
    cur = encodeToMojibake(cur);
    if (cur !== clean) replacementMap.push({ mojibake: cur, clean });
  }
});

const customReplacements = [
  { mojibake: ' clean: '─' },
  { mojibake: ' clean: '─' },
  { mojibake: ' clean: '─' },
  { mojibake: ' clean: '─' },
  { mojibake: 'â”€', clean: '─' },
  { mojibake: ' ', clean: '─' },
  { mojibake: ' ', clean: '─' },
  { mojibake: ' ', clean: '─' },
  { mojibake: ' ', clean: '─' },
  { mojibake: 'â” ', clean: '─' },
  { mojibake: ' clean: '─' },
  { mojibake: ' clean: '─' },
  // ═ patterns
  { mojibake: ' clean: '═' },
  { mojibake: ' clean: '═' },
  { mojibake: ' clean: '═' },
  { mojibake: ' clean: '═' },
  { mojibake: ' clean: '═' },
  { mojibake: ' clean: '═' },
  { mojibake: ' clean: '═' },
  { mojibake: ' clean: '═' },
  { mojibake: 'â•Â\\u0090', clean: '═' },
  { mojibake: 'â•Â', clean: '═' },
  // other symbols
  { mojibake: ' clean: '✖' },
  { mojibake: ' clean: '✖' },
  { mojibake: ' clean: '✖' },
  { mojibake: ' clean: '✖' },
  { mojibake: ' clean: '❓' },
  { mojibake: ' “', clean: '❓' },
  { mojibake: ' ', clean: '█' },
  { mojibake: ' ', clean: '█' },
  { mojibake: ' ', clean: '█' },
  { mojibake: ' ', clean: '█' }
];
customReplacements.forEach(r => replacementMap.push(r));

// Unique replacements (longest first)
const unique = [];
const seen = new Set();
replacementMap.sort((a,b)=>b.mojibake.length-a.mojibake.length)
  .forEach(r=>{if(!seen.has(r.mojibake)){seen.add(r.mojibake);unique.push(r);}});

// Walk the actual project folder
const projectRoot = 'c:\\Users\\NOSTROMO\\Downloads\\Progama Gordi';
function walk(dir){
  let results=[];
  const list=fs.readdirSync(dir);
  list.forEach(f=>{
    const fp=path.join(dir,f);
    const stat=fs.statSync(fp);
    if(stat.isDirectory()){
      if(['node_modules','.git','assets'].includes(f)) return;
      results=results.concat(walk(fp));
    } else {
      results.push(fp);
    }
  });
  return results;
}
const files=walk(projectRoot);
const nonAscii = /[^\x00-\x7F]+/g;
files.forEach(file=>{
  if(file.endsWith('.jpg')||file.endsWith('.png')||file.endsWith('.gif')||file.endsWith('.ico')||file.endsWith('.woff')||file.endsWith('.woff2')||file.endsWith('.ttf')) return;
  try{
    let content=fs.readFileSync(file,'utf8');
    const original=content;
    let changed=0;
    // replacements
    unique.forEach(r=>{
      const esc=r.mojibake.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$&');
      const re=new RegExp(esc,'g');
      const count=(content.match(re)||[]).length;
      if(count){content=content.replace(re,r.clean);changed+=count;}
    });
    // auto decode remaining
    content=content.replace(nonAscii, m=>{
      const d=autoDecode(m);
      if(d!==m){changed++;return d;} return m;
    });
    if(content!==original){
      fs.writeFileSync(file,content,'utf8');
      console.log(`Cleaned ${path.relative(projectRoot,file)} - ${changed} changes`);
    }
  }catch(e){console.error('Error',file,e.message);}
});
console.log('Run complete');
