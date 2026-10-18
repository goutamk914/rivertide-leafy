#!/usr/bin/env node
/**
 * Fails unless the GitHub release for <tag> carries every built file, fully uploaded and the same
 * size as the local copy. `electron-builder publish` logs upload errors but still exits 0, so the
 * release workflow runs this right after publishing.
 *
 * Usage: node scripts/check-release-assets.mjs <releases.json> <tag> <file>...
 *   releases.json  output of `gh api repos/CodeTheCure/rivertide-electron/releases` (drafts are
 *                  only listed for a token with access to the repository)
 */
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

function fail(message) {
  process.stderr.write(`::error::${message}\n`);
  process.exit(1);
}

const [releasesFile, tag, ...files] = process.argv.slice(2);
if (!releasesFile || !tag || files.length === 0) {
  fail('usage: check-release-assets.mjs <releases.json> <tag> <file>...');
}

let releases;
try {
  releases = JSON.parse(readFileSync(releasesFile, 'utf8'));
} catch (error) {
  fail(`could not read ${releasesFile}: ${error instanceof Error ? error.message : String(error)}`);
}
if (!Array.isArray(releases)) fail(`${releasesFile} is not a list of releases (${JSON.stringify(releases).slice(0, 200)})`);

const release = releases.find((candidate) => candidate.tag_name === tag);
if (!release) fail(`no release for ${tag} on GitHub; publishing did not create it`);

const assets = new Map((release.assets ?? []).map((asset) => [asset.name, asset]));
const problems = files.flatMap((file) => {
  const name = basename(file);
  const asset = assets.get(name);
  if (!asset) return [`${name} is missing`];
  if (asset.state !== 'uploaded') return [`${name} is ${asset.state ?? 'in an unknown state'}`];
  const size = statSync(file).size;
  return asset.size === size ? [] : [`${name} is ${asset.size} bytes on GitHub but ${size} bytes here`];
});
if (problems.length > 0) fail(`release ${tag}: ${problems.join('; ')}`);

process.stdout.write(`${tag}: ${release.draft ? 'draft' : 'published'} release has all ${files.length} files\n`);
