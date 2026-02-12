# 🎬 AdBlitz

**Bulk video ad generator** — Combine hooks, bodies, and CTAs into every possible combination. Ready-to-upload MP4s for Meta ads.

Replaces tools like Sovran ($79–319/mo) with a free, internal CLI.

---

## Requirements

You need two things installed on your computer:

### 1. Node.js (v18+)
- Download from [nodejs.org](https://nodejs.org/) — pick the **LTS** version
- Or on Mac: `brew install node`

### 2. FFmpeg
- **Mac:** `brew install ffmpeg`
- **Windows:** Download from [ffmpeg.org](https://ffmpeg.org/download.html)
- **Linux:** `sudo apt install ffmpeg`

To check they're installed, open Terminal and run:
```bash
node --version    # should show v18 or higher
ffmpeg -version   # should show version info
```

---

## Install AdBlitz

```bash
npm install -g adblitz
```

> If you get a permission error on Mac, try: `sudo npm install -g adblitz`

---

## How to Use

### Step 1: Organize Your Video Files

Create folders for your clips:

```
my-campaign/
├── hooks/          ← Your hook videos go here
│   ├── hook-ugc-testimonial.mp4
│   ├── hook-problem-callout.mp4
│   └── hook-bold-statement.mp4
├── ctas/           ← Your CTA videos go here
│   ├── cta-shop-now.mp4
│   └── cta-limited-offer.mp4
└── output/         ← Generated ads appear here (created automatically)
```

**That's it!** Just drag your video files into the right folders.

### Step 2: Run AdBlitz

Open Terminal, `cd` into your campaign folder, and run:

```bash
adblitz --hooks ./hooks --ctas ./ctas --output ./output
```

This generates **every combination**. With 3 hooks × 2 CTAs = **6 ad videos**, auto-named like:
- `hook-ugc-testimonial_cta-shop-now.mp4`
- `hook-ugc-testimonial_cta-limited-offer.mp4`
- `hook-problem-callout_cta-shop-now.mp4`
- ... etc.

### Step 3: Upload to Meta Ads Manager

All videos are in the `output/` folder, ready to upload. 🎉

---

## 3-Part Ads (Hook + Body + CTA)

For longer ads with a body section in the middle:

```
my-campaign/
├── hooks/
├── bodies/         ← Body/middle section videos
│   ├── body-demo.mp4
│   └── body-features.mp4
├── ctas/
└── output/
```

```bash
adblitz --hooks ./hooks --bodies ./bodies --ctas ./ctas --output ./output
```

With 3 hooks × 2 bodies × 2 CTAs = **12 ad videos**.

---

## Options

| Flag | Description | Default |
|------|-------------|---------|
| `--hooks <dir>` | Folder with hook clips | *required* |
| `--ctas <dir>` | Folder with CTA clips | *required* |
| `--bodies <dir>` | Folder with body clips | *optional* |
| `--output <dir>` | Where to save output | `./output` |
| `--width <n>` | Output width (px) | `1080` |
| `--height <n>` | Output height (px) | `1920` |
| `--preset <name>` | Encoding speed (ultrafast/fast/medium) | `fast` |

### Common sizes
- **9:16 vertical (default):** `--width 1080 --height 1920`
- **1:1 square:** `--width 1080 --height 1080`
- **16:9 landscape:** `--width 1920 --height 1080`

---

## Example Workflow

```bash
# 1. Create your campaign folder
mkdir my-campaign && cd my-campaign
mkdir hooks ctas

# 2. Copy your video clips into the folders
# (drag and drop, or use cp/mv)

# 3. Generate all combinations
adblitz --hooks ./hooks --ctas ./ctas

# 4. Check the output folder
ls output/

# 5. Upload to Meta Ads Manager!
```

---

## Troubleshooting

**"ffmpeg is not installed"** → Install ffmpeg (see Requirements above)

**"No video files found"** → Make sure your videos are `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`, or `.m4v`

**Videos look stretched** → AdBlitz auto-scales and letterboxes to fit. All inputs are normalized to the same size.

**Permission error on install** → Try `sudo npm install -g adblitz`

---

## License

MIT — Free to use, modify, and share.
