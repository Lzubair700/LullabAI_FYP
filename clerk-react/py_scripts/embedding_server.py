from flask import Flask, request, jsonify
from sentence_transformers import SentenceTransformer
import os
import sys

# Configuration
PORT = 5001
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, 'fine_tuned_model')
BASE_MODEL_NAME = 'intfloat/e5-base-v2'

app = Flask(__name__)
model = None

def load_model():
    global model
    if os.path.exists(MODEL_PATH):
        print(f"✅ Loading FINE-TUNED model from {MODEL_PATH}...")
        model = SentenceTransformer(MODEL_PATH)
    else:
        print(f"⚠️ Fine-tuned model not found at {MODEL_PATH}.")
        print(f"⬇️  Loading BASE model {BASE_MODEL_NAME} as fallback...")
        model = SentenceTransformer(BASE_MODEL_NAME)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "model_loaded": model is not None})

@app.route('/embed', methods=['POST'])
def embed():
    if not model:
        return jsonify({"error": "Model not loaded"}), 500
        
    data = request.json
    text = data.get('text') or data.get('input')
    
    if not text:
        return jsonify({"error": "No text provided"}), 400

    try:
        # Generate embedding
        # encode returns numpy array, need to convert to list for JSON
        embedding = model.encode(text).tolist()
        return jsonify({
            "embedding": embedding,
            "dimensions": len(embedding)
        })
    except Exception as e:
        print(f"❌ Error generating embedding: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    load_model()
    print(f"🚀 Embedding Server running on port {PORT}")
    app.run(host='127.0.0.1', port=PORT)
