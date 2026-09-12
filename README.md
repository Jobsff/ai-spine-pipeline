# AI Spine Pipeline

AI-assisted production pipeline for generating and preparing 2D character parts for Spine skeletal animation.

## Goal

Reduce manual art work in the traditional Spine workflow by using image-generation models for character design, part separation and occluded-area reconstruction, while keeping deterministic engineering steps in scripts.

## Pipeline

1. Character turnaround / design sheet
2. Define an animation-oriented parts specification
3. Generate a parts sheet using a high-contrast chroma-key background when reliable alpha output is unavailable
4. Chroma-key extraction and edge despill
5. Detect and crop independent parts
6. Export RGBA PNG parts with padding
7. Record source coordinates and metadata in `manifest.json`
8. Assemble slots, bones, meshes and weights in Spine
9. Let Spine Texture Packer build the final runtime atlas

## Current experiment

The first experiment uses a two-head-tall chibi female mage. We validated a modular head system with a clean face base, layered hair, independent eyebrows, open/closed eyes and interchangeable mouth shapes.

## Repository layout

```text
ai-spine-pipeline/
├── README.md
├── docs/
│   ├── workflow.md
│   └── asset-spec.md
├── scripts/
│   └── extract_chroma_parts.py
├── examples/
│   └── mage_head/
│       └── manifest.example.json
└── requirements.txt
```

## Design principle

Generative AI handles visual inference and reconstruction. Scripts handle deterministic operations such as alpha extraction, cropping, naming, padding and metadata. Spine handles rigging and final atlas packing.
