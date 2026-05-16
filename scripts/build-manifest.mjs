#!/usr/bin/env node
// Usage: node scripts/build-manifest.mjs <version> <assets-dir> [--release-notes "..."]
//
// Reads asset filenames + sizes from the directory and produces a manifest.json
// matching the schema currently served at https://releases.geiant.com/manifest.json

import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const version = process.argv[2];
const assetsDir = process.argv[3] || './assets';
const notesIdx = process.argv.indexOf('--release-notes');
const releaseNotesShort =
    notesIdx > -1 ? process.argv[notesIdx + 1] : `Release v${version}`;

if (!version) {
    console.error('Usage: build-manifest.mjs <version> <assets-dir> [--release-notes "..."]');
    process.exit(1);
}

const files = readdirSync(assetsDir).map((name) => ({
    name,
    size: statSync(join(assetsDir, name)).size,
}));

// Match filename patterns to platform slots
const match = (re) => files.find((f) => re.test(f.name));
const urlFor = (file) =>
    file ? `https://releases.geiant.com/v${version}/${file.name}` : null;
const sizeFor = (file) => (file ? file.size : 0);

const macArm = match(/aarch64\.dmg$/i);
const macX64 = match(/(x64|x86_64)\.dmg$/i);
const winX64 = match(/(x64.*setup\.exe|x64.*\.msi|_x64\.exe)$/i);
const linuxDeb = match(/\.deb$/i);
const linuxApp = match(/\.AppImage$/i);

const manifest = {
    latest_version: version,
    published_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    release_notes_short: releaseNotesShort,
    release_notes_url: 'https://github.com/GNS-Foundation/hive-desktop/releases',
    platforms: {
        'macos-arm64': {
            name: 'macOS (Apple Silicon)',
            meta: 'M1, M2, M3, M4',
            url: urlFor(macArm),
            size_bytes: sizeFor(macArm),
        },
        'macos-x64': {
            name: 'macOS (Intel)',
            meta: 'Intel-based Macs',
            url: urlFor(macX64),
            size_bytes: sizeFor(macX64),
        },
        'windows-x64': {
            name: 'Windows',
            meta: '64-bit installer',
            url: urlFor(winX64),
            size_bytes: sizeFor(winX64),
        },
        'linux-deb': {
            name: 'Linux (Debian/Ubuntu)',
            meta: '.deb package',
            url: urlFor(linuxDeb),
            size_bytes: sizeFor(linuxDeb),
        },
        'linux-appimage': {
            name: 'Linux (AppImage)',
            meta: 'portable, all distros',
            url: urlFor(linuxApp),
            size_bytes: sizeFor(linuxApp),
        },
    },
};

writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('Wrote manifest.json:');
console.log(JSON.stringify(manifest, null, 2));