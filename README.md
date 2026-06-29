# LullabAI — Final Year Project

**Type a moral. Get a movie.**

LullabAI is an AI-powered platform that generates personalized, narrated storybook videos for children. Parents choose a moral, age group, and story length — the system produces a fully illustrated, cinematic bedtime story video from scratch.

---

## Features

- **Personalized story generation** — RAG-backed LLM pipeline grounded on a curated story dataset
- **Illustrated video output** — AI image generation, neural text-to-speech, upscaling, and FFmpeg video assembly
- **User authentication** — Clerk-based sign-in and sign-up
- **Feedback & evaluation** — User feedback collection and multi-metric quality evaluation
- **Async pipeline** — Concurrent scene generation with fallback chains for reliability

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, TypeScript, Vite, React Router |
| Backend API | Node.js, Express |
| ML / Video | Python, Flask, Sentence Transformers, FFmpeg, Real-ESRGAN |
| Auth | Clerk |
| AI Services | OpenRouter, OpenAI, Google Gemini, Rime TTS |

---

## Project Structure

```
LullabAI_FYP/
├── clerk-react/                 # Main application
│   ├── src/
│   │   ├── pages/               # React pages + Express API (server.js)
│   │   ├── components/
│   │   └── styles/
│   ├── py_scripts/              # Python ML & video generation scripts
│   │   ├── generate_video.py    # Video assembly pipeline
│   │   ├── embedding_server.py  # Local RAG embedding server
│   │   └── ...
│   ├── package.json
│   └── .env                     # API keys (create locally — not in repo)
├── server.js                    # Optional legacy feedback/data server
└── README.md
```

---

## Prerequisites

- **Node.js** 18 or later — [nodejs.org](https://nodejs.org/)
- **Python** 3.11+ — [python.org](https://www.python.org/)
- **FFmpeg** — required for video generation (see setup below)
- **Git** — to clone the repository

### API Keys (required)

You will need accounts/keys for:

| Service | Purpose |
|---------|---------|
| [Clerk](https://clerk.com/) | User authentication |
| [OpenRouter](https://openrouter.ai/) | Story & image generation |
| [Rime](https://rime.ai/) | Text-to-speech narration |
| OpenAI / Google Gemini *(optional)* | Embeddings & fallbacks |

---

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/Lzubair700/LullabAI_FYP.git
cd LullabAI_FYP
```

### 2. Install frontend & API dependencies

```bash
cd clerk-react
npm install
```

### 3. Set up Python environment

```bash
# From clerk-react/
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

pip install flask sentence-transformers requests pillow
```

> Additional packages may be required for fine-tuning or evaluation scripts. Install as needed when running those scripts.

### 4. Install FFmpeg

FFmpeg is **not included** in this repository (file size exceeds GitHub limits).

**Windows**

1. Download FFmpeg from [ffmpeg.org/download.html](https://ffmpeg.org/download.html)
2. Place `ffmpeg.exe` in `clerk-react/py_scripts/`

**macOS**

```bash
brew install ffmpeg
```

**Linux**

```bash
sudo apt install ffmpeg
```

The video pipeline automatically uses `clerk-react/py_scripts/ffmpeg.exe` if present, otherwise falls back to `ffmpeg` on your system PATH.

### 5. Configure environment variables

Create `clerk-react/.env`:

```env
# Clerk (authentication)
VITE_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key

# API server URL
VITE_API_URL=http://localhost:5000

# Text-to-speech
VITE_RIME_API_KEY=your_rime_api_key

# Story & image generation
OPENROUTER_API_KEY=your_openrouter_api_key

# Optional fallbacks
OPENAI_API_KEY=your_openai_api_key
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_AI_API_KEY=your_google_ai_api_key
```

> **Never commit `.env` to Git.** It is already listed in `.gitignore`.

---

## Running the Application

Open **two terminals** inside `clerk-react/`:

**Terminal 1 — API server (port 5000)**

```bash
npm run server
```

**Terminal 2 — Frontend dev server (port 5173)**

```bash
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

### Development without Clerk

If `VITE_CLERK_PUBLISHABLE_KEY` is not set, the app runs in dev mode and bypasses Clerk authentication automatically.

---

## Optional: Root feedback server

A separate Express server at the project root handles feedback and dataset export:

```bash
# From project root
npm install
npm start
```

---

## How It Works

1. User selects a **moral**, **age group**, and **story duration**
2. The backend retrieves relevant context via **RAG** (embedding server + story dataset)
3. An LLM generates a multi-scene story script
4. For each scene, the pipeline concurrently:
   - Generates an illustration
   - Synthesizes narration audio
   - Upscales images (Real-ESRGAN)
5. **FFmpeg** assembles scenes into a final MP4 video
6. The user can watch, download, and submit feedback

---

## Evaluation

The project includes Python scripts for quantitative evaluation across metrics such as:

- Moral adherence (cosine similarity)
- Story quality (BERTScore)
- RAG retrieval accuracy (Recall@k)
- Audio-visual sync error
- Image quality benchmarks
- Narration speaking rate (tuned for ages 2–8)

See `clerk-react/py_scripts/run_all_evaluations.py` and `evaluate_video.py`.

---

## Team

Final Year Project — LullabAI

| | |
|---|---|
| **Repository** | [github.com/Lzubair700/LullabAI_FYP](https://github.com/Lzubair700/LullabAI_FYP) |

---

## License

This project was developed as a Final Year Project. Contact the authors for usage permissions.
