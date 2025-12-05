#!/usr/bin/env python3
"""
Visual Embeddings Generator for Catalog Images
Uses CLIP model to create embeddings that work for both images and text queries
"""

import os
import sys
import json
import glob
from pathlib import Path
from datetime import datetime

# Suppress warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3'

def main():
    print("=" * 60)
    print("VISUAL EMBEDDINGS GENERATOR")
    print("=" * 60)

    # Import libraries
    print("\n[1/5] Loading libraries...")
    try:
        from pdf2image import convert_from_path
        from PIL import Image
        from sentence_transformers import SentenceTransformer
        import numpy as np
        print("  ✓ Libraries loaded successfully")
    except ImportError as e:
        print(f"  ✗ Error: {e}")
        print("  Run: pip3 install --break-system-packages sentence-transformers Pillow pdf2image")
        sys.exit(1)

    # Configuration
    KNOWLEDGE_BASE = "/opt/flow-builder/data/knowledge-base"
    OUTPUT_DIR = "/opt/flow-builder/data/catalog-images"
    EMBEDDINGS_FILE = "/opt/flow-builder/data/visual-embeddings-db.json"

    # Create output directory
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Load CLIP model
    print("\n[2/5] Loading CLIP model (this may take a minute)...")
    try:
        # Use clip-ViT-B-32 which works well for product images
        model = SentenceTransformer('clip-ViT-B-32')
        print("  ✓ CLIP model loaded")
    except Exception as e:
        print(f"  ✗ Error loading model: {e}")
        sys.exit(1)

    # Find PDF catalogs
    print("\n[3/5] Finding PDF catalogs...")
    pdf_files = glob.glob(os.path.join(KNOWLEDGE_BASE, "*.pdf"))
    print(f"  Found {len(pdf_files)} PDF files:")
    for pdf in pdf_files:
        print(f"    - {os.path.basename(pdf)}")

    # Process each PDF
    print("\n[4/5] Extracting pages and generating embeddings...")
    all_embeddings = {
        "version": "1.0",
        "model": "clip-ViT-B-32",
        "created": datetime.now().isoformat(),
        "catalogs": []
    }

    for pdf_path in pdf_files:
        pdf_name = os.path.basename(pdf_path)
        catalog_name = pdf_name.split("-", 1)[1].replace(".pdf", "") if "-" in pdf_name else pdf_name.replace(".pdf", "")

        print(f"\n  Processing: {catalog_name[:50]}...")

        # Create catalog subdirectory
        catalog_dir = os.path.join(OUTPUT_DIR, pdf_name.replace(".pdf", ""))
        os.makedirs(catalog_dir, exist_ok=True)

        catalog_data = {
            "name": catalog_name,
            "source_file": pdf_name,
            "pages": []
        }

        try:
            # Convert PDF pages to images (lower DPI for speed, we can increase later)
            print(f"    Converting PDF to images (DPI=150)...")
            pages = convert_from_path(pdf_path, dpi=150, fmt='jpeg')
            print(f"    ✓ {len(pages)} pages extracted")

            # Process each page
            for page_num, page_image in enumerate(pages, 1):
                # Save image
                image_filename = f"page_{page_num:03d}.jpg"
                image_path = os.path.join(catalog_dir, image_filename)

                # Resize for CLIP (224x224 is optimal, but we keep aspect ratio)
                page_image.thumbnail((800, 800), Image.Resampling.LANCZOS)
                page_image.save(image_path, "JPEG", quality=85)

                # Generate embedding
                embedding = model.encode(page_image)

                # Store page data
                page_data = {
                    "page_number": page_num,
                    "image_path": image_path,
                    "embedding": embedding.tolist()  # Convert numpy to list for JSON
                }
                catalog_data["pages"].append(page_data)

                # Progress indicator
                if page_num % 10 == 0 or page_num == len(pages):
                    print(f"    Progress: {page_num}/{len(pages)} pages processed")

        except Exception as e:
            print(f"    ✗ Error processing {pdf_name}: {e}")
            continue

        all_embeddings["catalogs"].append(catalog_data)
        print(f"    ✓ Completed {catalog_name[:40]}...")

    # Save embeddings database
    print("\n[5/5] Saving embeddings database...")
    with open(EMBEDDINGS_FILE, 'w') as f:
        json.dump(all_embeddings, f)

    # Summary
    total_pages = sum(len(c["pages"]) for c in all_embeddings["catalogs"])
    file_size_mb = os.path.getsize(EMBEDDINGS_FILE) / (1024 * 1024)

    print("\n" + "=" * 60)
    print("COMPLETE!")
    print("=" * 60)
    print(f"  Catalogs processed: {len(all_embeddings['catalogs'])}")
    print(f"  Total pages: {total_pages}")
    print(f"  Embeddings file: {EMBEDDINGS_FILE}")
    print(f"  File size: {file_size_mb:.2f} MB")
    print(f"  Images saved to: {OUTPUT_DIR}")
    print("=" * 60)

if __name__ == "__main__":
    main()
