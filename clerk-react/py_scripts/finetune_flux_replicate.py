"""
Fine-tune a FLUX LoRA model using Replicate's API.
FLUX is a massive 12B parameter model. Fine-tuning it locally requires at least 24GB VRAM
(and typically an A100 80GB for good results). 
For an FYP, using a cloud GPU API like Replicate is the most cost-effective and reliable method.

Usage:
1. Zip your training images into `training_data.zip`
2. Get a Replicate API token from replicate.com
3. Run: python finetune_flux_replicate.py

Requirements:
pip install replicate python-dotenv
"""

import os
import zipfile
import replicate
from pathlib import Path

# --- CONFIGURATION ---
# The name of the LoRA model you want to create (e.g., your-username/lullabai-style)
DESTINATION_MODEL = "your-username/lullabai-flux-style"

# The trigger word that tells FLUX to use your specific style
TRIGGER_WORD = "LULLABAI_STYLE"

# Paths
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_VIDEOS_DIR = PROJECT_ROOT / "output_videos"
DATASET_ZIP = SCRIPT_DIR / "training_data.zip"


def prepare_dataset():
    """
    Extracts all images from the output_videos directory (where the story scenes are saved)
    and zips them up for training.
    """
    print("Preparing dataset from output_videos...")
    images_found = []
    
    # Walk through the output_videos directory and find all generated images
    for root, dirs, files in os.walk(OUTPUT_VIDEOS_DIR):
        for file in files:
            if file.lower().endswith(('.png', '.jpg', '.jpeg')):
                images_found.append(os.path.join(root, file))
                
    if not images_found:
        print(f"No images found in {OUTPUT_VIDEOS_DIR}. Generate some stories first!")
        return False
        
    print(f"Found {len(images_found)} images. Zipping them into {DATASET_ZIP}...")
    
    with zipfile.ZipFile(DATASET_ZIP, 'w') as zf:
        for i, img_path in enumerate(images_found):
            # Save flat into the zip
            ext = os.path.splitext(img_path)[1]
            zf.write(img_path, f"image_{i}{ext}")
            
    print(f"Dataset ready: {DATASET_ZIP} ({os.path.getsize(DATASET_ZIP) / (1024*1024):.2f} MB)")
    return True


def start_training():
    """Uploads the zip and starts the FLUX LoRA training job on Replicate."""
    
    # Check if REPLICATE_API_TOKEN is set
    # Try to load from .env
    try:
        from dotenv import load_dotenv
        load_dotenv(PROJECT_ROOT / ".env")
    except ImportError:
        pass

    api_token = os.environ.get("REPLICATE_API_TOKEN")
    if not api_token:
        print("\nERROR: REPLICATE_API_TOKEN environment variable not set.")
        print("Please sign up at https://replicate.com, add billing (it costs ~$1-3 to train),")
        print("and set your token in the .env file or terminal:\n")
        print("set REPLICATE_API_TOKEN=r8_your_token_here")
        return

    print("\nStarting FLUX LoRA fine-tuning on Replicate...")
    
    # Note: Using the official ostokmak/flux-lora-trainer or similar endpoint.
    # Replicate provides a dedicated endpoint for fine-tuning FLUX.
    
    with open(DATASET_ZIP, "rb") as file:
        training = replicate.trainings.create(
            version="ostris/flux-dev-lora-trainer:4ffd32160efd92e956d39c5338a9b8fbafca58e03f791f6d8011f3e20e8ea6fa",
            input={
                "input_images": file,
                "trigger_word": TRIGGER_WORD,
                "steps": 1000,           # Number of training steps (1000 is good for ~20-50 images)
                "learning_rate": 4e-4,   # Standard LR for FLUX LoRAs
                "batch_size": 1,
                "resolution": "512,768,1024", # Multi-resolution training
            },
            destination=DESTINATION_MODEL
        )

    print(f"\nTraining started successfully! Job ID: {training.id}")
    print(f"You can monitor the progress on Replicate's dashboard.")
    print(f"URL: https://replicate.com/trainings/{training.id}")
    
    print("\nOnce training is complete, you can use your LoRA via the Replicate API:")
    print("Example usage in Python:")
    print(f"""
import replicate
output = replicate.run(
    "{DESTINATION_MODEL}",
    input={{
        "prompt": "{TRIGGER_WORD} A magical glowing forest at twilight, whimsical children's book style",
        "num_inference_steps": 28,
        "guidance_scale": 7.5
    }}
)
print(output)
    """)

if __name__ == "__main__":
    success = prepare_dataset()
    if success:
        # start_training()
        print("\n[NOTE] Training execution is commented out to prevent accidental API charges.")
        print("To run the training, uncomment 'start_training()' at the bottom of this script.")
        print("You will need a Replicate API token (REPLICATE_API_TOKEN) to run it.")
