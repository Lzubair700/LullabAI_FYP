"""
Fine-tune LLaMA 3.2 (1B or 3B) on LullabAI children's stories
using QLoRA (4-bit) via the Unsloth library for fast, memory-efficient training.

Usage:
    python finetune_llama.py

Outputs:
    - lullabai_lora/  : LoRA adapter weights (small, ~50MB)
    - lullabai_merged/ : Full merged model (optional, larger)

Requirements (install first):
    pip install unsloth datasets transformers trl peft accelerate bitsandbytes pandas
"""

import os
import sys
import json
import pandas as pd
from pathlib import Path

# ─── CONFIG ────────────────────────────────────────────────────────────────────

# Base model — LLaMA 3.2 3B is ideal: small enough to train on consumer GPU/CPU,
# large enough to produce coherent stories.
# Options: "unsloth/Llama-3.2-1B-Instruct" (less RAM) or "unsloth/Llama-3.2-3B-Instruct"
BASE_MODEL = "unsloth/Llama-3.2-1B-Instruct"

# Paths
SCRIPT_DIR   = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
CSV_PATH     = PROJECT_ROOT / "generated_stories.csv"
OUTPUT_DIR   = PROJECT_ROOT / "lullabai_lora"
MERGED_DIR   = PROJECT_ROOT / "lullabai_merged"

# Training hyperparameters
MAX_SEQ_LEN    = 1024   # max tokens per example
LORA_RANK      = 16     # LoRA rank (higher = more capacity, more VRAM)
LORA_ALPHA     = 32
TRAIN_EPOCHS   = 3
BATCH_SIZE     = 2      # per-device batch size (lower if OOM)
GRAD_ACCUM     = 4      # effective batch = BATCH_SIZE * GRAD_ACCUM = 8
LEARNING_RATE  = 2e-4
WARMUP_RATIO   = 0.1

# ─── DATA PREPARATION ──────────────────────────────────────────────────────────

SYSTEM_PROMPT = (
    "You are LullabAI, a master storyteller for young children (ages 2-8). "
    "You write warm, engaging, age-appropriate bedtime stories with a clear moral lesson. "
    "Always end the story with the line: \"Moral: <moral lesson>\""
)

def build_prompt(moral: str, age: str, duration: str, story: str) -> str:
    """Convert a CSV row into an instruct-style prompt/response pair."""
    age_text      = f"age {age}" if age and str(age).strip() else "ages 2-8"
    duration_text = f"{duration} seconds" if duration and str(duration).strip() else "30 seconds"

    user_msg = (
        f"Write a children's bedtime story for a {age_text} child "
        f"that teaches the moral: \"{moral}\". "
        f"The story should be suitable for approximately {duration_text} of reading aloud."
    )
    assistant_msg = story.strip()

    return {
        "instruction": user_msg,
        "output": assistant_msg,
    }


def load_and_prepare_dataset(csv_path: Path):
    """Load the CSV and convert it to a HuggingFace Dataset."""
    from datasets import Dataset

    df = pd.read_csv(csv_path)

    # Normalise column names (case-insensitive)
    df.columns = [c.strip().lower() for c in df.columns]

    # Handle duration column name variants
    duration_col = next((c for c in df.columns if "duration" in c), None)
    moral_col    = next((c for c in df.columns if "moral"    in c), None)
    story_col    = next((c for c in df.columns if "story"    in c), None)
    age_col      = next((c for c in df.columns if "age"      in c), None)

    assert moral_col and story_col, "CSV must have 'moral' and 'story' columns"

    rows = []
    for _, row in df.iterrows():
        moral    = str(row.get(moral_col,    "")).strip()
        story    = str(row.get(story_col,    "")).strip()
        age      = str(row.get(age_col,      "")).strip() if age_col      else ""
        duration = str(row.get(duration_col, "")).strip() if duration_col else ""

        if not moral or not story or story == "nan":
            continue

        rows.append(build_prompt(moral, age, duration, story))

    print(f"[Data] Loaded {len(rows)} valid training examples from {csv_path.name}")
    return Dataset.from_list(rows)


# ─── FORMATTING ────────────────────────────────────────────────────────────────

def format_example(example, tokenizer):
    """Format a single example using the model's chat template."""
    messages = [
        {"role": "system",    "content": SYSTEM_PROMPT},
        {"role": "user",      "content": example["instruction"]},
        {"role": "assistant", "content": example["output"]},
    ]
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=False,
    )
    return {"text": text}


# ─── MAIN ──────────────────────────────────────────────────────────────────────

def main():
    # ── 1. Check CSV ──────────────────────────────────────────────────────────
    if not CSV_PATH.exists():
        print(f"[Error] CSV not found at: {CSV_PATH}")
        print("Generate some stories in the app first, then run this script.")
        sys.exit(1)

    # ── 2. Import Unsloth ─────────────────────────────────────────────────────
    try:
        from unsloth import FastLanguageModel
    except ImportError:
        print("[Error] Unsloth not installed.")
        print("Run: pip install unsloth")
        sys.exit(1)

    from trl import SFTTrainer, SFTConfig

    # ── 3. Load base model + LoRA ─────────────────────────────────────────────
    print(f"[Model] Loading {BASE_MODEL} with 4-bit quantization...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name      = BASE_MODEL,
        max_seq_length  = MAX_SEQ_LEN,
        load_in_4bit    = True,   # QLoRA — saves ~75% VRAM
        dtype           = None,   # auto-detect
    )

    # Apply LoRA adapters
    model = FastLanguageModel.get_peft_model(
        model,
        r                   = LORA_RANK,
        lora_alpha          = LORA_ALPHA,
        target_modules      = ["q_proj", "k_proj", "v_proj", "o_proj",
                               "gate_proj", "up_proj", "down_proj"],
        lora_dropout        = 0.05,
        bias                = "none",
        use_gradient_checkpointing = "unsloth",   # saves extra VRAM
        random_state        = 42,
    )

    print(f"[Model] Trainable parameters: "
          f"{sum(p.numel() for p in model.parameters() if p.requires_grad):,} / "
          f"{sum(p.numel() for p in model.parameters()):,}")

    # ── 4. Prepare Dataset ────────────────────────────────────────────────────
    raw_dataset = load_and_prepare_dataset(CSV_PATH)
    dataset     = raw_dataset.map(lambda ex: format_example(ex, tokenizer))

    # Train/validation split (90/10)
    split       = dataset.train_test_split(test_size=0.1, seed=42)
    train_ds    = split["train"]
    eval_ds     = split["test"]
    print(f"[Data] Train: {len(train_ds)} | Eval: {len(eval_ds)}")

    # ── 5. Train ──────────────────────────────────────────────────────────────
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    training_args = SFTConfig(
        output_dir                  = str(OUTPUT_DIR),
        num_train_epochs            = TRAIN_EPOCHS,
        per_device_train_batch_size = BATCH_SIZE,
        per_device_eval_batch_size  = BATCH_SIZE,
        gradient_accumulation_steps = GRAD_ACCUM,
        warmup_ratio                = WARMUP_RATIO,
        learning_rate               = LEARNING_RATE,
        fp16                        = False,   # use bf16 when available
        bf16                        = True,
        logging_steps               = 5,
        eval_strategy               = "epoch",
        save_strategy               = "epoch",
        load_best_model_at_end      = True,
        report_to                   = "none",  # set to "wandb" if you use W&B
        dataset_text_field          = "text",
        max_seq_length              = MAX_SEQ_LEN,
        packing                     = True,    # pack short sequences for efficiency
    )

    trainer = SFTTrainer(
        model           = model,
        tokenizer       = tokenizer,
        train_dataset   = train_ds,
        eval_dataset    = eval_ds,
        args            = training_args,
    )

    print("[Training] Starting fine-tuning...")
    trainer.train()

    # ── 6. Save LoRA adapter ──────────────────────────────────────────────────
    model.save_pretrained(str(OUTPUT_DIR))
    tokenizer.save_pretrained(str(OUTPUT_DIR))
    print(f"[Done] LoRA adapter saved to: {OUTPUT_DIR}")

    # ── 7. Optional: merge and save full model ─────────────────────────────────
    answer = input("\nMerge LoRA into full model and save? (y/n): ").strip().lower()
    if answer == "y":
        MERGED_DIR.mkdir(parents=True, exist_ok=True)
        print("[Merge] Merging weights... (this takes a few minutes)")
        model.save_pretrained_merged(
            str(MERGED_DIR),
            tokenizer,
            save_method="merged_16bit",
        )
        print(f"[Merge] Merged model saved to: {MERGED_DIR}")

    # ── 8. Quick inference test ────────────────────────────────────────────────
    print("\n[Test] Running quick inference test...")
    FastLanguageModel.for_inference(model)

    test_messages = [
        {"role": "system",    "content": SYSTEM_PROMPT},
        {"role": "user",      "content": "Write a children's bedtime story for a 5 year old child that teaches the moral: \"sharing is caring\". The story should be suitable for approximately 30 seconds of reading aloud."},
    ]
    inputs = tokenizer.apply_chat_template(
        test_messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
    ).to(model.device)

    import torch
    with torch.no_grad():
        outputs = model.generate(
            input_ids      = inputs,
            max_new_tokens = 300,
            temperature    = 0.7,
            top_p          = 0.9,
            do_sample      = True,
        )

    generated = tokenizer.decode(outputs[0][inputs.shape[1]:], skip_special_tokens=True)
    print("\n--- Generated Story ---")
    print(generated)
    print("--- End ---\n")

    print("[All done] Fine-tuning complete!")
    print(f"  LoRA adapter : {OUTPUT_DIR}")
    print(f"  To use in the app, see: py_scripts/inference_llama.py")


if __name__ == "__main__":
    main()
