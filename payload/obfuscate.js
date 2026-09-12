/**
 * Node.js source obfuscator for the payload template.
 *
 * Used by server/build-runner.js before compilation and usable standalone:
 *   node obfuscate.js <input.js> <output.js> [--level full|light] [--check]
 *
 * The option set is tuned for @yao-pkg/pkg compatibility:
 *   - stringArray/stringArrayEncoding stay DISABLED. pkg statically resolves
 *     require() paths during compilation; hiding them inside an index-indirect
 *     string array breaks the pkg bundle and the binary dies at startup with
 *     "Cannot find module". Renaming, control-flow flattening, dead-code
 *     injection and self-defending still bury the behaviour itself.
 *   - selfDefending / debugProtection are OFF by default because they interact
 *     badly with pkg's snapshot wrapper; flip them on per-build via env if the
 *     produced binary behaves.
 */
"use strict";

const JavaScriptObfuscator = require("javascript-obfuscator");
const fs = require("fs-extra");
const path = require("path");

const LEVELS = {
  light: {
    compact: true,
    identifierNamesGenerator: "mangled",
    simplify: true,
    numbersToExpressions: true,
    stringArray: false,
    renameGlobals: false,
    sourceMap: false,
    unicodeEscapeSequence: false,
    selfDefending: false,
    debugProtection: false,
  },
  full: {
    compact: true,
    identifierNamesGenerator: "mangled",
    simplify: true,
    numbersToExpressions: true,
    stringArray: false,
    renameGlobals: false,
    sourceMap: false,
    unicodeEscapeSequence: false,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.6,
    selfDefending: false,
    debugProtection: false,
  },
};

function optionOverrides() {
  const opts = {};
  if (process.env.JS_SELF_DEFENDING === "1") {
    opts.selfDefending = true;
    opts.debugProtection = process.env.JS_DEBUG_PROTECTION === "1";
  }
  return opts;
}

function obfuscateSource(source, level = "full") {
  const preset = LEVELS[level] || LEVELS.full;
  const options = { ...preset, ...optionOverrides() };
  return JavaScriptObfuscator.obfuscate(source, options).getObfuscatedCode();
}

// Static require-path scanner. pkg needs every require() literal to survive in
// the obfuscated text; anything lost here would produce a broken binary.
// String literals come back \xHH-escaped, so decode all hex escapes first
// (otherwise a preceding \x20 leaves a word char right before `require` and
// the \b anchor refuses to match).
function extractRequires(source) {
  const found = new Set();
  const unescaped = source.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) =>
    String.fromCharCode(parseInt(h, 16)),
  );
  const re = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;
  let m;
  while ((m = re.exec(unescaped)) !== null) found.add(m[2]);
  return found;
}

function main() {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('usage: node obfuscate.js <input.js> <output.js> [--level light|full] [--check]');
    process.exit(2);
  }
  const level = process.argv.includes("--level")
    ? process.argv[process.argv.indexOf("--level") + 1]
    : process.env.JS_OBSCURE_LEVEL || "full";
  const doCheck = process.argv.includes("--check");

  const source = fs.readFileSync(input, "utf8");
  const before = extractRequires(source);
  const result = obfuscateSource(source, level);
  fs.ensureDirSync(path.dirname(output));
  fs.writeFileSync(output, result, "utf8");

  if (doCheck) {
    const after = extractRequires(result);
    const lost = [...before].filter((p) => !after.has(p));
    if (lost.length) {
      console.error(`[obfuscate] FATAL: ${lost.length} require() paths lost (` + lost.join(", ") + "). pkg would emit a broken binary.");
      process.exit(1);
    }
  }
  console.log(
    `[obfuscate] ${input} -> ${output} (${level}, ${result.length} bytes)`,
  );
}

if (require.main === module) main();

module.exports = { obfuscateSource, extractRequires, LEVELS };