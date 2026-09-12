#!/usr/bin/env python3
"""Extract separated character assets from an AI-generated chroma-key parts sheet.

This is the first production experiment for the AI -> Spine pipeline.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def estimate_background(rgb: np.ndarray, sample: int = 40) -> np.ndarray:
    corners = np.vstack(
        [
            rgb[:sample, :sample].reshape(-1, 3),
            rgb[:sample, -sample:].reshape(-1, 3),
            rgb[-sample:, :sample].reshape(-1, 3),
            rgb[-sample:, -sample:].reshape(-1, 3),
        ]
    )
    return np.median(corners, axis=0)


def chroma_alpha(rgb: np.ndarray, bg: np.ndarray, inner: float = 18, outer: float = 65) -> np.ndarray:
    distance = np.sqrt(((rgb.astype(np.float32) - bg) ** 2).sum(axis=2))
    return np.clip((distance - inner) / (outer - inner) * 255.0, 0, 255).astype(np.uint8)


def despill(rgba: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    out = rgba.copy()
    edge = (alpha > 0) & (alpha < 255)
    rb_max = np.maximum(out[:, :, 0], out[:, :, 2])
    out[:, :, 1][edge] = np.minimum(out[:, :, 1][edge], rb_max[edge])
    out[:, :, 3] = alpha
    return out


def connected_boxes(mask: np.ndarray, min_area: int = 500) -> list[tuple[int, int, int, int]]:
    h, w = mask.shape
    seen = np.zeros_like(mask, dtype=bool)
    boxes = []

    for y in range(h):
        for x in range(w):
            if not mask[y, x] or seen[y, x]:
                continue
            stack = [(x, y)]
            seen[y, x] = True
            xs, ys = [], []
            while stack:
                xx, yy = stack.pop()
                xs.append(xx)
                ys.append(yy)
                for nx, ny in ((xx + 1, yy), (xx - 1, yy), (xx, yy + 1), (xx, yy - 1)):
                    if 0 <= nx < w and 0 <= ny < h and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((nx, ny))
            x0, y0, x1, y1 = min(xs), min(ys), max(xs) + 1, max(ys) + 1
            if (x1 - x0) * (y1 - y0) >= min_area:
                boxes.append((x0, y0, x1, y1))

    boxes.sort(key=lambda b: (b[1] // 120, b[0]))
    return boxes


def extract(source: Path, output: Path, padding: int = 8) -> None:
    output.mkdir(parents=True, exist_ok=True)
    parts_dir = output / "parts"
    parts_dir.mkdir(exist_ok=True)

    image = Image.open(source).convert("RGBA")
    rgba = np.array(image)
    rgb = rgba[:, :, :3]
    bg = estimate_background(rgb)
    alpha = chroma_alpha(rgb, bg)
    cleaned = despill(rgba, alpha)
    result = Image.fromarray(cleaned, "RGBA")

    mask = alpha > 35
    closed = Image.fromarray((mask * 255).astype(np.uint8))
    closed = closed.filter(ImageFilter.MaxFilter(11)).filter(ImageFilter.MinFilter(11))
    boxes = connected_boxes(np.array(closed) > 0)

    manifest = {
        "source": source.name,
        "background_rgb": [int(v) for v in bg],
        "parts": [],
    }

    for index, (x0, y0, x1, y1) in enumerate(boxes, start=1):
        region_alpha = alpha[y0:y1, x0:x1]
        yy, xx = np.where(region_alpha > 20)
        if len(xx) == 0:
            continue

        left = max(0, x0 + int(xx.min()) - padding)
        top = max(0, y0 + int(yy.min()) - padding)
        right = min(image.width, x0 + int(xx.max()) + 1 + padding)
        bottom = min(image.height, y0 + int(yy.max()) + 1 + padding)

        name = f"part_{index:02d}"
        crop = result.crop((left, top, right, bottom))
        crop.save(parts_dir / f"{name}.png")
        manifest["parts"].append(
            {
                "name": name,
                "file": f"parts/{name}.png",
                "source_bbox": [left, top, right, bottom],
                "width": crop.width,
                "height": crop.height,
            }
        )

    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Exported {len(manifest['parts'])} parts to {output}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Chroma-key PNG parts sheet")
    parser.add_argument("output", type=Path, help="Output directory")
    parser.add_argument("--padding", type=int, default=8)
    args = parser.parse_args()
    extract(args.source, args.output, args.padding)


if __name__ == "__main__":
    main()
