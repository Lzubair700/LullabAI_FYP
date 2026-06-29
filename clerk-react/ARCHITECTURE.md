# LullabAI — FYP Demo Cheat Sheet
## "What does this file do?" — Full Explanation

---

## ONE-LINER FOR THE DEMO

> "LullabAI is an AI-powered children's bedtime story generator. The user enters a moral lesson, age, and duration. Our system uses a RAG-augmented LLM to write a story, then automatically generates a cinematic MP4 video — with AI-generated illustrations, real voice narration, and Ken Burns animations — evaluated by 9 automated metrics."

---

## THE CORE IDEA (Say This First)

The project has **3 main phases**:
1. **Story Generation** — LLM writes the story using RAG context and age-specific vocabulary
2. **Video Generation** — Python pipeline turns each sentence into an illustrated, narrated video clip
3. **Evaluation** — 9 metrics automatically measure quality (text + audio + video)

---

## FILE-BY-FILE EXPLANATION

---

### `src/pages/server.js` — The Brain of the Backend

This is the **Node.js Express server** running on port 5000. It is the central coordinator of the entire system. When the app starts, it does 4 things automatically:

1. **Starts the Python embedding server** (`embedding_server.py`) as a child process on port 5001
2. **Loads vocabulary banks** — reads 7 `.txt` files (one per age 2–8) containing approved words, phrases, and words to avoid
3. **Initializes the RAG vector store** — reads all past stories from `dataset.csv` and `generated_stories.csv`, embeds each one into a 768-dimensional vector using E5-Base-v2, and stores them in memory
4. **Starts listening** on port 5000

**Key API routes it handles:**

- `GET /api/get-story` — The main story generation route. It:
  - Searches the vector store for 3 similar past stories (RAG)
  - Builds a detailed prompt with vocabulary rules + RAG examples
  - Calls Claude 3 Haiku via OpenRouter API
  - Saves the story to CSV and splits it into a scene JSON file
  - Runs evaluation in the background (non-blocking)

- `POST /api/generate-video` — Receives a `storyId`, finds the matching scenes JSON file, and **spawns** `generate_video.py` as a Python subprocess

- `POST /api/agent-personalize` — AI Agent route. User says "add a dragon" → Claude rewrites the story → new video is generated

- `POST /api/generate-moral` — Suggests morals from the vector store (most common ones filtered by age), or asks Claude if the store is empty

**Why did we build the server in Node.js?**
Because the frontend (React) is also JavaScript, and Node.js handles async API calls and process spawning very cleanly. The heavy AI work is offloaded to Python scripts.

---

### `src/pages/Prompt.tsx` — The Input Form

This is what the user sees first (after logging in). It collects:
- **Moral** — A text input like "sharing is caring". Has a magic wand button that calls `/api/generate-moral` to suggest morals
- **Age** — A slider from 2 to 8. The selected age determines which vocabulary bank gets loaded
- **Duration** — Three cards: Short (20s), Medium (30s), Bedtime (40s)

When the user clicks "Generate Story", it navigates to `/load` and passes the three values via React Router state.

**Why these three inputs?** They are the minimum required to generate a story that is (a) morally appropriate, (b) linguistically age-appropriate, and (c) the right length.

---

### `src/pages/Load.tsx` — Loading Screen

A simple loading animation page. It immediately calls `/api/get-story` with the moral, age, and duration from the previous page. When the story is ready, it navigates to `/story`.

---

### `src/pages/Story.tsx` — The Story + Video Page

This is where the magic becomes visible. It does two things in sequence:

1. **Fetches the story** from the server and immediately triggers video generation
2. **Polls for the video** and displays it in an HTML5 `<video>` player with autoplay and a download button

After the video is ready, an **AI Agent panel** appears (the ✨ button). The user can type things like "make the character a girl" or "set it underwater". The agent:
- Calls `/api/agent-personalize` which rewrites the story
- Then calls `/api/generate-video` with the new story ID
- Updates the video on screen when done

The agent shows a two-step status bar: "Writing story → Generating video" so the user knows what's happening.

---

### `src/App.tsx` — The Router

Defines all 10 routes of the app:
`/` → Intro, `/prompt` → Prompt, `/load` → Load, `/story` → Story, `/feedback` → Feedback, plus Clerk auth pages (`/sign-in`, `/sign-up`, etc.)

Also wraps everything in a Clerk auth header — shows "Sign In" button if logged out, shows profile avatar if logged in.

---

### `py_scripts/generate_video.py` — The Video Factory

This is the most complex Python script. It is **spawned by the Node.js server** and runs independently. It reads the scenes JSON file and processes each scene one at a time (semaphore = 1 to avoid API rate limits).

**For each scene sentence, it does this:**

**Step 1 — Fetch Image + Audio in parallel:**
- Image: Tries **Stability AI SDXL** first. If out of credits → falls back to **Pollinations AI FLUX** (free). The prompt is: `"Whimsical colorful 2D storybook illustration for children, magical, soft lighting. [sentence]"`
- Audio: Calls **Rime Arcana TTS API** with the sentence text → gets back an MP3

**Step 2 — Upscale the image:**
- Tries **Real-ESRGAN** exe (GPU). If unavailable → falls back to **PIL Lanczos** (CPU). Both do 2× upscaling.
- Why upscale? Because the Ken Burns zoom needs more pixels than the display resolution, otherwise it looks blurry when zoomed in.

**Step 3 — Compose the video clip:**
- Runs FFmpeg with a `zoompan` filter — this creates the slow zoom (Ken Burns effect)
- `-shortest` flag cuts the video exactly when the narration ends
- Output: one `.mp4` per scene

**Step 4 — Stitch all clips together:**
- Writes a `concat.txt` file listing all scene clips
- Runs FFmpeg again with `-f concat` to join them into the final video
- Saves timing data for evaluation

**Why Python for video?** Because FFmpeg, Pillow, and aiohttp are all Python-native tools. The Node.js server just spawns it and waits for the exit code.

---

### `py_scripts/embedding_server.py` — The Embedding Microservice

A tiny Flask server (port 5001) that loads the **E5-Base-v2 sentence transformer model** and exposes a single `/embed` endpoint. It takes text and returns a 768-dimensional float vector.

The Node.js server calls this every time it needs to embed a moral or story for the RAG system. It prefers the fine-tuned local model (`fine_tuned_model/`) but falls back to the base `intfloat/e5-base-v2` from HuggingFace.

**Why a separate server?** Because you can't run Python ML models directly inside Node.js. The microservice pattern lets Node.js call it via a simple HTTP POST.

---

### `py_scripts/inference_llama.py` — The Local LLaMA Server

A Flask server (port 5002) that loads the **fine-tuned LLaMA 3.2 1B model** (either the merged model or the LoRA adapter) and exposes two endpoints:

1. `/generate` — Full story generation. Takes moral + age + duration → returns a story. This is an alternative to Claude Haiku for when you want fully local inference.

2. `/enrich_prompt` — Takes a simple story sentence and expands it into a detailed image generation prompt. For example: *"The bunny hopped into the forest"* → *"A fluffy white bunny hopping into a magical glowing forest, fireflies, dappled sunlight, whimsical 2D illustration, soft cinematic lighting"*. This was designed to improve image quality by giving the image model richer instructions.

The model uses **4-bit quantization** via Unsloth so it runs on consumer GPUs with limited VRAM.

---

### `py_scripts/finetune_llama.py` — The LLaMA Training Script

This script fine-tunes LLaMA 3.2 1B on our domain-specific children's stories using **QLoRA** (Quantized Low-Rank Adaptation). 

**How it works:**
1. Reads `generated_stories.csv` (172 stories with moral, age, duration, story text)
2. Formats each row as an instruct conversation (system + user + assistant)
3. Loads LLaMA 3.2 1B in 4-bit quantization
4. Applies LoRA adapters to the attention layers (rank=16, alpha=32)
5. Trains for 3 epochs using HuggingFace TRL's SFTTrainer
6. Saves the LoRA adapter weights (~50MB) to `lullabai_lora/`
7. Optionally merges the adapter back into the full model at 16-bit

**Why QLoRA?** Full fine-tuning of a 1B model requires ~16GB VRAM. QLoRA reduces this to ~4GB by quantizing the base model to 4-bit and only training small low-rank matrices (the LoRA adapters). This makes it possible on a consumer GPU.

---

### `py_scripts/finetune_flux_replicate.py` — The FLUX Style Training Script

This script fine-tunes the **FLUX image generation model** on our storybook-style images using Replicate's cloud GPU API.

**How it works:**
1. Crawls `output_videos/` and collects all generated scene images
2. Zips them into `training_data.zip`
3. Uploads to Replicate and triggers a LoRA training job (1000 steps)
4. Creates a style LoRA with trigger word `LULLABAI_STYLE`

**Why?** So that future image generation can use `LULLABAI_STYLE` in the prompt to get a consistent storybook art style across all scenes, instead of relying on just text descriptions.

---

### `py_scripts/evaluate_video.py` — The Video Quality Evaluator

This script reads the `evaluation_data.json` (auto-generated by `generate_video.py`) and computes 5 video-level metrics:

| Metric | What it checks |
|--------|----------------|
| **M5: AV Sync Error** | `|video_duration - audio_duration|` in seconds. Should be < 0.1s |
| **M6: Prompt Adherence** | Sends image + prompt to **Gemini 2.0 Flash** (multimodal). Returns a 0–1 score |
| **M7: Image Sharpness** | Compares edge-detection intensity before and after ESRGAN upscaling. Higher = sharper |
| **M8: Pipeline Latency** | Per-stage timing: how long image fetch, upscaling, and FFmpeg each took |
| **M9: Speaking Rate** | `(word_count / audio_duration) × 60` = WPM. Ideal for children: 120–150 WPM |

Can be run automatically (discovers the latest `evaluation_data.json`) or manually with a path argument.

---

### `vocab_bank/vocab_age_*.txt` — The Vocabulary Banks (7 files)

One file per age (2–8). Each file has sections:
- `# Nouns` — e.g., "cat, dog, bird, sun, tree"
- `# Verbs` — e.g., "run, play, jump, eat, hug"
- `# Adjectives` — e.g., "big, small, red, soft"
- `# Words to Avoid` — complex or adult words

The server reads these at startup and injects the relevant vocabulary into the LLM prompt. For **ages 2–3**, the restriction is extreme: only words with 1–4 letters, sentences of 3–6 words. For **ages 6–8**, the vocabulary is much richer.

**Why?** Because a story for a 2-year-old should not contain words like "magnificent" or "treacherous". This ensures genuine age-appropriateness.

---

### `generated_stories.csv` — The Learning Database

Every story ever generated by the app is saved here. Columns: `Moral, Age, Duration(sec), Story`.

This file serves two purposes:
1. **RAG source** — indexed into the vector store at startup, used to retrieve similar past stories as context
2. **Training data** — fed into `finetune_llama.py` to improve the local model

The more stories generated, the better the RAG retrieval gets. This is the "learning" component of the system.

---

### `story_scenes/` — Per-Story Scene JSON Files

When a story is generated, it is split sentence-by-sentence and saved as a JSON file like `story_1778750913693_ukd6ka.json`. Structure:

```json
{
  "story_id": "story_1778750913693_ukd6ka",
  "moral": "sharing is caring",
  "age": "5",
  "duration_sec": 30,
  "scenes": [
    { "scene_index": 0, "sentence": "Once upon a time...", "word_count": 5 },
    { "scene_index": 1, "sentence": "...", "word_count": 8 }
  ]
}
```

This file is the "contract" between the Node.js server and the Python video pipeline. The server creates it; the Python script reads it.

---

### `output_videos/` — Where Videos Live

```
output_videos/
├── story_xxx.mp4                  ← The final video (served to browser)
└── temp_story_xxx/
    ├── scene_0.jpg                ← Upscaled scene images
    ├── scene_0_original.jpg       ← Pre-ESRGAN originals (for evaluation)
    ├── scene_0.mp3                ← TTS audio per scene
    ├── scene_0.mp4                ← Individual scene clip
    └── evaluation_data.json       ← Input for evaluate_video.py
```

The final MP4 is served statically via Express: `app.use('/output_videos', express.static(...))`. The browser just points an `<video src="...">` tag at it.

---

### `evaluation_results.json` — Text Metrics Log

Every time a story is generated, 4 text-level metrics are computed and appended here:
- **Moral Accuracy** — cosine similarity between requested and extracted moral
- **Recall@3** — did the RAG system find the right kinds of stories?
- **Duration Error** — was the story the right length?
- **Story Similarity** — how close is the story to similar training examples?

---

## LIKELY EXAM/DEMO QUESTIONS & ANSWERS

**Q: Why did you use RAG?**
A: Without RAG, the LLM generates generic stories. With RAG, it sees 3 real examples of stories with the same moral → the output is more consistent, better-structured, and closer to the domain style. It also improves over time as more stories are generated.

**Q: Why fine-tune LLaMA instead of just using Claude?**
A: Fine-tuning gives us a local model that runs without internet or API costs. It's also specialized on our exact domain (children's stories), so it understands the tone, vocabulary level, and structure better than a general model. The QLoRA technique makes this affordable — we only train ~1% of the model's parameters.

**Q: Why use ESRGAN if FLUX already generates 1024px images?**
A: The Ken Burns zoom effect requires zooming INTO the image during the video. If the image is exactly 1024×1024 and you zoom in 1.5×, you're only using 683×683 pixels — which looks blurry. ESRGAN gives us 2048×2048, so even at 1.5× zoom we still have 1365×1365 pixels of crisp detail.

**Q: How does the AI Agent work?**
A: It's a simple two-step pipeline. The user's natural language request is sent to Claude with the original moral/age/duration + instructions to honor the request. Claude rewrites the story. Then we save the new story, split it into scenes, and run the full video pipeline again. The result is a brand new video reflecting the user's personalization.

**Q: How do you ensure age-appropriateness?**
A: Three mechanisms: (1) Age-specific vocabulary banks loaded from text files, (2) Strict sentence length rules injected into the LLM prompt, (3) RAG retrieval filtered by age ±2 years so examples are from the right age group.

**Q: What happens if Stability AI runs out of credits?**
A: The system automatically falls back to Pollinations AI, which uses the FLUX model for free. We add a random seed, 1–3 second random delays between requests, and linear backoff on 429 errors to handle rate limiting gracefully.

---

## ONE FINAL SUMMARY TO MEMORIZE

> **LullabAI** takes a moral, age, and duration → uses **RAG + Claude Haiku** to write an age-appropriate story → splits it into scenes → uses **FLUX** to illustrate each scene, **ESRGAN** to sharpen it, and **Rime TTS** to narrate it → **FFmpeg** assembles all clips into a video with Ken Burns zoom → **9 metrics** validate quality automatically. A local **fine-tuned LLaMA model** can replace Claude for fully offline inference. The **AI Agent** lets users personalize the story in natural language and regenerate the video on demand.
