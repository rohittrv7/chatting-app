/**
 * patch-hermes-textdecoder.js
 * Automatically runs during postinstall to patch any Emscripten/WebAssembly
 * libraries (specifically @privacyresearch/curve25519-typescript) that call
 * `new TextDecoder('utf-16le')` at module root.
 *
 * This guarantees that even if a build runner or Hermes engine doesn't support utf-16le,
 * the module will never throw a fatal RangeError on startup.
 */

const fs = require('fs');
const path = require('path');

const targetPaths = [
  path.join(
    __dirname,
    '..',
    'node_modules',
    '@privacyresearch',
    'curve25519-typescript',
    'lib',
    'built',
    'curveasm.js',
  ),
  path.join(
    __dirname,
    '..',
    'apps',
    'mobile',
    'node_modules',
    '@privacyresearch',
    'curve25519-typescript',
    'lib',
    'built',
    'curveasm.js',
  ),
];

let patchedCount = 0;

for (const filePath of targetPaths) {
  if (!fs.existsSync(filePath)) continue;

  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const target =
      "var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;";
    const replacement =
      "var UTF16Decoder = (function() { try { return typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined; } catch(e) { return undefined; } })();";

    if (content.includes(target)) {
      content = content.replace(target, replacement);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✔ Successfully patched ${filePath} for Hermes TextDecoder safety.`);
      patchedCount++;
    } else if (content.includes(replacement)) {
      console.log(`ℹ Already patched: ${filePath}`);
    }
  } catch (err) {
    console.warn(`⚠ Warning while patching ${filePath}:`, err.message);
  }
}

console.log(`[Hermes Patch] Complete. Patched ${patchedCount} files.`);
