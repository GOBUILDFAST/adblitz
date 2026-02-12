#!/usr/bin/env node

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const cliProgress = require('cli-progress');
const chalk = require('chalk');

// ── Constants ────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac']);
const VERSION = '1.2.1';

// Max concurrent ffmpeg processes to avoid overwhelming the system
const MAX_CONCURRENCY = 4;

// ── Color helpers ────────────────────────────────────────────────────────────

const ok = chalk.green;
const warn = chalk.yellow;
const err = chalk.red;
const dim = chalk.gray;
const bold = chalk.bold;
const title = chalk.bold.cyan;

// ── Friendly no-args help ────────────────────────────────────────────────────

function showGettingStarted() {
  console.log(title('\n🎬 AdBlitz v' + VERSION + ' — Bulk Video Ad Generator\n'));
  console.log(`  Combine hooks, bodies & CTAs into ${bold('every possible combination')} automatically.\n`);
  console.log(bold('  Quick Start:\n'));
  console.log(dim('  1. Create folders with your video clips:'));
  console.log(`     ${ok('hooks/')}   → short attention-grabbing intros`);
  console.log(`     ${ok('ctas/')}    → call-to-action endings`);
  console.log(`     ${ok('bodies/')}  → (optional) middle sections\n`);
  console.log(dim('  2. Run AdBlitz:'));
  console.log(`     ${bold('adblitz --hooks ./hooks --ctas ./ctas')}`);
  console.log(`     ${bold('adblitz --hooks ./hooks --bodies ./bodies --ctas ./ctas')}\n`);
  console.log(dim('  3. Find your combined videos in ./output/\n'));
  console.log(bold('  New in v1.2:\n'));
  console.log(`     ${ok('--segments')}      Custom segment types (any number, any order)`);
  console.log(`     ${ok('--naming')}        Custom naming templates`);
  console.log(`     ${ok('--music')}         Add background music`);
  console.log(`     ${ok('--overlay')}       Burn text onto videos`);
  console.log(`     ${ok('--thumbnails')}    Extract thumbnails`);
  console.log(`     ${ok('--captions')}      Auto-generate captions (requires whisper)`);
  console.log(`     ${ok('--trim-*')}        Trim segments to specific durations\n`);
  console.log(dim(`  Run ${bold('adblitz --help')} for full usage.\n`));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Sanitize a filename to be safe for the filesystem.
 * Removes path traversal, null bytes, and problematic characters.
 */
function sanitizeFilename(name) {
  // Remove null bytes
  name = name.replace(/\0/g, '');
  // Remove path separators (prevent traversal)
  name = name.replace(/[/\\]/g, '_');
  // Remove other problematic chars for cross-platform compat
  name = name.replace(/[<>:"|?*]/g, '_');
  // Collapse multiple underscores
  name = name.replace(/_+/g, '_');
  // Trim dots and spaces from start/end (Windows issue)
  name = name.replace(/^[.\s]+|[.\s]+$/g, '');
  // Truncate to 200 chars (leave room for extension and path)
  if (name.length > 200) name = name.substring(0, 200);
  // Fallback if empty
  if (!name) name = 'unnamed';
  return name;
}

/**
 * Escape a string for use inside ffmpeg shell commands.
 * Uses single-quote wrapping with proper escaping.
 */
function shellEscape(s) {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Check if a file is a regular file (not symlink, not 0-byte for videos).
 */
function isValidVideoFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    // Skip symlinks
    if (stat.isSymbolicLink()) return false;
    // Skip 0-byte files
    if (stat.size === 0) return false;
    return stat.isFile();
  } catch {
    return false;
  }
}

function isValidAudioFile(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink()) return false;
    if (stat.size === 0) return false;
    return stat.isFile();
  } catch {
    return false;
  }
}

function getVideos(dir, label) {
  if (!dir) return [];
  const abs = path.resolve(dir);

  if (!fs.existsSync(abs)) {
    console.error(err(`\n✗ ${label} folder not found: ${abs}\n`));
    console.error(warn(`  How to fix: mkdir -p ${dir}\n`));
    process.exit(1);
  }
  if (!fs.statSync(abs).isDirectory()) {
    console.error(err(`\n✗ ${label} path is not a folder: ${abs}\n`));
    process.exit(1);
  }

  let allEntries;
  try {
    allEntries = fs.readdirSync(abs);
  } catch (e) {
    console.error(err(`\n✗ Cannot read ${label} folder: ${e.message}\n`));
    process.exit(1);
  }

  // Filter hidden files
  const allFiles = allEntries.filter(f => !f.startsWith('.'));

  const nonVideo = allFiles.filter(f => !VIDEO_EXTS.has(path.extname(f).toLowerCase()));
  if (nonVideo.length > 0) {
    console.log(warn(`\n⚠ Skipping ${nonVideo.length} non-video file(s) in ${label}`));
  }

  const videos = allFiles
    .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .filter(f => isValidVideoFile(path.join(abs, f)))
    .sort()
    .map(f => ({ name: path.parse(f).name, path: path.join(abs, f) }));

  if (!videos.length) {
    console.error(err(`\n✗ No video files found in ${label} folder: ${abs}\n`));
    process.exit(1);
  }
  return videos;
}

function getAudioFiles(input) {
  if (!input) return [];
  const abs = path.resolve(input);
  if (!fs.existsSync(abs)) {
    console.error(err(`\n✗ Music path not found: ${abs}\n`));
    process.exit(1);
  }
  if (fs.statSync(abs).isFile()) {
    if (!isValidAudioFile(abs)) {
      console.error(err(`\n✗ Music file is empty or invalid: ${abs}\n`));
      process.exit(1);
    }
    return [{ name: path.parse(abs).name, path: abs }];
  }
  const files = fs.readdirSync(abs)
    .filter(f => !f.startsWith('.') && AUDIO_EXTS.has(path.extname(f).toLowerCase()))
    .filter(f => isValidAudioFile(path.join(abs, f)))
    .sort()
    .map(f => ({ name: path.parse(f).name, path: path.join(abs, f) }));
  if (!files.length) {
    console.error(err(`\n✗ No audio files found in: ${abs}\n`));
    process.exit(1);
  }
  return files;
}

function parseOverlays(overlayArg, overlaysFileArg) {
  const result = [];
  if (overlayArg) {
    const arr = Array.isArray(overlayArg) ? overlayArg : [overlayArg];
    arr.forEach(t => result.push(t));
  }
  if (overlaysFileArg) {
    const abs = path.resolve(overlaysFileArg);
    if (!fs.existsSync(abs)) {
      console.error(err(`\n✗ Overlays file not found: ${abs}\n`));
      process.exit(1);
    }
    const lines = fs.readFileSync(abs, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach(l => result.push(l));
  }
  return result;
}

function parseTrim(trimStr) {
  if (!trimStr) return null;
  // "0-3" means start at 0s, end at 3s (duration = end - start)
  // "last3" means last 3 seconds
  const lastMatch = trimStr.match(/^last(\d+(\.\d+)?)$/i);
  if (lastMatch) {
    const seconds = parseFloat(lastMatch[1]);
    if (seconds <= 0) {
      console.error(err(`\n✗ Invalid trim: "last" duration must be positive: "${trimStr}"\n`));
      process.exit(1);
    }
    return { mode: 'last', seconds };
  }
  const rangeMatch = trimStr.match(/^(\d+(\.\d+)?)-(\d+(\.\d+)?)$/);
  if (rangeMatch) {
    const start = parseFloat(rangeMatch[1]);
    const end = parseFloat(rangeMatch[3]);
    if (end <= start) {
      console.error(err(`\n✗ Invalid trim range: end (${end}) must be greater than start (${start})\n`));
      process.exit(1);
    }
    return { mode: 'range', start, duration: end - start };
  }
  // Just a number = duration from start
  const dur = parseFloat(trimStr);
  if (!isNaN(dur) && dur > 0) return { mode: 'range', start: 0, duration: dur };
  console.error(err(`\n✗ Invalid trim format: "${trimStr}". Use "0-3", "last3", or "3" (must be positive)\n`));
  process.exit(1);
}

function parseSegments(segArgs) {
  // Parse "label:./path" pairs
  // Handle Windows paths with drive letters (e.g., hook:C:\path) by only splitting on first colon
  // But also handle label:./path correctly
  const segments = [];
  for (const seg of segArgs) {
    const colonIdx = seg.indexOf(':');
    if (colonIdx === -1) {
      console.error(err(`\n✗ Invalid segment format: "${seg}". Use label:./path\n`));
      process.exit(1);
    }
    const label = seg.substring(0, colonIdx).trim();
    const dir = seg.substring(colonIdx + 1).trim();
    if (!label) {
      console.error(err(`\n✗ Segment label cannot be empty: "${seg}"\n`));
      process.exit(1);
    }
    if (!dir) {
      console.error(err(`\n✗ Segment path cannot be empty: "${seg}"\n`));
      process.exit(1);
    }
    const videos = getVideos(dir, label);
    segments.push({ label, videos });
  }
  if (segments.length === 0) {
    console.error(err(`\n✗ No segments provided\n`));
    process.exit(1);
  }
  return segments;
}

function cartesian(arrays) {
  if (arrays.length === 0) return [[]];
  return arrays.reduce((acc, arr) =>
    acc.flatMap(combo => arr.map(item => [...combo, item])),
    [[]]
  );
}

function applyNaming(template, parts, index) {
  const date = new Date().toISOString().slice(0, 10);
  let name = template;
  // Replace {index} with zero-padded index
  name = name.replace(/\{index\}/g, String(index + 1).padStart(4, '0'));
  name = name.replace(/\{date\}/g, date);
  // Replace {label} patterns with corresponding part names
  for (const p of parts) {
    // Replace all occurrences of {label} with the part's video name
    name = name.replace(new RegExp(`\\{${escapeRegex(p.label)}\\}`, 'g'), p.video.name);
  }
  // Replace any generic {0}, {1}, {2} etc with part names by position
  parts.forEach((p, i) => {
    name = name.replace(new RegExp(`\\{${i}\\}`, 'g'), p.video.name);
  });
  return name;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getVideoDuration(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 ${shellEscape(filePath)}`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();
    const dur = parseFloat(result);
    if (isNaN(dur) || dur <= 0) return null;
    return dur;
  } catch {
    return null;
  }
}

/**
 * Probe whether a video file has an audio stream.
 */
function hasAudioStream(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 ${shellEscape(filePath)}`,
      { encoding: 'utf-8', timeout: 30000 }
    ).trim();
    return result.length > 0;
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(path.resolve(dir), { recursive: true });
}

function checkFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    console.error(err('\n✗ ffmpeg is not installed or not in your PATH.\n'));
    console.error(warn('  Mac: brew install ffmpeg | Windows: choco install ffmpeg\n'));
    process.exit(1);
  }
}

function checkWhisper() {
  try {
    execSync('which whisper || where whisper 2>/dev/null', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runFfmpeg(cmd) {
  return new Promise((resolve, reject) => {
    const proc = exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
    // Ensure child process doesn't keep Node alive on unhandled errors
    proc.on('error', (e) => reject(e));
  });
}

/**
 * Run tasks with limited concurrency.
 */
async function runWithConcurrency(tasks, concurrency, onComplete) {
  let index = 0;
  let completed = 0;
  const results = new Array(tasks.length);

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      try {
        results[i] = { ok: true, value: await tasks[i]() };
      } catch (e) {
        results[i] = { ok: false, error: e };
      }
      completed++;
      if (onComplete) onComplete(completed, i, results[i]);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, tasks.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// ── No-args detection ────────────────────────────────────────────────────────

if (process.argv.length <= 2) {
  showGettingStarted();
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

program
  .name('adblitz')
  .description('Bulk video ad generator — combine video segments into every combination')
  .version(VERSION)

  // Classic mode
  .option('--hooks <dir>', 'Folder containing hook video clips')
  .option('--ctas <dir>', 'Folder containing CTA video clips')
  .option('--bodies <dir>', 'Folder containing body video clips')

  // Custom segments mode
  .option('--segments <items...>', 'Custom segments as label:./path pairs (e.g. hook:./hooks body:./bodies cta:./ctas)')

  // Output
  .option('--output <dir>', 'Output folder', './output')
  .option('--width <n>', 'Output width in pixels', '1080')
  .option('--height <n>', 'Output height in pixels', '1920')
  .option('--preset <name>', 'ffmpeg encoding preset', 'fast')
  .option('--dry-run', 'Preview combinations without rendering')

  // Naming
  .option('--naming <template>', 'Custom naming template, e.g. {hook}_{body}_{cta}_{date}')

  // Music
  .option('--music <path>', 'Background music file or folder')
  .option('--music-all', 'Multiply combos × all music tracks (instead of random)')

  // Text overlays
  .option('--overlay <text...>', 'Text to burn onto videos (repeatable)')
  .option('--overlays <file>', 'File with overlay texts (one per line)')
  .option('--overlay-pos <pos>', 'Overlay position: top, center, bottom', 'bottom')
  .option('--overlay-size <n>', 'Overlay font size', '48')
  .option('--overlay-color <color>', 'Overlay text color', 'white')

  // Thumbnails
  .option('--thumbnails', 'Extract a thumbnail from each video')
  .option('--thumb-time <t>', 'Thumbnail timestamp in seconds', '0')

  // Captions
  .option('--captions', 'Auto-generate captions using whisper and burn into video')

  // Trimming
  .option('--trim-hook <spec>', 'Trim hooks: "0-3", "last3", or just "3"')
  .option('--trim-body <spec>', 'Trim bodies')
  .option('--trim-cta <spec>', 'Trim CTAs')

  .action(async (opts) => {
    console.log(title('\n🎬 AdBlitz v' + VERSION + ' — Bulk Video Ad Generator\n'));

    // ── Warn if --segments used with classic flags ─────────────────────
    if (opts.segments && opts.segments.length && (opts.hooks || opts.ctas || opts.bodies)) {
      console.log(warn('  ⚠ --segments provided; ignoring --hooks/--bodies/--ctas flags\n'));
    }

    // ── Determine segments ─────────────────────────────────────────────────
    let segments = []; // array of { label, videos }
    let trimMap = {};  // label -> trim spec

    if (opts.segments && opts.segments.length) {
      // Custom segments mode
      segments = parseSegments(opts.segments);
    } else {
      // Classic mode - need at least hooks and ctas
      if (!opts.hooks || !opts.ctas) {
        console.error(err('\n✗ You need at least --hooks and --ctas (or use --segments)\n'));
        console.error(warn('  Example: adblitz --hooks ./hooks --ctas ./ctas'));
        console.error(warn('  Example: adblitz --segments hook:./hooks body:./bodies cta:./ctas\n'));
        process.exit(1);
      }
      segments.push({ label: 'hook', videos: getVideos(opts.hooks, 'Hooks') });
      if (opts.bodies) segments.push({ label: 'body', videos: getVideos(opts.bodies, 'Bodies') });
      segments.push({ label: 'cta', videos: getVideos(opts.ctas, 'CTAs') });
    }

    // Parse trim specs
    if (opts.trimHook) trimMap['hook'] = parseTrim(opts.trimHook);
    if (opts.trimBody) trimMap['body'] = parseTrim(opts.trimBody);
    if (opts.trimCta) trimMap['cta'] = parseTrim(opts.trimCta);

    // ── Validate width/height ──────────────────────────────────────────
    const w = parseInt(opts.width, 10);
    const h = parseInt(opts.height, 10);
    if (isNaN(w) || w <= 0 || w % 2 !== 0) {
      console.error(err(`\n✗ --width must be a positive even number, got: ${opts.width}\n`));
      process.exit(1);
    }
    if (isNaN(h) || h <= 0 || h % 2 !== 0) {
      console.error(err(`\n✗ --height must be a positive even number, got: ${opts.height}\n`));
      process.exit(1);
    }

    // ── Resolve music ──────────────────────────────────────────────────
    const musicFiles = getAudioFiles(opts.music);
    if (opts.musicAll && musicFiles.length === 0) {
      console.log(warn('  ⚠ --music-all specified but no music provided; ignoring'));
    }

    // ── Resolve overlays ───────────────────────────────────────────────
    const overlays = parseOverlays(opts.overlay, opts.overlays);

    // ── Pre-flight ─────────────────────────────────────────────────────
    if (!opts.dryRun) checkFfmpeg();
    if (opts.captions && !opts.dryRun) {
      if (!checkWhisper()) {
        console.error(err('\n✗ whisper not found. Install: pip install openai-whisper\n'));
        process.exit(1);
      }
    }

    const outDir = path.resolve(opts.output);
    ensureDir(outDir);
    if (opts.thumbnails) ensureDir(path.join(outDir, 'thumbnails'));

    // ── Pre-probe audio streams (needed to handle no-audio videos) ────
    // Collect all unique video file paths and check for audio
    const audioProbeCache = new Map();
    if (!opts.dryRun) {
      const allPaths = new Set();
      for (const seg of segments) {
        for (const v of seg.videos) allPaths.add(v.path);
      }
      for (const fp of allPaths) {
        audioProbeCache.set(fp, hasAudioStream(fp));
      }
    }

    // ── Build combinations (cartesian product of all segments) ─────────
    const videoArrays = segments.map(s => s.videos);
    const cartCombos = cartesian(videoArrays);

    // Attach labels to each combo
    let combos = cartCombos.map(videos => ({
      parts: videos.map((v, i) => ({ label: segments[i].label, video: v }))
    }));

    // ── Warn about large combo counts ──────────────────────────────────
    if (combos.length > 5000) {
      console.log(warn(`\n  ⚠ ${combos.length} base combinations — this may take a very long time and use significant disk space.\n`));
    }

    // ── Multiply by overlays if any ────────────────────────────────────
    if (overlays.length > 0) {
      const expanded = [];
      for (const combo of combos) {
        for (const text of overlays) {
          expanded.push({ ...combo, overlayText: text });
        }
      }
      combos = expanded;
    }

    // ── Multiply by music if --music-all ───────────────────────────────
    if (musicFiles.length > 0 && opts.musicAll) {
      const expanded = [];
      for (const combo of combos) {
        for (const track of musicFiles) {
          expanded.push({ ...combo, music: track });
        }
      }
      combos = expanded;
    } else if (musicFiles.length > 0) {
      // Assign round-robin track to each combo
      combos = combos.map((combo, i) => ({
        ...combo,
        music: musicFiles[i % musicFiles.length]
      }));
    }

    // ── Generate names (with dedup) ────────────────────────────────────
    const defaultNaming = segments.map(s => `{${s.label}}`).join('_');
    const namingTemplate = opts.naming || defaultNaming;

    const usedNames = new Set();
    combos = combos.map((combo, i) => {
      let name = applyNaming(namingTemplate, combo.parts, i);
      // Append overlay text hint if present
      if (combo.overlayText) {
        const slug = combo.overlayText.replace(/[^a-zA-Z0-9]+/g, '-').substring(0, 30);
        name += `_${slug}`;
      }
      // Append music name if --music-all
      if (combo.music && opts.musicAll) {
        name += `_${combo.music.name}`;
      }
      // Sanitize the filename
      name = sanitizeFilename(name);
      // Deduplicate names
      let finalName = name;
      let counter = 1;
      while (usedNames.has(finalName.toLowerCase())) {
        finalName = `${name}_${counter}`;
        counter++;
      }
      usedNames.add(finalName.toLowerCase());
      return { ...combo, name: finalName + '.mp4' };
    });

    // ── Print summary ──────────────────────────────────────────────────
    for (const seg of segments) {
      console.log(`  ${seg.label}: ${ok(seg.videos.length)} files`);
    }
    if (overlays.length) console.log(`  Overlays: ${ok(overlays.length)} variations`);
    if (musicFiles.length) console.log(`  Music: ${ok(musicFiles.length)} track(s)${opts.musicAll ? ' (multiplied)' : ''}`);
    console.log(`  Output: ${bold(combos.length + ' combinations')} → ${outDir}`);
    console.log(`  Size: ${w}×${h}  Naming: ${dim(namingTemplate)}\n`);

    // ── Dry run ────────────────────────────────────────────────────────
    if (opts.dryRun) {
      console.log(warn('  📋 Dry run — these files would be generated:\n'));
      combos.forEach((c, i) => {
        const extra = [];
        if (c.overlayText) extra.push(`overlay: "${c.overlayText}"`);
        if (c.music) extra.push(`music: ${c.music.name}`);
        const suffix = extra.length ? dim(` (${extra.join(', ')})`) : '';
        console.log(dim(`  ${String(i + 1).padStart(4)}. `) + c.name + suffix);
      });
      console.log(ok(`\n  ✓ ${combos.length} video(s) would be created.`));
      if (opts.thumbnails) console.log(ok(`  ✓ ${combos.length} thumbnail(s) would be created.`));
      console.log(dim(`\n  Remove --dry-run to actually generate the videos.\n`));
      return;
    }

    // ── Render ─────────────────────────────────────────────────────────
    const bar = new cliProgress.SingleBar({
      format: '  Progress |' + chalk.cyan('{bar}') + '| {percentage}% | {value}/{total} | {current}',
      barCompleteChar: '█',
      barIncompleteChar: '░',
      hideCursor: true,
    });
    bar.start(combos.length, 0, { current: '' });

    let success = 0;
    let failed = 0;
    const errors = [];

    const tasks = combos.map((combo, i) => async () => {
      const outPath = path.join(outDir, combo.name);

      // Build the ffmpeg filter for concatenation
      const parts = combo.parts;
      const n = parts.length;
      const inputArgs = parts.map(p => `-i ${shellEscape(p.video.path)}`);
      let extraInputIdx = n;

      // Check which inputs have audio
      const inputHasAudio = parts.map(p => audioProbeCache.get(p.video.path) || false);
      // We need audio for concat — generate silence for inputs without audio
      const anyHasAudio = inputHasAudio.some(Boolean) || (combo.music != null);

      // Music input
      let musicInputIdx = -1;
      if (combo.music) {
        inputArgs.push(`-i ${shellEscape(combo.music.path)}`);
        musicInputIdx = extraInputIdx++;
      }

      const filterParts = [];
      const concatInputs = [];

      for (let idx = 0; idx < n; idx++) {
        const trim = trimMap[parts[idx].label];

        // Scale + pad (force even dimensions with ceil/2*2)
        filterParts.push(
          `[${idx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[vs${idx}]`
        );

        // Audio: use real audio or generate silence
        if (inputHasAudio[idx]) {
          filterParts.push(
            `[${idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[as${idx}]`
          );
        } else {
          // Generate silent audio matching the video duration
          filterParts.push(
            `anullsrc=channel_layout=stereo:sample_rate=44100[silence${idx}];[${idx}:v]null[_vdur${idx}];[silence${idx}]aresample=44100[as${idx}]`
          );
          // We'll trim the silence to match video duration below via concat
        }

        let vLabel = `vs${idx}`;
        let aLabel = `as${idx}`;

        // Apply trim if specified
        if (trim) {
          if (trim.mode === 'last') {
            const dur = getVideoDuration(parts[idx].video.path);
            if (dur && dur > trim.seconds) {
              const ss = Math.max(0, dur - trim.seconds);
              filterParts.push(`[vs${idx}]trim=start=${ss},setpts=PTS-STARTPTS[vt${idx}]`);
              filterParts.push(`[as${idx}]atrim=start=${ss},asetpts=PTS-STARTPTS[at${idx}]`);
              vLabel = `vt${idx}`;
              aLabel = `at${idx}`;
            }
            // If dur <= trim.seconds, use the full clip (no trim needed)
          } else {
            filterParts.push(`[vs${idx}]trim=start=${trim.start}:duration=${trim.duration},setpts=PTS-STARTPTS[vt${idx}]`);
            filterParts.push(`[as${idx}]atrim=start=${trim.start}:duration=${trim.duration},asetpts=PTS-STARTPTS[at${idx}]`);
            vLabel = `vt${idx}`;
            aLabel = `at${idx}`;
          }
        }

        concatInputs.push(`[${vLabel}][${aLabel}]`);
      }

      // For inputs without audio where we generated anullsrc, we need a different approach.
      // The anullsrc generates infinite silence, so concat's duration=first will handle it.
      // But the filter above for no-audio inputs is wrong — anullsrc doesn't reference input streams properly.
      // Let's fix this: we rebuild the filter more carefully.

      // Actually, let me simplify the no-audio handling. We'll use a cleaner approach:
      // For each input without audio, we add `-f lavfi -i anullsrc=cl=stereo:r=44100` as an extra input.
      // But that changes input indices... Let's instead use the filter_complex approach properly.

      // The approach above with anullsrc in filter_complex is actually fine, but needs to be
      // duration-limited. Let's use aevalsrc instead which is simpler in filter_complex.
      // Actually the simplest: just don't output audio if no inputs have audio and no music.

      if (!anyHasAudio) {
        // No audio anywhere — produce video-only output
        // Rebuild without audio
        const filterPartsNoAudio = [];
        const concatInputsNoAudio = [];

        for (let idx = 0; idx < n; idx++) {
          const trim = trimMap[parts[idx].label];
          filterPartsNoAudio.push(
            `[${idx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[vs${idx}]`
          );

          let vLabel = `vs${idx}`;
          if (trim) {
            if (trim.mode === 'last') {
              const dur = getVideoDuration(parts[idx].video.path);
              if (dur && dur > trim.seconds) {
                const ss = Math.max(0, dur - trim.seconds);
                filterPartsNoAudio.push(`[vs${idx}]trim=start=${ss},setpts=PTS-STARTPTS[vt${idx}]`);
                vLabel = `vt${idx}`;
              }
            } else {
              filterPartsNoAudio.push(`[vs${idx}]trim=start=${trim.start}:duration=${trim.duration},setpts=PTS-STARTPTS[vt${idx}]`);
              vLabel = `vt${idx}`;
            }
          }
          concatInputsNoAudio.push(`[${vLabel}]`);
        }

        filterPartsNoAudio.push(`${concatInputsNoAudio.join('')}concat=n=${n}:v=1:a=0[concatv]`);

        // Overlay text
        let finalV = 'concatv';
        if (combo.overlayText) {
          const pos = opts.overlayPos || 'bottom';
          const size = opts.overlaySize || '48';
          const color = opts.overlayColor || 'white';
          let yExpr;
          if (pos === 'top') yExpr = 'h*0.08';
          else if (pos === 'center') yExpr = '(h-text_h)/2';
          else yExpr = 'h*0.85';
          const escapedText = combo.overlayText.replace(/'/g, "'\\''").replace(/:/g, '\\:').replace(/\\/g, '\\\\');
          filterPartsNoAudio.push(
            `[concatv]drawtext=text='${escapedText}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${yExpr}:borderw=2:bordercolor=black[overlayv]`
          );
          finalV = 'overlayv';
        }

        const filterComplex = filterPartsNoAudio.join(';');
        const inputArgsNoMusic = parts.map(p => `-i ${shellEscape(p.video.path)}`);
        const cmd = `ffmpeg -y ${inputArgsNoMusic.join(' ')} -filter_complex "${filterComplex}" -map "[${finalV}]" -c:v libx264 -preset ${opts.preset} -crf 23 -movflags +faststart ${shellEscape(outPath)} 2>&1`;

        await runFfmpeg(cmd);
      } else {
        // Has audio — need to handle mixed audio/no-audio inputs
        // For inputs without audio, generate silence using anullsrc as a lavfi input
        // We'll add extra inputs for silence generators
        const rebuiltInputArgs = [];
        const silenceInputMap = {}; // idx -> new input index for silence
        let currentInputIdx = 0;

        for (let idx = 0; idx < n; idx++) {
          rebuiltInputArgs.push(`-i ${shellEscape(parts[idx].video.path)}`);
          currentInputIdx++;
        }
        if (combo.music) {
          rebuiltInputArgs.push(`-i ${shellEscape(combo.music.path)}`);
          musicInputIdx = currentInputIdx++;
        }

        // Add silence inputs for videos without audio
        for (let idx = 0; idx < n; idx++) {
          if (!inputHasAudio[idx]) {
            rebuiltInputArgs.push(`-f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100`);
            silenceInputMap[idx] = currentInputIdx++;
          }
        }

        const fp = [];
        const ci = [];

        for (let idx = 0; idx < n; idx++) {
          const trim = trimMap[parts[idx].label];

          fp.push(
            `[${idx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30[vs${idx}]`
          );

          // Audio source
          let audioInputRef;
          if (inputHasAudio[idx]) {
            audioInputRef = `${idx}:a`;
          } else {
            audioInputRef = `${silenceInputMap[idx]}:a`;
          }
          fp.push(
            `[${audioInputRef}]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[as${idx}]`
          );

          let vLabel = `vs${idx}`;
          let aLabel = `as${idx}`;

          if (trim) {
            if (trim.mode === 'last') {
              const dur = getVideoDuration(parts[idx].video.path);
              if (dur && dur > trim.seconds) {
                const ss = Math.max(0, dur - trim.seconds);
                fp.push(`[vs${idx}]trim=start=${ss},setpts=PTS-STARTPTS[vt${idx}]`);
                fp.push(`[as${idx}]atrim=start=${ss},asetpts=PTS-STARTPTS[at${idx}]`);
                vLabel = `vt${idx}`;
                aLabel = `at${idx}`;
              }
            } else {
              fp.push(`[vs${idx}]trim=start=${trim.start}:duration=${trim.duration},setpts=PTS-STARTPTS[vt${idx}]`);
              fp.push(`[as${idx}]atrim=start=${trim.start}:duration=${trim.duration},asetpts=PTS-STARTPTS[at${idx}]`);
              vLabel = `vt${idx}`;
              aLabel = `at${idx}`;
            }
          }

          ci.push(`[${vLabel}][${aLabel}]`);
        }

        fp.push(`${ci.join('')}concat=n=${n}:v=1:a=1[concatv][concata]`);

        // Overlay text
        let finalV = 'concatv';
        if (combo.overlayText) {
          const pos = opts.overlayPos || 'bottom';
          const size = opts.overlaySize || '48';
          const color = opts.overlayColor || 'white';
          let yExpr;
          if (pos === 'top') yExpr = 'h*0.08';
          else if (pos === 'center') yExpr = '(h-text_h)/2';
          else yExpr = 'h*0.85';
          // Escape for ffmpeg drawtext: backslashes, colons, and single quotes
          const escapedText = combo.overlayText.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:');
          fp.push(
            `[concatv]drawtext=text='${escapedText}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${yExpr}:borderw=2:bordercolor=black[overlayv]`
          );
          finalV = 'overlayv';
        }

        // Music mixing
        let finalA = 'concata';
        if (combo.music) {
          fp.push(
            `[${musicInputIdx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.3[bgm]`
          );
          fp.push(
            `[concata][bgm]amix=inputs=2:duration=first:dropout_transition=2[mixeda]`
          );
          finalA = 'mixeda';
        }

        const filterComplex = fp.join(';');
        const cmd = `ffmpeg -y ${rebuiltInputArgs.join(' ')} -filter_complex "${filterComplex}" -map "[${finalV}]" -map "[${finalA}]" -c:v libx264 -preset ${opts.preset} -crf 23 -c:a aac -b:a 128k -movflags +faststart ${shellEscape(outPath)} 2>&1`;

        await runFfmpeg(cmd);
      }

      // ── Captions (post-process) ────────────────────────────────────
      if (opts.captions) {
        const captionedPath = outPath.replace(/\.mp4$/, '_captioned.mp4');
        try {
          execSync(`whisper ${shellEscape(outPath)} --output_format srt --output_dir ${shellEscape(outDir)} 2>&1`, {
            encoding: 'utf-8',
            timeout: 300000  // 5 min timeout for whisper
          });
          // Find the generated srt (whisper names it after the input)
          const baseSrt = path.join(outDir, path.parse(combo.name).name + '.srt');
          if (fs.existsSync(baseSrt)) {
            const escapedSrt = baseSrt.replace(/\\/g, '\\\\').replace(/'/g, "'\\''").replace(/:/g, '\\:');
            await runFfmpeg(
              `ffmpeg -y -i ${shellEscape(outPath)} -vf "subtitles='${escapedSrt}':force_style='FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'" -c:a copy ${shellEscape(captionedPath)} 2>&1`
            );
            fs.renameSync(captionedPath, outPath);
            // Clean up srt
            try { fs.unlinkSync(baseSrt); } catch {}
          }
        } catch (e) {
          // Captions failed, keep the video without them
          // Clean up temp files if they exist
          try { if (fs.existsSync(captionedPath)) fs.unlinkSync(captionedPath); } catch {}
        }
      }

      // ── Thumbnail ──────────────────────────────────────────────────
      if (opts.thumbnails) {
        const thumbPath = path.join(outDir, 'thumbnails', combo.name.replace(/\.mp4$/, '.jpg'));
        const thumbTime = opts.thumbTime || '0';
        try {
          await runFfmpeg(`ffmpeg -y -i ${shellEscape(outPath)} -ss ${parseFloat(thumbTime)} -frames:v 1 -q:v 2 ${shellEscape(thumbPath)} 2>&1`);
        } catch {}
      }

      return combo.name;
    });

    // Run with concurrency limit
    const results = await runWithConcurrency(tasks, MAX_CONCURRENCY, (completed, idx, result) => {
      if (result.ok) success++;
      else {
        failed++;
        errors.push({
          name: combos[idx].name,
          error: result.error.message.split('\n').slice(-3).join(' ').substring(0, 200)
        });
      }
      bar.update(completed, { current: combos[completed - 1]?.name?.substring(0, 50) || 'Processing...' });
    });

    bar.update(combos.length, { current: 'Done!' });
    bar.stop();

    // ── Results ────────────────────────────────────────────────────────
    console.log('');
    if (success > 0) console.log(ok(`  ✓ ${success} video(s) generated successfully!`));
    if (opts.thumbnails && success > 0) console.log(ok(`  ✓ Thumbnails saved to ${path.join(outDir, 'thumbnails')}`));
    if (failed > 0) {
      console.log(err(`  ✗ ${failed} failed:`));
      errors.forEach(e => console.log(err(`    • ${e.name}: ${e.error}`)));
    }
    console.log(dim('\n  ─────────────────────────────────────────────'));
    console.log(ok(`\n  📁 Your files are in ${outDir}\n`));
  });

program.parse();

// ── Global error handling ────────────────────────────────────────────────────

process.on('unhandledRejection', (reason) => {
  console.error(err(`\n✗ Unexpected error: ${reason}\n`));
  process.exit(1);
});
