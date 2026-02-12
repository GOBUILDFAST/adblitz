# 🎬 AdBlitz

**Bulk video ad generator** — Combine hooks, bodies, CTAs (and any custom segments) into every possible combination. Ready-to-upload MP4s for Meta ads, TikTok, YouTube, etc.

Replaces tools like Sovran ($79–319/mo) with a free, open-source CLI.

---

## Requirements

### 1. Node.js (v18+)
- Download from [nodejs.org](https://nodejs.org/) — pick the **LTS** version
- Or on Mac: `brew install node`

### 2. FFmpeg
- **Mac:** `brew install ffmpeg`
- **Windows:** Download from [ffmpeg.org](https://ffmpeg.org/download.html)
- **Linux:** `sudo apt install ffmpeg`

### 3. Whisper (optional, for auto-captions)
- `pip install openai-whisper`

---

## Install

```bash
npm install -g adblitz
```

---

## Quick Start

```bash
# Create folders with your video clips
mkdir hooks ctas

# Add your video files to each folder, then:
adblitz --hooks ./hooks --ctas ./ctas

# Preview what would be generated (no rendering):
adblitz --hooks ./hooks --ctas ./ctas --dry-run
```

With 3 hooks × 2 CTAs = **6 ad videos**, automatically named like `hook-ugc_cta-shop-now.mp4`.

---

## 3-Part Ads (Hook + Body + CTA)

```bash
adblitz --hooks ./hooks --bodies ./bodies --ctas ./ctas
```

3 hooks × 2 bodies × 2 CTAs = **12 ad videos**.

---

## 🆕 Custom Segments (v1.2)

Go beyond hook+body+cta. Define **any number of segments in any order**:

```bash
adblitz --segments hook:./hooks body1:./first-bodies body2:./second-bodies cta:./ctas
```

This creates a 4-part video for every combination: `hook × body1 × body2 × cta`.

You can name the segments anything:

```bash
adblitz --segments intro:./intros demo:./demos testimonial:./testimonials outro:./outros
```

---

## 🆕 Custom Naming (v1.2)

Control how output files are named with `--naming`:

```bash
# Default: {hook}_{cta}.mp4
adblitz --hooks ./hooks --ctas ./ctas

# Custom template:
adblitz --hooks ./hooks --ctas ./ctas --naming "{index}_{hook}-x-{cta}_{date}"
# → 0001_hook-ugc-x-cta-shop_2026-02-12.mp4

# With custom segments:
adblitz --segments intro:./intros cta:./ctas --naming "{intro}_{cta}_{date}"
```

**Template variables:**
| Variable | Description |
|----------|-------------|
| `{hook}`, `{body}`, `{cta}` | Filename of that segment (without extension) |
| `{any-label}` | Works with custom segment labels too |
| `{index}` | Combo number (zero-padded: 0001, 0002...) |
| `{date}` | Today's date (YYYY-MM-DD) |
| `{0}`, `{1}`, `{2}` | Segment by position |

---

## 🆕 Background Music (v1.2)

Add music to your generated videos:

```bash
# Single track — applied to all combos:
adblitz --hooks ./hooks --ctas ./ctas --music ./bgm/upbeat.mp3

# Folder of tracks — each combo gets one (round-robin):
adblitz --hooks ./hooks --ctas ./ctas --music ./music/

# Multiply combos × every track:
adblitz --hooks ./hooks --ctas ./ctas --music ./music/ --music-all
```

With `--music-all`, 6 video combos × 3 music tracks = **18 videos**.

Music is mixed at 30% volume so your original audio stays clear.

Supported formats: `.mp3`, `.wav`, `.aac`, `.m4a`, `.ogg`, `.flac`

---

## 🆕 Text Overlays (v1.2)

Burn text onto your videos (great for headlines, offers, CTAs):

```bash
# Single overlay:
adblitz --hooks ./hooks --ctas ./ctas --overlay "50% OFF TODAY"

# Multiple overlays (each becomes a variation):
adblitz --hooks ./hooks --ctas ./ctas --overlay "50% OFF" --overlay "FREE SHIPPING"

# Load from a file (one line per overlay):
adblitz --hooks ./hooks --ctas ./ctas --overlays headlines.txt
```

With overlays, 6 combos × 3 overlays = **18 videos** (each text variation).

**Overlay options:**

| Flag | Description | Default |
|------|-------------|---------|
| `--overlay-pos <pos>` | Position: `top`, `center`, `bottom` | `bottom` |
| `--overlay-size <n>` | Font size in pixels | `48` |
| `--overlay-color <color>` | Text color | `white` |

```bash
adblitz --hooks ./hooks --ctas ./ctas \
  --overlay "SHOP NOW" \
  --overlay-pos center --overlay-size 64 --overlay-color yellow
```

---

## 🆕 Thumbnails (v1.2)

Auto-extract a thumbnail image from each generated video:

```bash
adblitz --hooks ./hooks --ctas ./ctas --thumbnails

# Custom timestamp (default is first frame):
adblitz --hooks ./hooks --ctas ./ctas --thumbnails --thumb-time 2
```

Thumbnails are saved as `.jpg` in `output/thumbnails/`.

---

## 🆕 Auto Captions (v1.2)

Generate captions using OpenAI Whisper and burn them into the video:

```bash
adblitz --hooks ./hooks --ctas ./ctas --captions
```

**Requires:** `pip install openai-whisper` (runs locally, no API key needed).

Captions are burned directly onto the video with a clean white-on-black style.

---

## 🆕 Video Trimming (v1.2)

Trim segments to specific durations before combining:

```bash
# First 3 seconds of each hook:
adblitz --hooks ./hooks --ctas ./ctas --trim-hook 0-3

# Last 2 seconds of each CTA:
adblitz --hooks ./hooks --ctas ./ctas --trim-cta last2

# Just a duration (from start):
adblitz --hooks ./hooks --ctas ./ctas --trim-hook 3 --trim-body 5
```

**Trim formats:**
| Format | Meaning |
|--------|---------|
| `0-3` | From 0s to 3s |
| `2-5` | From 2s to 5s |
| `last3` | Last 3 seconds |
| `3` | First 3 seconds |

---

## All Options

| Flag | Description | Default |
|------|-------------|---------|
| `--hooks <dir>` | Folder with hook clips | — |
| `--ctas <dir>` | Folder with CTA clips | — |
| `--bodies <dir>` | Folder with body clips | — |
| `--segments <items...>` | Custom segments as `label:./path` pairs | — |
| `--output <dir>` | Output folder | `./output` |
| `--width <n>` | Output width (px) | `1080` |
| `--height <n>` | Output height (px) | `1920` |
| `--preset <name>` | Encoding speed | `fast` |
| `--dry-run` | Preview without rendering | — |
| `--naming <template>` | Custom naming template | auto |
| `--music <path>` | Background music file or folder | — |
| `--music-all` | Multiply combos × all tracks | — |
| `--overlay <text>` | Text overlay (repeatable) | — |
| `--overlays <file>` | Overlay texts from file | — |
| `--overlay-pos` | top / center / bottom | `bottom` |
| `--overlay-size` | Font size | `48` |
| `--overlay-color` | Text color | `white` |
| `--thumbnails` | Extract thumbnails | — |
| `--thumb-time <t>` | Thumbnail timestamp (seconds) | `0` |
| `--captions` | Auto-generate captions | — |
| `--trim-hook <spec>` | Trim hooks | — |
| `--trim-body <spec>` | Trim bodies | — |
| `--trim-cta <spec>` | Trim CTAs | — |

### Common sizes
- **9:16 vertical (default):** `--width 1080 --height 1920`
- **1:1 square:** `--width 1080 --height 1080`
- **16:9 landscape:** `--width 1920 --height 1080`

---

## Power User Example

```bash
adblitz \
  --segments hook:./hooks body:./bodies cta:./ctas \
  --naming "{index}_{hook}_{body}_{cta}_{date}" \
  --music ./music/ --music-all \
  --overlay "LIMITED TIME OFFER" --overlay "FREE SHIPPING" \
  --overlay-pos top --overlay-size 56 --overlay-color yellow \
  --thumbnails --thumb-time 1 \
  --trim-hook 0-3 --trim-cta last2 \
  --preset fast
```

---

## Troubleshooting

**"ffmpeg is not installed"** → Install ffmpeg (see Requirements above)

**"No video files found"** → Make sure your videos are `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, or `.m4v`

**"whisper not found"** → Install with `pip install openai-whisper` (only needed for `--captions`)

**Videos look stretched** → AdBlitz auto-scales and letterboxes. All inputs are normalized.

---

## License

MIT — Free to use, modify, and share.
