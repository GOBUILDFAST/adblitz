#!/usr/bin/env node

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const cliProgress = require('cli-progress');
const chalk = require('chalk');

// ── Constants ────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);
const VERSION = '1.1.0';

// ── Color helpers ────────────────────────────────────────────────────────────

const ok = chalk.green;
const warn = chalk.yellow;
const err = chalk.red;
const dim = chalk.gray;
const bold = chalk.bold;
const title = chalk.bold.cyan;

// ── Friendly no-args help ────────────────────────────────────────────────────

function showGettingStarted() {
  console.log(title('\n🎬 AdBlitz — Bulk Video Ad Generator\n'));
  console.log(`  Combine hooks, bodies & CTAs into ${bold('every possible combination')} automatically.\n`);
  console.log(bold('  Quick Start:\n'));
  console.log(dim('  1. Create folders with your video clips:'));
  console.log(`     ${ok('hooks/')}   → short attention-grabbing intros (e.g. hook-question.mp4)`);
  console.log(`     ${ok('ctas/')}    → call-to-action endings (e.g. cta-signup.mp4)`);
  console.log(`     ${ok('bodies/')}  → (optional) middle sections\n`);
  console.log(dim('  2. Run AdBlitz:'));
  console.log(`     ${bold('adblitz --hooks ./hooks --ctas ./ctas')}`);
  console.log(`     ${bold('adblitz --hooks ./hooks --bodies ./bodies --ctas ./ctas')}\n`);
  console.log(dim('  3. Find your combined videos in ./output/\n'));
  console.log(bold('  Useful flags:\n'));
  console.log(`     ${ok('--dry-run')}       Preview what will be generated (no rendering)`);
  console.log(`     ${ok('--output <dir>')}  Change output folder (default: ./output)`);
  console.log(`     ${ok('--width <n>')}     Output width in pixels (default: 1080)`);
  console.log(`     ${ok('--height <n>')}    Output height in pixels (default: 1920)`);
  console.log(`     ${ok('--preset <name>')} ffmpeg preset: ultrafast/fast/medium (default: fast)\n`);
  console.log(dim('  Example with all options:'));
  console.log(`     ${bold('adblitz --hooks ./hooks --ctas ./ctas --output ./ads --width 1080 --height 1920 --dry-run')}\n`);
  console.log(dim(`  Supported video formats: ${[...VIDEO_EXTS].join(', ')}`));
  console.log(dim(`  Requires ffmpeg installed (brew install ffmpeg on Mac)\n`));
  console.log(dim(`  Run ${bold('adblitz --help')} for full usage.\n`));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getVideos(dir, label) {
  if (!dir) return [];
  const abs = path.resolve(dir);

  // Check folder exists
  if (!fs.existsSync(abs)) {
    console.error(err(`\n✗ ${label} folder not found: ${abs}\n`));
    console.error(warn(`  How to fix:`));
    console.error(warn(`  • Make sure the folder exists: mkdir -p ${dir}`));
    console.error(warn(`  • Check for typos in the path`));
    console.error(warn(`  • Use a relative path (./hooks) or absolute path (/Users/you/hooks)\n`));
    process.exit(1);
  }

  // Check it's a directory
  if (!fs.statSync(abs).isDirectory()) {
    console.error(err(`\n✗ ${label} path is not a folder: ${abs}\n`));
    console.error(warn(`  This should point to a folder containing video files, not a single file.\n`));
    process.exit(1);
  }

  const allFiles = fs.readdirSync(abs).filter(f => !f.startsWith('.'));

  // Check for non-video files and warn
  const nonVideo = allFiles.filter(f => !VIDEO_EXTS.has(path.extname(f).toLowerCase()));
  if (nonVideo.length > 0) {
    console.log(warn(`\n⚠ Skipping ${nonVideo.length} non-video file(s) in ${label} folder:`));
    nonVideo.forEach(f => console.log(warn(`  • ${f}`)));
    console.log(dim(`  Supported formats: ${[...VIDEO_EXTS].join(', ')}`));
  }

  const videos = allFiles
    .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .sort()
    .map(f => ({ name: path.parse(f).name, path: path.join(abs, f) }));

  // Check folder has videos
  if (!videos.length) {
    console.error(err(`\n✗ No video files found in ${label} folder: ${abs}\n`));
    if (allFiles.length > 0) {
      console.error(warn(`  The folder has ${allFiles.length} file(s), but none are supported video formats.`));
      console.error(warn(`  Files found: ${allFiles.slice(0, 5).join(', ')}${allFiles.length > 5 ? '...' : ''}`));
    } else {
      console.error(warn(`  The folder is empty! Add some video clips to it first.`));
    }
    console.error(warn(`  Supported formats: ${[...VIDEO_EXTS].join(', ')}\n`));
    process.exit(1);
  }

  return videos;
}

function ensureDir(dir) {
  fs.mkdirSync(path.resolve(dir), { recursive: true });
}

function checkFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    console.error(err('\n✗ ffmpeg is not installed or not in your PATH.\n'));
    console.error(warn('  ffmpeg is required to combine video clips. Install it:\n'));
    console.error(warn('  Mac:     brew install ffmpeg'));
    console.error(warn('  Ubuntu:  sudo apt install ffmpeg'));
    console.error(warn('  Windows: choco install ffmpeg'));
    console.error(warn(`  Other:   https://ffmpeg.org/download.html\n`));
    process.exit(1);
  }
}

function runFfmpeg(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

// ── No-args detection ────────────────────────────────────────────────────────

if (process.argv.length <= 2) {
  showGettingStarted();
  process.exit(0);
}

// ── Main ─────────────────────────────────────────────────────────────────────

program
  .name('adblitz')
  .description('Bulk video ad generator — combine hooks, bodies & CTAs into every combination')
  .version(VERSION)
  .requiredOption('--hooks <dir>', 'Folder containing hook video clips')
  .requiredOption('--ctas <dir>', 'Folder containing CTA video clips')
  .option('--bodies <dir>', 'Folder containing body video clips (optional, for 3-part ads)')
  .option('--output <dir>', 'Output folder', './output')
  .option('--width <n>', 'Output width in pixels', '1080')
  .option('--height <n>', 'Output height in pixels', '1920')
  .option('--preset <name>', 'ffmpeg encoding preset', 'fast')
  .option('--dry-run', 'Preview combinations without rendering')
  .action(async (opts) => {
    console.log(title('\n🎬 AdBlitz — Bulk Video Ad Generator\n'));

    // Pre-flight validation
    if (!opts.dryRun) checkFfmpeg();

    const hooks = getVideos(opts.hooks, 'Hooks');
    const ctas = getVideos(opts.ctas, 'CTAs');
    const bodies = opts.bodies ? getVideos(opts.bodies, 'Bodies') : [];
    const outDir = path.resolve(opts.output);
    const w = parseInt(opts.width, 10);
    const h = parseInt(opts.height, 10);

    ensureDir(outDir);

    // Build combinations
    const combos = [];
    if (bodies.length) {
      for (const hook of hooks)
        for (const body of bodies)
          for (const cta of ctas)
            combos.push({ parts: [hook, body, cta], name: `${hook.name}_${body.name}_${cta.name}.mp4` });
    } else {
      for (const hook of hooks)
        for (const cta of ctas)
          combos.push({ parts: [hook, cta], name: `${hook.name}_${cta.name}.mp4` });
    }

    console.log(`  Hooks:  ${ok(hooks.length)} files`);
    if (bodies.length) console.log(`  Bodies: ${ok(bodies.length)} files`);
    console.log(`  CTAs:   ${ok(ctas.length)} files`);
    console.log(`  Output: ${bold(combos.length + ' combinations')} → ${outDir}`);
    console.log(`  Size:   ${w}×${h}\n`);

    // ── Dry run mode ───────────────────────────────────────────────────────
    if (opts.dryRun) {
      console.log(warn('  📋 Dry run — these files would be generated:\n'));
      combos.forEach((c, i) => {
        console.log(dim(`  ${String(i + 1).padStart(4)}. `) + c.name);
      });
      console.log(ok(`\n  ✓ ${combos.length} video(s) would be created.`));
      console.log(dim(`\n  Remove --dry-run to actually generate the videos.\n`));
      return;
    }

    // ── Render ─────────────────────────────────────────────────────────────
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

    for (let i = 0; i < combos.length; i++) {
      const combo = combos[i];
      const outPath = path.join(outDir, combo.name);
      bar.update(i, { current: combo.name });

      const n = combo.parts.length;
      const inputs = combo.parts.map(p => `-i "${p.path}"`).join(' ');
      const filters = combo.parts.map((_, idx) =>
        `[${idx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${idx}];` +
        `[${idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${idx}]`
      ).join(';');
      const concatIn = combo.parts.map((_, idx) => `[v${idx}][a${idx}]`).join('');
      const filter = `${filters};${concatIn}concat=n=${n}:v=1:a=1[outv][outa]`;

      const cmd = `ffmpeg -y ${inputs} -filter_complex "${filter}" -map "[outv]" -map "[outa]" -c:v libx264 -preset ${opts.preset} -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outPath}" 2>&1`;

      try {
        await runFfmpeg(cmd);
        success++;
      } catch (e) {
        failed++;
        errors.push({ name: combo.name, error: e.message.split('\n').slice(-3).join(' ') });
      }
    }

    bar.update(combos.length, { current: 'Done!' });
    bar.stop();

    // ── Results + tips ─────────────────────────────────────────────────────
    console.log('');
    if (success > 0) {
      console.log(ok(`  ✓ ${success} video(s) generated successfully!`));
    }
    if (failed > 0) {
      console.log(err(`  ✗ ${failed} failed:`));
      errors.forEach(e => console.log(err(`    • ${e.name}: ${e.error}`)));
    }

    // Helpful tips
    console.log(dim('\n  ─────────────────────────────────────────────'));
    console.log(ok(`\n  📁 Your files are in ${outDir}`));
    console.log(dim(`     Upload these to your ad platform (Meta Ads, TikTok, etc.)\n`));
    if (combos.length > 10) {
      console.log(dim(`  💡 Tip: Test a few variants first, then scale the winners.`));
    }
    console.log(dim(`  💡 Tip: Use --preset ultrafast for quicker renders (larger files).`));
    console.log(dim(`  💡 Tip: Use --dry-run to preview combinations before rendering.\n`));
  });

program.parse();
