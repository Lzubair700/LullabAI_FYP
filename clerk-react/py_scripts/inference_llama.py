"""
Inference server for the fine-tuned LullabAI LLaMA model.
Exposes a simple HTTP POST endpoint at http://127.0.0.1:5002/generate

The Node.js server.js will call this instead of OpenRouter once the LoRA
adapter has been trained.

Usage:
    python inference_llama.py

Requirements:
    pip install unsloth flask
"""

import os
import sys
import json
from pathlib import Path
from flask import Flask, request, jsonify

# ─── CONFIG ────────────────────────────────────────────────────────────────────

SCRIPT_DIR   = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
LORA_DIR     = PROJECT_ROOT / "lullabai_lora"
MERGED_DIR   = PROJECT_ROOT / "lullabai_merged"

# Use merged model if available, otherwise use LoRA adapter
if MERGED_DIR.exists() and any(MERGED_DIR.iterdir()):
    MODEL_PATH = str(MERGED_DIR)
    print(f"[Model] Using merged model: {MODEL_PATH}")
else:
    MODEL_PATH = str(LORA_DIR)
    print(f"[Model] Using LoRA adapter: {MODEL_PATH}")

MAX_NEW_TOKENS = 500
TEMPERATURE    = 0.7
TOP_P          = 0.9
PORT           = 5002

SYSTEM_PROMPT = (
    "You are LullabAI, a master storyteller for young children (ages 2-8). "
    "You write warm, engaging, age-appropriate bedtime stories with a clear moral lesson. "
    "Always end the story with the line: \"Moral: <moral lesson>\""
)

app   = Flask(__name__)
model = None
tokenizer = None


def load_model():
    global model, tokenizer

    try:
        from unsloth import FastLanguageModel
    except ImportError:
        print("[Error] Unsloth not installed. Run: pip install unsloth")
        sys.exit(1)

    print(f"[Model] Loading from {MODEL_PATH}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name     = MODEL_PATH,
        max_seq_length = 1024,
        load_in_4bit   = True,
        dtype          = None,
    )
    FastLanguageModel.for_inference(model)
    print("[Model] Ready!")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True, "model": MODEL_PATH})


@app.route("/generate", methods=["POST"])
def generate():
    """
    POST body (JSON):
    {
        "moral":    "sharing is caring",
        "age":      "5",
        "duration": "30"
    }

    Returns:
    {
        "story": "Once upon a time..."
    }
    """
    global model, tokenizer

    data     = request.get_json(force=True)
    moral    = data.get("moral",    "").strip()
    age      = data.get("age",      "5").strip()
    duration = data.get("duration", "30").strip()

    if not moral:
        return jsonify({"error": "Missing 'moral' field"}), 400

    age_text      = f"age {age}" if age else "ages 2-8"
    duration_text = f"{duration} seconds" if duration else "30 seconds"

    user_msg = (
        f"Write a children's bedtime story for a {age_text} child "
        f"that teaches the moral: \"{moral}\". "
        f"The story should be suitable for approximately {duration_text} of reading aloud."
    )

    messages = [
        {"role": "system",    "content": SYSTEM_PROMPT},
        {"role": "user",      "content": user_msg},
    ]

    inputs = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
    ).to(model.device)

    import torch
    with torch.no_grad():
        outputs = model.generate(
            input_ids  = inputs,
            max_new_tokens = MAX_NEW_TOKENS,
            temperature    = TEMPERATURE,
            top_p          = TOP_P,
            do_sample      = True,
        )

    story = tokenizer.decode(
        outputs[0][inputs.shape[1]:],
        skip_special_tokens=True,
    ).strip()

    return jsonify({"story": story})


@app.route("/enrich_prompt", methods=["POST"])
def enrich_prompt():
    """
    POST body (JSON):
    {
        "sentence": "The little bear walked into the magical forest."
    }

    Returns:
    {
        "enriched_prompt": "A magical glowing forest at twilight, a cute little brown bear walking on a mossy path, fireflies, whimsical 2D storybook illustration, soft cinematic lighting, highly detailed, colorful."
    }
    """
    global model, tokenizer

    data = request.get_json(force=True)
    sentence = data.get("sentence", "").strip()

    if not sentence:
        return jsonify({"error": "Missing 'sentence' field"}), 400

    system_prompt = (
        "You are an expert prompt engineer for AI image generators like FLUX and Midjourney. "
        "Your job is to take a simple sentence and expand it into a highly detailed, "
        "beautiful, and visual prompt. Focus on lighting, colors, composition, and magical atmosphere. "
        "Keep the output under 50 words, using comma-separated keywords."
    )

    user_msg = f"Enhance this sentence into a visual image prompt:\n\nSentence: \"{sentence}\""

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_msg},
    ]

    inputs = tokenizer.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
    ).to(model.device)

    import torch
    with torch.no_grad():
        outputs = model.generate(
            input_ids      = inputs,
            max_new_tokens = 100,
            temperature    = 0.7,
            top_p          = 0.9,
            do_sample      = True,
        )

    enriched = tokenizer.decode(
        outputs[0][inputs.shape[1]:],
        skip_special_tokens=True,
    ).strip()

    # Sometimes the model might prefix with "Here is the prompt:". Let's strip quotes/prefixes safely if needed,
    # but since it's an instruct model, the system prompt usually keeps it direct.
    
    return jsonify({"enriched_prompt": enriched})


if __name__ == "__main__":
    load_model()
    print(f"[Server] LullabAI inference server running on http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
