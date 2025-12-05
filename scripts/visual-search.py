#!/usr/bin/env python3
"""
Visual Search - Find similar catalog pages using CLIP embeddings
Usage: python3 visual-search.py <image_path_or_base64> [top_k]
"""

import os
import sys
import json
import base64
from io import BytesIO

# Suppress warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

def cosine_similarity(a, b):
    """Calculate cosine similarity between two vectors"""
    import numpy as np
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def load_image(image_input):
    """Load image from file path or base64 string"""
    from PIL import Image

    if image_input.startswith('data:image'):
        # Base64 data URL
        header, base64_data = image_input.split(',', 1)
        image_bytes = base64.b64decode(base64_data)
        return Image.open(BytesIO(image_bytes))
    elif image_input.startswith('/') or os.path.exists(image_input):
        # File path
        return Image.open(image_input)
    else:
        # Assume raw base64
        image_bytes = base64.b64decode(image_input)
        return Image.open(BytesIO(image_bytes))

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: visual-search.py <image_path_or_base64> [top_k] OR visual-search.py --stdin [top_k]"}))
        sys.exit(1)

    # Check if reading from stdin (for large base64 images to avoid E2BIG error)
    if sys.argv[1] == '--stdin':
        image_input = sys.stdin.read().strip()
        top_k = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    else:
        image_input = sys.argv[1]
        top_k = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    EMBEDDINGS_FILE = "/opt/flow-builder/data/visual-embeddings-db.json"

    # Check if embeddings exist
    if not os.path.exists(EMBEDDINGS_FILE):
        print(json.dumps({"error": "Visual embeddings database not found. Run generate-visual-embeddings.py first."}))
        sys.exit(1)

    try:
        # Load image
        from PIL import Image
        query_image = load_image(image_input)

        # Load CLIP model
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer('clip-ViT-B-32')

        # Generate embedding for query image
        query_image.thumbnail((800, 800), Image.Resampling.LANCZOS)
        query_embedding = model.encode(query_image)

        # Load embeddings database
        with open(EMBEDDINGS_FILE, 'r') as f:
            db = json.load(f)

        # Calculate similarities
        results = []
        for catalog in db['catalogs']:
            catalog_name = catalog['name']
            for page in catalog['pages']:
                similarity = cosine_similarity(query_embedding, page['embedding'])
                results.append({
                    'catalog': catalog_name,
                    'page_number': page['page_number'],
                    'image_path': page['image_path'],
                    'similarity': float(similarity),
                    'source_file': catalog['source_file']
                })

        # Sort by similarity (highest first)
        results.sort(key=lambda x: x['similarity'], reverse=True)

        # Return top K results
        top_results = results[:top_k]

        output = {
            "success": True,
            "query_type": "image",
            "total_pages_searched": len(results),
            "results": top_results
        }

        print(json.dumps(output, ensure_ascii=False))

    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
