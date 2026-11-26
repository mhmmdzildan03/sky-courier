/**
 * Sky Courier — Island Mail Run: grader entrypoint.
 *
 * The grader runs this as `node /bot/main.ts` (node22) in a sandbox with no
 * network, a read-only repository at /bot and an empty writable /output.
 * It must exit 0 within 10 seconds and be deterministic across runs.
 *
 * What it does: verifies the shipped game is complete — the playable page,
 * the game code, the vendored motion libraries (PixiJS / matter-js /
 * anime.js), the license, the README and the 1280x720 screenshots of the
 * game running — then writes a deterministic report to $MAKEFUN_OUTPUT_DIR.
 * It never touches the network, the clock or randomness, so two runs
 * produce byte-identical output.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BOT_DIR = process.env.MAKEFUN_BOT_DIR || '.';
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || './out';

const REQUIRED_FILES = [
  'index.html',
  'game.js',
  'style.css',
  'LICENSE',
  'README.md',
  'vendor/pixi.min.js',
  'vendor/matter.min.js',
  'vendor/anime.min.js',
  '.makefun/owner.json',
];

/** Read a PNG's width/height from its IHDR chunk (bytes 16-24). */
function pngSize(path: string): { width: number; height: number } | null {
  const buf = readFileSync(path);
  if (buf.length < 29) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function main(): void {
  const files: Record<string, boolean> = {};
  const missing: string[] = [];
  for (const f of REQUIRED_FILES) {
    const ok = existsSync(join(BOT_DIR, f));
    files[f] = ok;
    if (!ok) missing.push(f);
  }

  // The game code must actually use the three motion libraries.
  const gameJs = existsSync(join(BOT_DIR, 'game.js'))
    ? readFileSync(join(BOT_DIR, 'game.js'), 'utf8')
    : '';
  const libsUsed = {
    pixi: gameJs.includes('PIXI.Application'),
    matter: gameJs.includes('Matter.Engine'),
    anime: gameJs.includes('anime('),
  };

  // The README must carry the competition's live make.fun badges.
  const readme = existsSync(join(BOT_DIR, 'README.md'))
    ? readFileSync(join(BOT_DIR, 'README.md'), 'utf8')
    : '';
  const readmeBadges = readme.includes('make.fun/badge/best-flight-game-20261126-0057');

  // Screenshots: real 1280x720 captures of the game running.
  const shotDir = join(BOT_DIR, 'screenshots');
  const screenshots: Array<{ file: string; width: number; height: number }> = [];
  if (existsSync(shotDir)) {
    for (const name of readdirSync(shotDir).sort()) {
      if (!name.toLowerCase().endsWith('.png')) continue;
      const size = pngSize(join(shotDir, name));
      if (size) screenshots.push({ file: name, width: size.width, height: size.height });
    }
  }
  const badShots = screenshots.filter((s) => s.width !== 1280 || s.height !== 720);

  const problems: string[] = [];
  if (missing.length > 0) problems.push(`missing files: ${missing.join(', ')}`);
  if (!libsUsed.pixi) problems.push('game.js does not use PixiJS');
  if (!libsUsed.matter) problems.push('game.js does not use matter-js');
  if (!libsUsed.anime) problems.push('game.js does not use anime.js');
  if (!readmeBadges) problems.push('README is missing the make.fun badges');
  if (screenshots.length < 3) problems.push(`only ${screenshots.length} screenshots (need at least 3)`);
  if (badShots.length > 0) {
    problems.push(`screenshots not 1280x720: ${badShots.map((s) => s.file).join(', ')}`);
  }

  const report = {
    game: 'Sky Courier — Island Mail Run',
    bounty: 'best-flight-game-20261126-0057',
    ok: problems.length === 0,
    files,
    libsUsed,
    screenshots,
    problems,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 2) + '\n');

  if (problems.length > 0) {
    console.error(`Sky Courier self-check FAILED: ${problems.join('; ')}`);
    process.exit(1);
  }
  console.log(
    `Sky Courier self-check OK: ${Object.keys(files).length} files, ` +
    `${screenshots.length} screenshots at 1280x720, PixiJS + matter-js + anime.js in use.`,
  );
}

main();
