# LullabAI React Client

This Vite + React app powers the LullabAI experience: users enter a moral and duration, the backend uses an LLM to generate a personalized bedtime story, and the UI displays it with integrated text-to-speech narration.

## Getting Started

```bash
cd clerk-react
npm install
# Create .env file and add your keys (see below)
npm run dev
```

The frontend expects the story API to be available at `/api/get-story` (proxied by Vite during development).

## Environment Variables

Create a `.env` file in `clerk-react/` with the following keys:

```
VITE_CLERK_PUBLISHABLE_KEY=<your_clerk_publishable_key>
VITE_RIME_API_KEY=<your_rime_arcana_key>
OPENROUTER_API_KEY=<your_openrouter_api_key>
```

**Notes:**
- `VITE_RIME_API_KEY`: Frontend `.env` file - Get free key from [app.rime.ai](https://app.rime.ai/)
- `OPENROUTER_API_KEY`: Backend `.env` file - Get key from [OpenRouter](https://openrouter.ai/) for LLM story generation
- `USE_LLM_FOR_STORIES`: Set to `0` to disable LLM and use dataset lookup only (default: enabled)

## LLM-Based Story Generation

The app uses an LLM (via OpenRouter) to generate personalized bedtime stories:

1. **User Input**: User enters a moral (e.g., "Kindness is important") and duration (5, 20, or 40 seconds)
2. **LLM Generation**: Backend sends request to LLM API with:
   - System prompt describing the story style
   - Examples from `dataset.csv` for context
   - User prompt with the specific moral and duration
3. **Story Display**: Generated story is displayed on the webpage
4. **TTS Integration**: Text-to-speech works automatically on the generated story

### Dataset Usage

The `dataset.csv` file is used in two ways:
- **Context Examples**:** First 3 stories from dataset are sent to LLM as examples to guide the generation style
- **Fallback:** If LLM fails, the system falls back to dataset lookup

### Fine-Tuning (Optional)

To fine-tune an LLM model using your dataset:

1. **Prepare Dataset**: Your `dataset.csv` is already in the correct format
2. **Choose Platform**: Use platforms like:
   - [OpenAI Fine-tuning](https://platform.openai.com/docs/guides/fine-tuning)
   - [Hugging Face](https://huggingface.co/docs/transformers/training)
   - [Anthropic Claude](https://docs.anthropic.com/claude/docs/fine-tuning)
3. **Update Model**: After fine-tuning, update `MODEL` in `server.js` to use your fine-tuned model ID

## Rime Arcana Text-to-Speech

- The `Story` page now displays **Play Story Audio** controls once a story is generated.
- Voices default to `sirius`, but you can type any Arcana speaker (e.g. `luna`, `orion`, `celeste`).
- The UI streams MP3 audio directly from Arcana and lets you stop playback or download the narrated file.
- **Free tier:** 10,000 characters/month - perfect for FYP demos!

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build |
| `npm run server` | Run the Express proxy for story generation |
| `npm run lint` | Run ESLint |
