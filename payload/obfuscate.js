/**
 * Custom Node.js source obfuscator for the payload templates.
 *
 * No third-party obfuscator: this is a self-contained tokenizer + transformer
 * tuned for compatibility with @yao-pkg/pkg static require() resolution and
 * the post-build require() integrity gate.
 *
 * Transformations (deterministic per input, randomized per run for the
 * encoder key and decoder identifiers so every build differs):
 *   - string literals      -> index-based decoder calls, XOR'd with a per-run
 *                             key (keyLen bytes), chunked and offset-rotated;
 *                             stored as hex int tables, no plaintext leaks
 *   - comments             -> stripped
 *   - integer literals     -> hexadecimal notation
 *   - object keys          -> computed decrypted keys `[dec(i)]:`
 *   - member access        -> computed decrypted access `x[dec(i)]`
 *   - shorthand properties -> computed form `[dec(i)]: renamed` (key and
 *                             binding renamed independently)
 *   - declared identifiers -> uniform per-spelling rename (const/let/var,
 *                             function/class names, params, catch bindings)
 *   - template expressions -> recursively transformed (raw segments intact)
 *   - junk functions       -> appended (full level), live-valid with their own
 *                             decode entries
 *
 * Safety rules that are load-bearing:
 *   - require('literal') argument strings are NEVER encoded. pkg must see the
 *     real path, and the post-build extractRequires() gate must still match.
 *   - Keywords, `require` and a whitelist of Node/ECMA globals are never
 *     renamed; renaming only touches spellings seen in declaration positions
 *     and is applied uniformly so scope/shadowing semantics are preserved.
 *   - Object keys and member accesses ARE encoded to computed forms, but the
 *     decoded property names are byte-identical at runtime, so wire/JSON
 *     semantics are unchanged.
 *   - Regular expressions are passed through verbatim.
 *
 * CLI:
 *   node obfuscate.js <input.js> <output.js> [--level light|full] [--dump]
 *   node obfuscate.js <input.js> --check [--level light|full]
 *
 * API:
 *   obfuscateSource(source, level) -> transformed source
 *   extractRequires(source)        -> Set of require paths (hex-escapes decoded)
 *   LEVELS                         -> { light, full } presets
 */

const fs = require("fs");
const path = require("path");

const LEVELS = {
  light: { keyLen: 16, chunk: 32, minString: 8, minNumber: 128, junk: 1 },
  full: { keyLen: 32, chunk: 16, minString: 1, minNumber: 0, junk: 4 },
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDecoderNames(seed, used) {
  const rnd = mulberry32(seed);
  const pool = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let generated = new Set();
  for (let i = 0; i < 120; i++) {
    let len = 4 + Math.floor(rnd() * 5);
    let name = "_0x";
    for (let j = 0; j < len; j++)
      name += pool[Math.floor(rnd() * pool.length)];
    if (!used.has(name) && !generated.has(name)) generated.add(name);
  }
  const take = (drop) => {
    let name;
    for (const n of generated) {
      name = n;
      break;
    }
    generated.delete(name);
    if (name === undefined) name = "_0x" + "a".repeat(drop);
    return name;
  };
  const names = [];
  for (let i = 0; i < 5; i++) names.push(take(i + 4));
  return {
    cacheName: names[0],
    keyName: names[1],
    decName: names[2],
    getName: names[3],
    tableName: names[4],
  };
}

/**
 * Encode one plaintext chunk into an array of int bytes XOR'd with key + offset.
 * Stored hex so the table leaks no printable data and the key material is opaque.
 */
function encodeChunk(plain, key, offset) {
  const out = [];
  for (let i = 0; i < plain.length; i++) {
    out.push(plain.charCodeAt(i) ^ key[(i + offset) % key.length]);
  }
  return out;
}

/**
 * Build a rename map for safe whole-file identifier renaming.
 *
 * Only spellings that appear in a *declaration* position (const/let/var,
 * function/class names, params, catch bindings) qualify. Keywords, `require`
 * and a whitelist of Node/ECMA globals are never renamed. Property names and
 * object keys are converted to computed access *before* the rename is applied,
 * and transform() rewrites shorthand properties `{ a }` into computed-key form
 * `[dec]: renamed`, so the identifier stream that survives holds only bindings,
 * references, keywords and globals — a uniform rename of a declared spelling
 * therefore preserves scope/shadowing semantics throughout a self-contained
 * CommonJS file.
 *
 * Renaming depends on that shorthand rewrite, which needs encryptable keys
 * (minString <= 1); caller gate: when the level can't encrypt short keys this
 * returns an empty map.
 */
function buildRenameMap(src, rnd, reserved) {
  const KEYWORDS = new Set([
    "abstract","arguments","async","await","boolean","break","byte","case","catch",
    "char","class","const","continue","debugger","default","delete","do",
    "double","else","enum","eval","export","extends","false","final","finally",
    "float","for","function","get","goto","if","implements","import","in",
    "instanceof","int","interface","let","long","native","new","null","of",
    "package","private","protected","public","push" /* not a keyword, guard */,
    "return","set","short","static","super","switch","synchronized","this",
    "throw","throws","transient","true","try","typeof","var","void","volatile",
    "while","with","yield",
  ]);
  const GLOBALS = new Set([
    "require","module","exports","process","console","global","globalThis",
    "Buffer","URL","URLSearchParams","TextEncoder","TextDecoder","atob","btoa",
    "fetch","XMLHttpRequest","WebSocket","crypto","performance","queueMicrotask",
    "setImmediate","setInterval","setTimeout","clearImmediate","clearInterval",
    "clearTimeout","__dirname","__filename","request","reject","resolve","promise",
    "Math","JSON","Object","Array","String","Number","Boolean","Date","RegExp",
    "Error","TypeError","RangeError","SyntaxError","ReferenceError","EvalError",
    "URIError","AggregateError","Promise","Map","Set","WeakMap","WeakSet",
    "Symbol","BigInt","Proxy","Reflect","Intl","Atomics","DataView","ArrayBuffer",
    "SharedArrayBuffer","Uint8Array","Uint16Array","Uint32Array","Int8Array",
    "Int16Array","Int32Array","Float32Array","Float64Array","Uint8ClampedArray",
    "BigInt64Array","BigUint64Array","globalThis","undefined","NaN","Infinity",
    "parseInt","parseFloat","isNaN","isFinite","decodeURI","decodeURIComponent",
    "encodeURI","encodeURIComponent","escape","unescape","Function","eval",
    "arguments","pageXOffset","screen","navigator","window","document","self",
    "location","history","localStorage","sessionStorage","CustomEvent","Event",
    "MessageChannel","MessageEvent","Worker","SharedWorker","ServiceWorker",
    "FileReader","Blob","File","FormData","Headers","Request","Response","AbortController",
    "AbortSignal","ReadableStream","WritableStream","TransformStream","structuredClone",
  ]);

  const isIdentStart = (c) => /[a-zA-Z_$]/.test(c);
  const isIdentPart = (c) => /[a-zA-Z0-9_$]/.test(c);
  const dunder = (w) => w.startsWith("__") && w.endsWith("__") && w.length > 4;

  const tokens = [];
  let lastSig = ";"; // tracks the last significant token for regex-vs-division
  let i = 0;
  const n = src.length;

  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (" \t\r\n\v\f".includes(c)) { i++; continue; }
    if (c === "/" && next === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && next === "*") { const e = src.indexOf("*/", i + 2); i = e === -1 ? n : e + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        j++;
      }
      i = j;
      lastSig = "str";
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "`") { j++; break; }
        j++;
      }
      i = j;
      lastSig = "str";
      continue;
    }
    if (c === "/") {
      const isDiv =
        lastSig === "id" || lastSig === "num" || lastSig === "str" ||
        lastSig === ")" || lastSig === "]" || lastSig === "}";
      if (isDiv) { tokens.push({ t: "punc", v: "/" }); i++; lastSig = "op"; continue; }
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const rc = src[j];
        if (rc === "\\") { j += 2; continue; }
        if (rc === "[") inClass = true;
        else if (rc === "]") inClass = false;
        else if (rc === "/" && !inClass) { j++; while (j < n && /[a-z]/i.test(src[j])) j++; break; }
        j++;
      }
      i = j;
      lastSig = "str";
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      if (c === "0" && /[xXbBoO]/.test(next || "")) {
        j += 2;
        while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++;
      } else {
        while (j < n && /[0-9_]/.test(src[j])) j++;
        if (src[j] === "." && /[0-9]/.test(src[j + 1] || "")) {
          j++;
          while (j < n && /[0-9_]/.test(src[j])) j++;
        }
        if (src[j] === "e" || src[j] === "E") {
          let k = j + 1;
          if (src[k] === "+" || src[k] === "-") k++;
          if (/[0-9]/.test(src[k] || "")) {
            j = k;
            while (j < n && /[0-9_]/.test(src[j])) j++;
          }
        }
      }
      tokens.push({ t: "num", v: src.slice(i, j) });
      i = j;
      lastSig = "num";
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(src[j])) j++;
      tokens.push({ t: "id", v: src.slice(i, j) });
      i = j;
      lastSig = "id";
      continue;
    }
    if (c === "=" && next === ">") { tokens.push({ t: "punc", v: "=>" }); i += 2; lastSig = "=>"; continue; }
    tokens.push({ t: "punc", v: c });
    if (/[)\]}]/.test(c)) lastSig = c;
    else if ("({[".includes(c)) lastSig = c;
    else if (c === ",") lastSig = ",";
    else lastSig = "op";
    i++;
  }

  const declared = new Set();
  const matchingClose = (open) => {
    let depth = 1;
    let q = open + 1;
    while (q < tokens.length && depth > 0) {
      const v = tokens[q].v;
      if (v === "{" || v === "[" || v === "(") depth++;
      else if (v === "}" || v === "]" || v === ")") depth--;
      q++;
    }
    return q - 1;
  };

  // mark every binding inside a destructuring pattern `{...}` / `[...]`
  const markPattern = (open) => {
    const close = matchingClose(open);
    const isObj = tokens[open].v === "{";
    let p = open + 1;
    while (p < close) {
      const e = tokens[p];
      if (e.t === "id") {
        if (isObj && tokens[p + 1] && tokens[p + 1].t === "punc" && tokens[p + 1].v === ":") {
          // `{ key: value }` — the element after ':' is the binding
          const vi = p + 2;
          const vt = tokens[vi];
          if (vt && vt.t === "id") { declared.add(vt.v); p = vi + 1; continue; }
          if (vt && vt.t === "punc" && (vt.v === "{" || vt.v === "[")) { markPattern(vi); p = matchingClose(vi) + 1; continue; }
          p = vi;
          continue;
        }
        declared.add(e.v); // shorthand or array element is a binding
        p++;
        continue;
      }
      if (e.t === "punc") {
        if (e.v === "{" || e.v === "[") { markPattern(p); p = matchingClose(p) + 1; continue; }
        if (e.v === "...") {
          const rt = tokens[p + 1];
          if (rt && rt.t === "id") declared.add(rt.v);
          p += 2;
          continue;
        }
        p++;
        continue;
      }
      p++;
    }
  };

  const markParams = (from, closeParenIdx) => {
    let p = from;
    while (p < closeParenIdx) {
      const e = tokens[p];
      if (e.t === "id") { declared.add(e.v); p++; continue; }
      if (e.t === "punc") {
        if (e.v === "{" || e.v === "[") { markPattern(p); p = matchingClose(p) + 1; continue; }
        if (e.v === "...") {
          const rt = tokens[p + 1];
          if (rt && rt.t === "id") declared.add(rt.v);
          p += 2;
          continue;
        }
        p++;
        continue;
      }
      p++;
    }
  };

  // declaration positions
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t !== "id") continue;
    const v = t.v;
    const nx1 = tokens[k + 1];
    const nx2 = tokens[k + 2];
    if (v === "const" || v === "let" || v === "var") {
      if (nx1 && nx1.t === "id") declared.add(nx1.v);
      else if (nx1 && nx1.t === "punc" && (nx1.v === "{" || nx1.v === "[")) markPattern(k + 1);
    } else if (v === "function" || v === "class") {
      if (nx1 && nx1.t === "id") declared.add(nx1.v);
      else if (nx1 && nx1.t === "punc" && nx1.v === "*" && nx2 && nx2.t === "id") declared.add(nx2.v);
    } else if (v === "async") {
      if (nx1 && nx1.t === "id" && (nx1.v === "function" || nx1.v === "class") && nx2 && nx2.t === "id")
        declared.add(nx2.v);
    } else if (v === "catch") {
      if (nx1 && nx1.t === "punc" && nx1.v === "(" && nx2 && nx2.t === "id") declared.add(nx2.v);
    }
  }

  // parameter lists: `(a, b) =>`, `function (a)`, `async function (a)`,
  // object/class method shorthand `name(a) {`
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (!(t.t === "punc" && t.v === "(")) continue;
    const close = matchingClose(k);
    if (close <= k) continue;
    const before = tokens[k - 1];
    const after = tokens[close + 1];
    const isArrow = after && after.t === "punc" && after.v === "=>";
    const isFn =
      (before && before.t === "id" && before.v === "function") ||
      (before && before.t === "id" && before.v === "async" &&
        tokens[k - 2] && tokens[k - 2].t === "id" && tokens[k - 2].v === "function");
    const isMethod = before && before.t === "id" && !KEYWORDS.has(before.v) &&
      after && after.t === "punc" && after.v === "{";
    if (isArrow || isFn || isMethod) markParams(k + 1, close);
  }

  // ---- assemble rename map ----
  // `reserved` = source identifiers + decoder names (+ things we generate);
  // it guards the *generated* names but must never block renaming the declared
  // identifiers themselves (they are all members of the source identifier set).
  const map = new Map();
  const usedAll = new Set(reserved);
  for (const id of declared) {
    if (KEYWORDS.has(id) || GLOBALS.has(id)) continue;
    if (dunder(id)) continue;
    if (map.has(id)) continue;
    let name;
    do {
      name = "_0x" + rnd().toString(16).slice(2, 10).replace(/^[0-9]/, "a");
    } while (usedAll.has(name));
    usedAll.add(name);
    map.set(id, name);
  }
  return map;
}

class Obfuscator {
  constructor(source, level) {
    this.src = source;
    this.level = level;
    this.seed = (Date.now() ^ (process.pid << 16)) >>> 0;
    this.rnd = mulberry32(this.seed);
    this.key = [];
    for (let i = 0; i < level.keyLen; i++)
      this.key.push(Math.floor(this.rnd() * 256));
    const used = new Set(source.match(/[a-zA-Z_$][a-zA-Z0-9_$]*/g) || []);
    this.names = makeDecoderNames(this.seed ^ 0x5bd1e995, used);
    // Renaming depends on encryptable shorthand keys; at light (minString 8) it
    // is disabled entirely. Reserved = every source identifier + decoder names.
    const reserved = new Set([...used, ...Object.values(this.names)]);
    this.rename =
      this.level.minString <= 1 ? buildRenameMap(source, this.rnd, reserved) : new Map();
    this.junkUsed = new Set(this.rename.values());
    this.entries = []; // {v: [int...], o: offset}
    this.table = new Map(); // plaintext -> entry index
  }

  hex(v) {
    return "0x" + v.toString(16);
  }

  keyArr() {
    return this.key.map((k) => "0x" + k.toString(16)).join(",");
  }

  encodeString(str) {
    if (str.length < this.level.minString) return null;
    const key = this.key;
    const chunk = this.level.chunk;
    const chunks = [];
    for (let i = 0; i < str.length; i += chunk)
      chunks.push(str.slice(i, i + chunk));
    const calls = [];
    for (const c of chunks) {
      let idx = this.table.get(c);
      if (idx === undefined) {
        idx = this.entries.length;
        const off = Math.floor(this.rnd() * key.length);
        this.entries.push({
          v: encodeChunk(c, key, off),
          o: off,
        });
        this.table.set(c, idx);
      }
      calls.push(`${this.names.getName}(${idx})`);
    }
    return calls.length === 1 ? calls[0] : calls.join("+");
  }

  encodeNumber(numStr) {
    if (/[.eE_]/.test(numStr)) return null;
    if (/^0x/i.test(numStr) || /^0b/i.test(numStr) || /^0o/i.test(numStr))
      return null;
    const v = parseInt(numStr, 10);
    if (!Number.isFinite(v)) return null;
    if (v >= 0 && v < this.level.minNumber) return null;
    return "0x" + v.toString(16);
  }

  prelude() {
    const n = this.names;
    // The decoder must NOT route `fromCharCode`/`length` through the table:
    // decoding the entry would re-enter the getter that is itself decoding it
    // (self-referential recursion). These two primitives stay plaintext.
    const eArr =
      "[" + this.entries.map((e) => `{v:[${e.v.map((b) => this.hex(b)).join(",")}],o:${e.o}}`).join(",") + "]";
    return [
      `var ${n.cacheName}c=[],${n.keyName}=[${this.keyArr()}],${n.tableName}=${eArr};`,
      `function ${n.decName}(${n.cacheName}s,${n.cacheName}o,${n.cacheName}k){var ${n.cacheName}r="";for(var ${n.cacheName}m=0;${n.cacheName}m<${n.cacheName}s.v.length;${n.cacheName}m++){${n.cacheName}r+=String.fromCharCode(${n.cacheName}s.v[${n.cacheName}m]^${n.cacheName}k[(${n.cacheName}m+${n.cacheName}o)%${n.cacheName}k.length])}return ${n.cacheName}r}`,
      `function ${n.getName}(${n.cacheName}i){if(!${n.cacheName}c[${n.cacheName}i]){var ${n.cacheName}e=${n.tableName}[${n.cacheName}i];${n.cacheName}c[${n.cacheName}i]=${n.decName}(${n.cacheName}e,${n.cacheName}e.o,${n.keyName})}return ${n.cacheName}c[${n.cacheName}i]}`,
    ].join("\n");
  }

  junk(code) {
    const rnd = this.rnd;
    let extra = "";
    const foreach = this.encodeString("forEach") || "forEach";
    for (let j = 0; j < this.level.junk; j++) {
      const fname = this.uniqueFuncName();
      const a = this.uniqueFuncName();
      const b = this.uniqueFuncName();
      const c = this.uniqueFuncName();
      const d = this.uniqueFuncName();
      const s = this.uniqueFuncName();
      const arr = [];
      for (let i = 0; i < 5; i++) arr.push(Math.floor(rnd() * 255));
      const arrLit = "[" + arr.map((v) => this.hex(v)).join(",") + "]";
      const synth = this.encodeString("junk_" + rnd().toString(36).slice(2));
      extra +=
        `function ${fname}(${a}){var ${b}=${arrLit};var ${c}=0;` +
        `${b}[${foreach}](function(${d}){${c}^=${d}});` +
        `${synth ? "var " + s + "=" + synth + ";" : ""}` +
        `return ${c}}${fname}(${arrLit});\n`;
    }
    return code + "\n" + extra;
  }

  uniqueFuncName() {
    let name;
    do {
      name =
        "_0x" +
        this.rnd().toString(16).slice(2, 10).replace(/^[0-9]/, "a");
    } while (
      this.junkUsed.has(name) ||
      (this.names && Object.values(this.names).indexOf(name) >= 0)
    );
    this.junkUsed.add(name);
    return name;
  }

  /**
   * Core scanner. Walks the source char by char, transforming strings and
   * numbers, passing everything else through. `require('literal')` argument
   * strings are left untouched.
   */
  transform() {
    const src = this.src;
    const n = src.length;
    const out = [];
    let i = 0;
    let line = 1;
    let prev = null; // 'id' | 'num' | 'str' | ') ' | ']' | '}' | 'op' | 'call'
    let requireFollows = false;
    let requireArg = false;
    // context stack for object-literal key detection:
    // push true on object `{`, false on block `{`, "arr" on `[`, "paren" on `(`
    const ctxStack = [];
    let keyPos = false; // true when an identifier could be an object key
    let lastSig = null; // last significant token sig for `{` classification
    const BLOCK_SIGS = new Set([
      ")", "]", "}", "=>",
      "else", "do", "try", "finally", "catch", "switch",
      "while", "for", "if", "with", "function", "class",
      "of", "in", "yield", "await",
    ]);

    const nl = (ch) => {
      if (ch === "\n") line++;
    };

    const readString = (q) => {
      let outS = "";
      let j = i + 1;
      while (j < n) {
        const c = src[j];
        if (c === "\\") {
          const e = src[j + 1];
          if (e === undefined) { j++; continue; }
          if (e === "n") { outS += "\n"; j += 2; continue; }
          if (e === "t") { outS += "\t"; j += 2; continue; }
          if (e === "r") { outS += "\r"; j += 2; continue; }
          if (e === "b") { outS += "\b"; j += 2; continue; }
          if (e === "f") { outS += "\f"; j += 2; continue; }
          if (e === "v") { outS += "\v"; j += 2; continue; }
          if (e === "0") { outS += "\0"; j += 2; continue; }
          if (e === "x") {
            const hx = src.slice(j + 2, j + 4);
            if (/^[0-9a-fA-F]{2}$/.test(hx)) {
              outS += String.fromCharCode(parseInt(hx, 16));
              j += 4;
            } else {
              outS += "x";
              j += 2;
            }
            continue;
          }
          if (e === "u") {
            if (src[j + 2] === "{") {
              const close = src.indexOf("}", j + 3);
              if (close !== -1) {
                const cp = parseInt(src.slice(j + 3, close), 16);
                if (!Number.isNaN(cp)) outS += String.fromCodePoint(cp);
                j = close + 1;
                continue;
              }
            }
            const hx = src.slice(j + 2, j + 6);
            if (/^[0-9a-fA-F]{4}$/.test(hx)) {
              outS += String.fromCharCode(parseInt(hx, 16));
              j += 6;
            } else {
              outS += "u";
              j += 2;
            }
            continue;
          }
          outS += e;
          j += 2;
          continue;
        }
        if (c === q) {
          j++;
          break;
        }
        outS += c;
        j++;
      }
      return { text: src.slice(i, j), body: outS, end: j };
    };

    const readTemplateRaw = () => {
      let j = i + 1;
      while (j < n) {
        const c = src[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (
          c === "$" &&
          src[j + 1] === "{" &&
          src[j + 1] !== undefined
        ) {
          return null; // expression starts at j
        }
        if (c === "`") return src.slice(i, j + 1); // closed
        j++;
      }
      return src.slice(i, j); // unclosed
    };

    const isIdentStart = (c) => /[a-zA-Z_$]/.test(c);
    const isIdentPart = (c) => /[a-zA-Z0-9_$]/.test(c);
    const sigOf = (ch) => {
      if (ch === ")" || ch === "]" || ch === "}") return ch;
      if (/[a-zA-Z0-9_$]/.test(ch)) return "id";
      if (ch === "'" || ch === '"' || ch === "`") return "str";
      return "op";
    };
    const skipRegexAt = (start) => {
      // start points at the opening '/' of a regex literal
      let m = start + 1;
      let inClass = false;
      while (m < n) {
        const rc2 = src[m];
        if (rc2 === "\\") {
          m += 2;
          continue;
        }
        if (rc2 === "[") inClass = true;
        else if (rc2 === "]") inClass = false;
        else if (rc2 === "/" && !inClass) {
          m++;
          while (m < n && /[gimsuy]/.test(src[m])) m++;
          return m;
        }
        m++;
      }
      return m;
    };

    while (i < n) {
      const c = src[i];
      const next = src[i + 1];

      if (c === " " || c === "\t" || c === "\v" || c === "\f" || c === "\r" || c === "\n") {
        // collapse whitespace runs: one space for inline runs, one newline if
        // the run contains a newline (keeps ASI-safe structure, hides layout)
        let hadNL = false;
        while (i < n && " \t\v\f\r\n".includes(src[i])) {
          if (src[i] === "\n") hadNL = true;
          i++;
        }
        out.push(hadNL ? "\n" : " ");
        continue;
      }
      if (c === "/" && next === "/") {
        // strip line comment
        let j = i + 2;
        while (j < n && src[j] !== "\n") j++;
        out.push(" ");
        i = j;
        continue;
      }
      if (c === "/" && next === "*") {
        // strip block comment
        let j = i + 2;
        let endIdx = src.indexOf("*/", j);
        j = endIdx === -1 ? n : endIdx + 2;
        const newlines = (src.slice(i, j).match(/\n/g) || []).length;
        out.push(newlines ? "\n".repeat(newlines) : " ");
        i = j;
        continue;
      }
      if (c === "'" || c === '"') {
        const s = readString(c);
        if (requireArg) {
          out.push(s.text);
        } else {
          const enc = this.encodeString(s.body);
          if (enc !== null) {
            let j = s.end;
            while (j < n && (src[j] === " " || src[j] === "\t")) j++;
            let back = i - 1;
            while (
              back >= 0 &&
              (src[back] === " " || src[back] === "\t" || src[back] === "\n" || src[back] === "\r")
            )
              back--;
            if (src[j] === ":" && (src[back] === "{" || src[back] === ",")) {
              out.push("[" + enc + "]");
            } else {
              out.push(enc);
            }
          } else {
            out.push(s.text);
          }
        }
        requireArg = false;
        requireFollows = false;
        prev = "str";
        line += (s.body.match(/\n/g) || []).length;
        i = s.end;
        continue;
      }
      if (c === "`") {
        // tagged templates (`tag`...`) hand the raw array to the tag function,
        // so they must stay verbatim. Ordinary templates are rebuilt as pure
        // interpolations: every raw segment is XOR-encrypted, so no template
        // text (URLs, messages, SQL fragments) survives in readable form.
        const tagged =
          prev === "id" || prev === ")" || prev === "]" || prev === "}" || prev === "str";
        if (tagged) {
          let end = i + 1;
          while (end < n) {
            const tc = src[end];
            if (tc === "\\") { end += 2; continue; }
            if (tc === "`") { end++; break; }
            end++;
          }
          out.push(src.slice(i, end));
          requireArg = false;
          requireFollows = false;
          prev = "str";
          i = end;
          continue;
        }
        let j = i + 1;
        let acc = "`";
        let closed = false;
        const rawSegs = [];
        const exprs = [];
        let raw = "";
        requireArg = false;
        requireFollows = false;
        while (j < n) {
          const ch = src[j];
          if (ch === "\\") {
            raw += src[j] + (j + 1 < n ? src[j + 1] : "");
            j += 2;
            continue;
          }
          if (ch === "`") {
            j++;
            closed = true;
            break;
          }
          if (ch === "$" && src[j + 1] === "{") {
            // find balanced expression end (skip strings/regex/comments)
            let depth = 1;
            let k = j + 2;
            let exprStart = k;
            let prev = "op";
            while (k < n && depth > 0) {
              const ec = src[k];
              if (ec === "'" || ec === '"') {
                const inner = this.readStringAt(k);
                k = inner.end;
                prev = "str";
                continue;
              }
              if (ec === "`") {
                const rm = this.readTemplateAt(k);
                if (rm.template) {
                  k = rm.end;
                } else k++;
                prev = "str";
                continue;
              }
              if (ec === "/" && src[k + 1] === "/") {
                while (k < n && src[k] !== "\n") k++;
                continue;
              }
              if (ec === "/" && src[k + 1] === "*") {
                const en = src.indexOf("*/", k + 2);
                k = en === -1 ? n : en + 2;
                continue;
              }
              if (ec === "/") {
                // division vs regex literal: a " in the regex body must not
                // desync the string skip, so consume regexes whole
                const isDiv =
                  prev === "id" || prev === "num" || prev === "str" ||
                  prev === ")" || prev === "]" || prev === "}";
                if (isDiv) {
                  k++;
                  prev = "op";
                  continue;
                }
                k = skipRegexAt(k);
                prev = "op";
                continue;
              }
              if (ec === "{") depth++;
              if (ec === "}") depth--;
              prev = sigOf(ec);
              k++;
            }
            const expr = src.slice(exprStart, k - 1);
            rawSegs.push(raw);
            raw = "";
            const transformed = this.transformExpression(expr);
            exprs.push(transformed);
            j = k;
            continue;
          }
          raw += ch;
          j++;
        }
        rawSegs.push(raw);
        const emitRaw = (seg) => {
          // Keep raws that contain require() calls verbatim: the build gate
          // requires every source require-path to still appear in the output.
          const hasRequire = /require\s*\(\s*['"]/.test(seg);
          const enc = !hasRequire && seg !== "" ? this.encodeString(this.interpretRaw(seg)) : null;
          if (enc !== null) acc += "${" + enc + "}";
          else acc += seg; // require-carrier / minString fallback: literal
        };
        for (let t = 0; t < exprs.length; t++) {
          emitRaw(rawSegs[t]);
          acc += "${" + exprs[t] + "}";
        }
        emitRaw(rawSegs[rawSegs.length - 1]);
        acc += "`";
        out.push(acc);
        prev = "str";
        i = j;
        continue;
      }
      if (c === "/") {
        // regex or division — comments already handled above
        const isDiv =
          prev === "id" || prev === "num" || prev === "str" || prev === ")" ||
          prev === "]" || prev === "}";
        if (isDiv) {
          out.push(c);
          i++;
          prev = "op";
          continue;
        }
        // regex literal — read verbatim (skipping string-like classes we don't
        // need; regexes in this code have no nested complexities)
        let j = i + 1;
        let inClass = false;
        while (j < n) {
          const rc = src[j];
          if (rc === "\\") {
            j += 2;
            continue;
          }
          if (rc === "[") inClass = true;
          if (rc === "]") inClass = false;
          if (rc === "/" && !inClass) {
            j++;
            while (j < n && /[gimsuy]/.test(src[j])) j++;
            break;
          }
          j++;
        }
        out.push(src.slice(i, j));
        i = j;
        prev = "op";
        continue;
      }
      if (isIdentStart(c)) {
        let j = i + 1;
        while (j < n && isIdentPart(src[j])) j++;
        const word = src.slice(i, j);
        const isDunder = word.startsWith("__") && word.endsWith("__");
        // object-literal key position? `key:` / shorthand `key(...)` / `key,`
        if (keyPos && !requireFollows) {
          let k = j;
          while (k < n && " \t".includes(src[k])) k++;
          const nc = src[k];
          if (nc === ":" || nc === "(") {
            const enc = this.encodeString(word);
            // `__proto__` and `constructor` special-cased: computed forms change
            // proto-set / class-constructor semantics in some engines.
            if (enc !== null && !isDunder && word !== "constructor") {
              out.push("[" + enc + "]");
            } else {
              out.push(word);
            }
            keyPos = false;
            prev = "]";
            lastSig = "]";
            i = j;
            continue;
          }
          if (nc === "," || nc === "}" || nc === "=") {
            // shorthand property `{ a }` / `{ a = def }`: rewrite to computed-key
            // form so the binding side can be renamed independently of the
            // property name (survives object literals AND destructuring).
            const enc = this.encodeString(word);
            const renamed = this.rename.get(word) || word;
            if (enc !== null && !isDunder && word !== "constructor") {
              out.push("[" + enc + "]: " + renamed);
            } else {
              out.push(word);
            }
            keyPos = false;
            prev = "op";
            lastSig = ":";
            i = j;
            continue;
          }
        }
        const inObjCtx = ctxStack[ctxStack.length - 1] === true;
        // accessor/static prefixes hand the key slot to the method name after
        // them; `async` does too UNLESS it's `async function` (the `function`
        // keyword must not be read as a key).
        let keySlot = (word === "get" || word === "set" || word === "static") && inObjCtx;
        if (word === "async" && inObjCtx) {
          let k = j;
          while (k < n && " \t".includes(src[k])) k++;
          keySlot = !(src.slice(k, k + 8) === "function");
        }
        out.push(this.rename.get(word) || word);
        if (word === "require") requireFollows = true;
        else requireFollows = false;
        prev = "id";
        lastSig = word;
        keyPos = keySlot;
        i = j;
        continue;
      }
      // member access `.name` -> `[dec]`. Guard: must follow a value/close
      // (not `?.` optional chaining, not `...` spread, not a decimal point).
      if (c === "." && next === "." ) {
        // `...` spread/rest or `.5` — not a member access. Clearing keyPos
        // keeps `{...x}` from being read as shorthand (x is a ref/rest element).
        keyPos = false;
        requireFollows = false;
        requireArg = false;
      } else if (
        c === "." &&
        isIdentStart(next || "") &&
        (prev === "id" || prev === "num" || prev === "str" ||
         prev === ")" || prev === "]" || prev === "}" || prev === "call")
      ) {
        let j = i + 1;
        while (j < n && isIdentPart(src[j])) j++;
        const prop = src.slice(i + 1, j);
        const enc = this.encodeString(prop);
        if (enc !== null) {
          out.push("[" + enc + "]");
        } else {
          out.push("." + prop);
        }
        requireFollows = false;
        requireArg = false;
        prev = "]";
        lastSig = "]";
        keyPos = false;
        i = j;
        continue;
      }
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(next || ""))) {
        let j = i;
        if (c === "0" && /[xXbBoO]/.test(next || "")) {
          j += 2;
          while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++;
        } else {
          while (j < n && /[0-9_]/.test(src[j])) j++;
          if (src[j] === "." && /[0-9]/.test(src[j + 1] || "")) {
            j++;
            while (j < n && /[0-9_]/.test(src[j])) j++;
          }
          if (src[j] === "e" || src[j] === "E") {
            let k = j + 1;
            if (src[k] === "+" || src[k] === "-") k++;
            if (/[0-9]/.test(src[k] || "")) {
              j = k;
              while (j < n && /[0-9_]/.test(src[j])) j++;
            }
          }
        }
        const numStr = src.slice(i, j);
        const enc = this.encodeNumber(numStr);
        out.push(enc !== null ? enc : numStr);
        requireFollows = false;
        prev = "num";
        i = j;
        continue;
      }
      if (c === "{") {
        out.push(c);
        const isObj = !BLOCK_SIGS.has(lastSig);
        // push "block" for method/function bodies so `}` can tell a block close
        // apart from an object-literal close (only the former lands on a key slot)
        ctxStack.push(isObj ? true : "block");
        keyPos = isObj;
        requireFollows = false;
        requireArg = false;
        prev = "op";
        lastSig = "{";
        i++;
        continue;
      }
      if (c === "[") {
        out.push(c);
        ctxStack.push("arr");
        keyPos = false;
        requireFollows = false;
        requireArg = false;
        prev = "op";
        lastSig = "[";
        i++;
        continue;
      }
      if (c === "(") {
        out.push(c);
        ctxStack.push("paren");
        if (requireFollows) requireArg = true;
        requireFollows = false;
        keyPos = false;
        prev = "call";
        lastSig = "(";
        i++;
        continue;
      }
      if (c === ")" || c === "]" || c === "}") {
        out.push(c);
        const closedCtx = ctxStack.pop();
        // Closing a *block* (method/function body) lands on the entry slot of
        // the enclosing object/class body: the next identifier can be a method
        // key again. Objects/arrays/parens never do.
        keyPos = c === "}" && closedCtx === "block" && ctxStack[ctxStack.length - 1] === true;
        requireFollows = false;
        requireArg = false;
        prev = c === ")" ? ")" : c;
        lastSig = c;
        i++;
        continue;
      }
      if (c === ",") {
        out.push(c);
        keyPos = (ctxStack[ctxStack.length - 1] === true);
        requireFollows = false;
        requireArg = false;
        prev = "op";
        lastSig = ",";
        i++;
        continue;
      }
      if (c === ":" ) {
        out.push(c);
        keyPos = false;
        requireFollows = false;
        requireArg = false;
        prev = "op";
        lastSig = ":";
        i++;
        continue;
      }
      if (c === "=" && next === ">") {
        out.push("=>");
        keyPos = false;
        requireFollows = false;
        requireArg = false;
        prev = "op";
        lastSig = "=>";
        i += 2;
        continue;
      }
      if (c === "=") {
        out.push(c);
        keyPos = false;
        requireFollows = false;
        requireArg = false;
        prev = "op";
        lastSig = "=";
        i++;
        continue;
      }
      // Punctuation/operators
      out.push(c);
      requireFollows = false;
      requireArg = false;
      prev = c === ")" ? ")" : "op";
      i++;
    }

    return out.join("");
  }

  readStringAt(k) {
    const q = this.src[k];
    let j = k + 1;
    while (j < this.src.length) {
      const c = this.src[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === q) {
        j++;
        break;
      }
      j++;
    }
    return { text: this.src.slice(k, j), end: j };
  }

  /** Interpret template-raw escapes (`\n`, `\${`, `\x41`, `\u1234`, ...) into
   *  the runtime string the segment denotes, mirroring String.raw semantics
   *  for the transformed (non-tagged) templates. */
  interpretRaw(raw) {
    let s = "";
    for (let p = 0; p < raw.length; p++) {
      const ch = raw[p];
      if (ch !== "\\") { s += ch; continue; }
      const e = raw[++p];
      if (e === "n") s += "\n";
      else if (e === "t") s += "\t";
      else if (e === "r") s += "\r";
      else if (e === "b") s += "\b";
      else if (e === "f") s += "\f";
      else if (e === "v") s += "\v";
      else if (e === "0") s += "\0";
      else if (e === "x") {
        const hx = raw.slice(p + 1, p + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hx)) { s += String.fromCharCode(parseInt(hx, 16)); p += 2; }
        else s += "x";
      } else if (e === "u") {
        if (raw[p + 1] === "{") {
          const cl = raw.indexOf("}", p + 2);
          if (cl !== -1) {
            const cp = parseInt(raw.slice(p + 2, cl), 16);
            if (!Number.isNaN(cp)) { s += String.fromCodePoint(cp); p = cl; continue; }
          }
        }
        const hx = raw.slice(p + 1, p + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hx)) { s += String.fromCharCode(parseInt(hx, 16)); p += 4; }
        else s += "u";
      } else s += e;
    }
    return s;
  }

  readTemplateAt(k) {
    let j = k + 1;
    while (j < this.src.length) {
      const c = this.src[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "`") return { template: true, end: j + 1 };
      if (c === "$" && this.src[j + 1] === "{") {
        const sigOf2 = (ch) => {
          if (ch === ")" || ch === "]" || ch === "}") return ch;
          if (/[a-zA-Z0-9_$]/.test(ch)) return "id";
          if (ch === "'" || ch === '"' || ch === "`") return "str";
          return "op";
        };
        const skipRegex2 = (start) => {
          let p = start + 1;
          let inClass = false;
          const sc = this.src;
          while (p < sc.length) {
            const rc2 = sc[p];
            if (rc2 === "\\") {
              p += 2;
              continue;
            }
            if (rc2 === "[") inClass = true;
            else if (rc2 === "]") inClass = false;
            else if (rc2 === "/" && !inClass) {
              p++;
              while (p < sc.length && /[gimsuy]/.test(sc[p])) p++;
              return p;
            }
            p++;
          }
          return p;
        };
        let depth = 1;
        let m = j + 2;
        let prev = "op";
        while (m < this.src.length && depth > 0) {
          const ec = this.src[m];
          if (ec === "'" || ec === '"') {
            m = this.readStringAt(m).end;
            prev = "str";
            continue;
          }
          if (ec === "`") {
            m = this.readTemplateAt(m).end;
            prev = "str";
            continue;
          }
          if (ec === "/" && this.src[m + 1] === "/") {
            while (m < this.src.length && this.src[m] !== "\n") m++;
            continue;
          }
          if (ec === "/" && this.src[m + 1] === "*") {
            const en = this.src.indexOf("*/", m + 2);
            m = en === -1 ? this.src.length : en + 2;
            continue;
          }
          if (ec === "/") {
            const isDiv =
              prev === "id" || prev === "num" || prev === "str" ||
              prev === ")" || prev === "]" || prev === "}";
            if (isDiv) {
              m++;
              prev = "op";
              continue;
            }
            m = skipRegex2(m);
            prev = "op";
            continue;
          }
          if (ec === "{") depth++;
          if (ec === "}") depth--;
          prev = sigOf2(ec) === "id" || sigOf2(ec) === "num" ? "id" : sigOf2(ec);
          m++;
        }
        j = m;
        continue;
      }
      j++;
    }
    return { template: false, end: this.src.length };
  }

  /**
   * Transform the inside of a ${ ... } expression with balanced-brace awareness
   * via a nested Obfuscator-like run (fresh table, same level config).
   */
  transformExpression(expr) {
    const nested = new Obfuscator(expr, this.level);
    nested.seed = this.seed ^ 0x9e3779b9;
    nested.names = this.names; // reuse decoder names
    nested.table = this.table;
    nested.entries = this.entries;
    nested.key = this.key;
    nested.rename = this.rename;
    try {
      return nested.transform();
    } catch (e) {
      return expr;
    }
  }

  build() {
    let output = this.transform();
    // Junk is generated AFTER the body scan but BEFORE the prelude so its
    // decode entries land in the emitted table array.
    if (this.level.junk > 0) output = this.junk(output);
    output = this.prelude() + "\n" + output;
    return output;
  }
}

/**
 * Public: obfuscate a source string.
 */
function obfuscateSource(source, levelName) {
  const level = LEVELS[levelName] || LEVELS.full;
  const engine = new Obfuscator(source, level);
  return engine.build();
}

/**
 * Extract require() argument paths, decoding hex escapes first.
 */
function extractRequires(source) {
  const decoded = source.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  const found = new Set();
  const re = /require\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = re.exec(decoded)) !== null) found.add(m[1]);
  return found;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const stdout = (s) => process.stdout.write(s + "\n");

if (require.main === module) {
  main();
}

function main() {
  const argv = process.argv.slice(2);
  const levelName =
    (() => {
      const idx = argv.indexOf("--level");
      return idx >= 0 ? argv[idx + 1] : "full";
    })();
  const positional = argv.filter((a) => a && !a.startsWith("--"));
  if (argv.includes("--check")) {
    const target = positional[0];
    const input = fs.readFileSync(target, "utf8");
    try {
      const outSrc = obfuscateSource(input, levelName);
      const requirePaths = [...extractRequires(input)];
      const lost = requirePaths.filter(
        (p) => !outSrc.includes(`"${p}"`) && !outSrc.includes(`'${p}'`),
      );
      if (lost.length) {
        stdout("check FAILED: require paths dropped: " + lost.join(", "));
        process.exit(1);
      }
      try {
        new Function(outSrc);
        stdout(
          `check OK (${levelName}, ${outSrc.length} bytes, ${requirePaths.length} requires intact)`,
        );
        if (argv.includes("--dump")) fs.writeFileSync(target + ".obf", outSrc);
        process.exit(0);
      } catch (e) {
        stdout("check FAILED: invalid output JS: " + e.message);
        process.exit(1);
      }
    } catch (e) {
      stdout("check FAILED: " + e.message);
      process.exit(1);
    }
  }
  if (argv.length >= 2 && !argv[0].startsWith("--") && !argv[1].startsWith("--")) {
    const input = fs.readFileSync(argv[0], "utf8");
    const output = obfuscateSource(input, levelName);
    fs.writeFileSync(argv[1], output);
    stdout(output.length + " bytes -> " + argv[1]);
    process.exit(0);
  }
  stdout("usage: node obfuscate.js <input.js> <output.js> [--level light|full]");
}

module.exports = {
  obfuscateSource,
  extractRequires,
  LEVELS,
};