import pandas as pd
from sentence_transformers import SentenceTransformer, InputExample, losses
from torch.utils.data import DataLoader
import os
import csv

# Define paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.join(BASE_DIR, '../dataset.csv')
MODEL_OUTPUT_PATH = os.path.join(BASE_DIR, 'fine_tuned_model')
MODEL_NAME = 'intfloat/e5-base-v2' # Better accuracy as requested

def train():
    print(f"🔄 Loading dataset from {DATASET_PATH}...")
    
    # Check if dataset exists
    if not os.path.exists(DATASET_PATH):
        print(f"❌ Dataset not found at {DATASET_PATH}")
        return

    # Load dataset
    # Expecting columns: Moral, Story
    try:
        df = pd.read_csv(DATASET_PATH)
    except Exception as e:
        print(f"❌ Error reading CSV: {e}")
        return

    # Normalize column names
    df.columns = [c.strip().lower() for c in df.columns]
    
    if 'moral' not in df.columns or 'story' not in df.columns:
        print("❌ Dataset must contain 'Moral' and 'Story' columns")
        print(f"Found columns: {df.columns}")
        return

    print(f"✅ Loaded {len(df)} stories.")

    # Prepare training examples
    print("🔄 Preparing training pairs...")
    train_examples = []
    
    for i, row in df.iterrows():
        anchor = str(row['moral']).strip()
        positive = str(row['story']).strip()
        
        if not anchor or not positive:
            continue

        # 1. Positive Pair: Moral <-> Correct Story
        train_examples.append(InputExample(
            texts=[anchor, positive],
            label=1.0  # Highly similar
        ))
        
        # 2. Negative Pair: Moral <-> Random Story (Hard Negative)
        # We pick 1 random other story (as per user snippet, though 2 is fine, 1 matches snippet more closely)
        neg_row = df.sample(1).iloc[0]
        negative = str(neg_row['story']).strip()
        
        # Ensure we didn't accidentally pick the same story (basic check)
        if negative != positive:
            train_examples.append(InputExample(
                texts=[anchor, negative],
                label=0.0 # Dissimilar
            ))

    print(f"📊 Created {len(train_examples)} training pairs.")

    # Load Model
    print(f"⬇️  Loading base model: {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)

    # DataLoader
    train_dataloader = DataLoader(train_examples, batch_size=8, shuffle=True)

    # Loss Function
    # CosineSimilarityLoss is standard for semantic similarity tasks
    train_loss = losses.CosineSimilarityLoss(model)

    # Train
    print("🚀 Starting training (Fine-tuning)...")
    model.fit(
        train_objectives=[(train_dataloader, train_loss)],
        epochs=4,        # As requested
        warmup_steps=50, # As requested
        output_path=MODEL_OUTPUT_PATH,
        show_progress_bar=True
    )

    print(f"✅ Training complete! Model saved to {MODEL_OUTPUT_PATH}")

if __name__ == "__main__":
    train()
