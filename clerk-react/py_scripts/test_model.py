from sentence_transformers import SentenceTransformer, util
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'fine_tuned_model')

def test():
    if not os.path.exists(MODEL_PATH):
        print(f"❌ Model path not found: {MODEL_PATH}")
        return

    print(f"Loading model from {MODEL_PATH}...")
    model = SentenceTransformer(MODEL_PATH)

    # Test cases
    pairs = [
        ("Honesty is the best policy", "The Emperor"), # Should be high
        ("Honesty is the best policy", "The Little Girl"), # Should be low
        ("Kindness is a good virtue", "The Little Girl"), # Should be high
    ]

    print("\n--- Similarity Checks ---")
    for moral, story_title in pairs:
        # We need actual story text ideally, but we'll just query the moral vs "Story title" as a proxy if we don't have text loaded
        # Or better, let's just compare two texts directly
        pass

    # Better test matches
    queries = ["Honesty is the best policy", "Kindness is a good virtue"]
    sentences = [
        "Once there was an Emperor who loved fancy clothes... Honest is the policy.", # The Emperor
        "A poor little girl lights her matches... Kindness is a good virtue." # The Little Girl
    ]
    
    encoded_queries = model.encode(queries)
    encoded_sentences = model.encode(sentences)

    scores = util.cos_sim(encoded_queries, encoded_sentences)

    print(f"Similarity matrix:\n{scores}")

    # Check diagonals (correct matches)
    print(f"Honesty <-> Emperor: {scores[0][0]:.4f}")
    print(f"Honesty <-> Little Girl: {scores[0][1]:.4f}")
    
    print(f"Kindness <-> Emperor: {scores[1][0]:.4f}")
    print(f"Kindness <-> Little Girl: {scores[1][1]:.4f}")

if __name__ == "__main__":
    test()
