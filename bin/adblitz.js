#!/usr/bin/env node

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { execSync, exec } = require('child_process');
const cliProgress = require('cli-progress');
const chalk = require('chalk');

// ── Helpers ──────────────────────────────────────────────────────────────────

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v']);

function getVideos(dir) {
  if (!dir) return [];
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs)) {
    console.error(chalk.red(`✗ Folder not found: ${abs}`));
    process.exit(1);
  }
  return fs.readdirSync(abs)
    .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
    .sort()
    .map(f => ({ name: path.parse(f).name, path: path.join(abs, f) }));
}

function ensureDir(dir) {
  fs.mkdirSync(path.resolve(dir), { recursive: true });
}

function checkFfmpeg() {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
  } catch {
    console.error(chalk.red('✗ ffmpeg is not installed or not in PATH.'));
    console.error(chalk.yellow('  Install it: https://ffmpeg.org/download.html'));
    console.error(chalk.yellow('  Mac: brew install ffmpeg'));
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

// ── Main ─────────────────────────────────────────────────────────────────────

program
  .name('adblitz')
  .description('Bulk video ad generator — combine hooks, bodies & CTAs into every combination')
  .version('1.0.0')
  .requiredOption('--hooks <dir>', 'Folder containing hook video clips')
  .requiredOption('--ctas <dir>', 'Folder containing CTA video clips')
  .option('--bodies <dir>', 'Folder containing body video clips (optional, for 3-part ads)')
  .option('--output <dir>', 'Output folder', './output')
  .option('--width <n>', 'Output width in pixels', '1080')
  .option('--height <n>', 'Output height in pixels', '1920')
  .option('--preset <name>', 'ffmpeg encoding preset', 'fast')
  .action(async (opts) => {
    checkFfmpeg();

    const hooks = getVideos(opts.hooks);
    const ctas = getVideos(opts.ctas);
    const bodies = opts.bodies ? getVideos(opts.bodies) : [];
    const outDir = path.resolve(opts.output);
    const w = parseInt(opts.width, 10);
    const h = parseInt(opts.height, 10);

    if (!hooks.length) { console.error(chalk.red('✗ No video files found in hooks folder.')); process.exit(1); }
    if (!ctas.length) { console.error(chalk.red('✗ No video files found in CTAs folder.')); process.exit(1); }

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

    console.log(chalk.bold.cyan('\n🎬 AdBlitz — Bulk Video Ad Generator\n'));
    console.log(`  Hooks:  ${chalk.green(hooks.length)} files`);
    if (bodies.length) console.log(`  Bodies: ${chalk.green(bodies.length)} files`);
    console.log(`  CTAs:   ${chalk.green(ctas.length)} files`);
    console.log(`  Output: ${chalk.yellow(combos.length)} combinations → ${outDir}`);
    console.log(`  Size:   ${w}×${h}\n`);

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

      // Build ffmpeg filter: scale + pad each input, then concat
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
      } catch (err) {
        failed++;
        errors.push({ name: combo.name, error: err.message.split('\n').slice(-3).join(' ') });
      }
    }

    bar.update(combos.length, { current: 'Done!' });
    bar.stop();

    console.log(chalk.bold.green(`\n✓ ${success} videos generated successfully.`));
    if (failed) {
      console.log(chalk.red(`✗ ${failed} failed:`));
      errors.forEach(e => console.log(chalk.red(`  - ${e.name}: ${e.error}`)));
    }
    console.log(chalk.gray(`\nOutput: ${outDir}\n`));
  });

program.parse();
