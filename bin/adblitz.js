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
const VERSION = '1.2.0';

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

  const allFiles = fs.readdirSync(abs).filter(f => !f.startsWith('.'));
  const nonVideo = allFiles.filter(f => !VIDEO_EXTS.has(path.extname(f).toLowerCase()));
  if (nonVideo.length > 0) {
    console.log(warn(`\n⚠ Skipping ${nonVideo.length} non-video file(s) in ${label}`));
  }

  const videos = allFiles
    .filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()))
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
    return [{ name: path.parse(abs).name, path: abs }];
  }
  const files = fs.readdirSync(abs)
    .filter(f => !f.startsWith('.') && AUDIO_EXTS.has(path.extname(f).toLowerCase()))
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
  // "0-3" means start at 0s, duration 3s
  // "last3" means last 3 seconds
  const lastMatch = trimStr.match(/^last(\d+(\.\d+)?)$/i);
  if (lastMatch) return { mode: 'last', seconds: parseFloat(lastMatch[1]) };
  const rangeMatch = trimStr.match(/^(\d+(\.\d+)?)-(\d+(\.\d+)?)$/);
  if (rangeMatch) {
    const start = parseFloat(rangeMatch[1]);
    const end = parseFloat(rangeMatch[3]);
    return { mode: 'range', start, duration: end - start };
  }
  // Just a number = duration from start
  const dur = parseFloat(trimStr);
  if (!isNaN(dur)) return { mode: 'range', start: 0, duration: dur };
  console.error(err(`\n✗ Invalid trim format: "${trimStr}". Use "0-3", "last3", or "3"\n`));
  process.exit(1);
}

function parseSegments(segArgs) {
  // Parse "label:./path" pairs
  const segments = [];
  for (const seg of segArgs) {
    const colonIdx = seg.indexOf(':');
    if (colonIdx === -1) {
      console.error(err(`\n✗ Invalid segment format: "${seg}". Use label:./path\n`));
      process.exit(1);
    }
    const label = seg.substring(0, colonIdx);
    const dir = seg.substring(colonIdx + 1);
    const videos = getVideos(dir, label);
    segments.push({ label, videos });
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
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
      { encoding: 'utf-8' }
    ).trim();
    return parseFloat(result);
  } catch {
    return null;
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
    execSync('which whisper || where whisper', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function runFfmpeg(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
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
    // Also support --trim-<label> via remaining args... we'll handle the standard ones

    // ── Resolve music ──────────────────────────────────────────────────────
    const musicFiles = getAudioFiles(opts.music);

    // ── Resolve overlays ───────────────────────────────────────────────────
    const overlays = parseOverlays(opts.overlay, opts.overlays);

    // ── Pre-flight ─────────────────────────────────────────────────────────
    if (!opts.dryRun) checkFfmpeg();
    if (opts.captions && !opts.dryRun) {
      if (!checkWhisper()) {
        console.error(err('\n✗ whisper not found. Install: pip install openai-whisper\n'));
        process.exit(1);
      }
    }

    const outDir = path.resolve(opts.output);
    const w = parseInt(opts.width, 10);
    const h = parseInt(opts.height, 10);
    ensureDir(outDir);
    if (opts.thumbnails) ensureDir(path.join(outDir, 'thumbnails'));

    // ── Build combinations (cartesian product of all segments) ─────────
    const videoArrays = segments.map(s => s.videos);
    const cartCombos = cartesian(videoArrays);

    // Attach labels to each combo
    let combos = cartCombos.map(videos => ({
      parts: videos.map((v, i) => ({ label: segments[i].label, video: v }))
    }));

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
      // Assign random track to each combo
      combos = combos.map((combo, i) => ({
        ...combo,
        music: musicFiles[i % musicFiles.length]
      }));
    }

    // ── Generate names ─────────────────────────────────────────────────
    const defaultNaming = segments.map(s => `{${s.label}}`).join('_');
    const namingTemplate = opts.naming || defaultNaming;

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
      return { ...combo, name: name + '.mp4' };
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

    for (let i = 0; i < combos.length; i++) {
      const combo = combos[i];
      const outPath = path.join(outDir, combo.name);
      bar.update(i, { current: combo.name.substring(0, 50) });

      try {
        // Build the ffmpeg filter for concatenation
        const parts = combo.parts;
        const n = parts.length;
        const inputArgs = parts.map(p => `-i "${p.video.path}"`);
        let extraInputIdx = n;

        // Music input
        let musicInputIdx = -1;
        if (combo.music) {
          inputArgs.push(`-i "${combo.music.path}"`);
          musicInputIdx = extraInputIdx++;
        }

        const filterParts = [];
        const concatInputs = [];

        for (let idx = 0; idx < n; idx++) {
          const trim = trimMap[parts[idx].label];
          let vLabel = `v${idx}`;
          let aLabel = `a${idx}`;

          // Scale + pad
          filterParts.push(
            `[${idx}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[vs${idx}]`
          );
          filterParts.push(
            `[${idx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[as${idx}]`
          );

          // Apply trim if specified
          if (trim) {
            if (trim.mode === 'last') {
              const dur = getVideoDuration(parts[idx].video.path);
              if (dur) {
                const ss = Math.max(0, dur - trim.seconds);
                filterParts.push(`[vs${idx}]trim=start=${ss},setpts=PTS-STARTPTS[vt${idx}]`);
                filterParts.push(`[as${idx}]atrim=start=${ss},asetpts=PTS-STARTPTS[at${idx}]`);
                vLabel = `vt${idx}`;
                aLabel = `at${idx}`;
              } else {
                vLabel = `vs${idx}`;
                aLabel = `as${idx}`;
              }
            } else {
              filterParts.push(`[vs${idx}]trim=start=${trim.start}:duration=${trim.duration},setpts=PTS-STARTPTS[vt${idx}]`);
              filterParts.push(`[as${idx}]atrim=start=${trim.start}:duration=${trim.duration},asetpts=PTS-STARTPTS[at${idx}]`);
              vLabel = `vt${idx}`;
              aLabel = `at${idx}`;
            }
          } else {
            vLabel = `vs${idx}`;
            aLabel = `as${idx}`;
          }

          concatInputs.push(`[${vLabel}][${aLabel}]`);
        }

        filterParts.push(`${concatInputs.join('')}concat=n=${n}:v=1:a=1[concatv][concata]`);

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
          const escapedText = combo.overlayText.replace(/'/g, "'\\''").replace(/:/g, '\\:');
          filterParts.push(
            `[concatv]drawtext=text='${escapedText}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${yExpr}:borderw=2:bordercolor=black[overlayv]`
          );
          finalV = 'overlayv';
        }

        // Music mixing
        let finalA = 'concata';
        if (combo.music) {
          filterParts.push(
            `[${musicInputIdx}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=0.3[bgm];` +
            `[concata][bgm]amix=inputs=2:duration=first:dropout_transition=2[mixeda]`
          );
          finalA = 'mixeda';
        }

        const filterComplex = filterParts.join(';');
        const cmd = `ffmpeg -y ${inputArgs.join(' ')} -filter_complex "${filterComplex}" -map "[${finalV}]" -map "[${finalA}]" -c:v libx264 -preset ${opts.preset} -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outPath}" 2>&1`;

        await runFfmpeg(cmd);

        // ── Captions (post-process) ────────────────────────────────────
        if (opts.captions) {
          const srtPath = outPath.replace(/\.mp4$/, '.srt');
          const captionedPath = outPath.replace(/\.mp4$/, '_captioned.mp4');
          try {
            execSync(`whisper "${outPath}" --output_format srt --output_dir "${outDir}" 2>&1`, { encoding: 'utf-8' });
            // Find the generated srt (whisper names it after the input)
            const baseSrt = path.join(outDir, path.parse(combo.name).name + '.srt');
            if (fs.existsSync(baseSrt)) {
              const escapedSrt = baseSrt.replace(/'/g, "'\\''").replace(/:/g, '\\:');
              await runFfmpeg(
                `ffmpeg -y -i "${outPath}" -vf "subtitles='${escapedSrt}':force_style='FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2'" -c:a copy "${captionedPath}" 2>&1`
              );
              fs.renameSync(captionedPath, outPath);
              try { fs.unlinkSync(baseSrt); } catch {}
            }
          } catch (e) {
            // Captions failed, keep the video without them
          }
        }

        // ── Thumbnail ──────────────────────────────────────────────────
        if (opts.thumbnails) {
          const thumbPath = path.join(outDir, 'thumbnails', combo.name.replace(/\.mp4$/, '.jpg'));
          const thumbTime = opts.thumbTime || '0';
          try {
            await runFfmpeg(`ffmpeg -y -i "${outPath}" -ss ${thumbTime} -frames:v 1 -q:v 2 "${thumbPath}" 2>&1`);
          } catch {}
        }

        success++;
      } catch (e) {
        failed++;
        errors.push({ name: combo.name, error: e.message.split('\n').slice(-3).join(' ').substring(0, 200) });
      }
    }

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
