# Asset Production Specification

## Core principle

The generated image is an animation source asset, not a presentation sheet. Engineering correctness takes priority over visual layout.

## Chroma background

For the current mage, use a flat high-saturation green that is distant from the character palette. The exact color should remain uniform across the entire canvas. Production tooling should eventually choose the chroma color dynamically based on the source character palette.

## Separation

- Every requested part must be spatially isolated.
- No labels, numbers, borders or UI.
- No staff, pet or VFX unless explicitly requested.
- Do not generate unrequested extra parts.

## Face system

`face_base` must contain no eyes, eyebrows, mouth or hair. Eyes, eyebrows and mouths are independent attachments.

## Joint overlap

Visible contours are not valid cut boundaries for moving joints. Generate hidden overlap under sleeves, skirts, hair and adjacent body parts. As a starting heuristic, provide roughly 15-25% additional hidden length around rotating joints and validate against the intended animation range.

## Alpha processing

After chroma extraction:

1. Create soft alpha from color distance.
2. Despill chroma contamination on transition pixels.
3. Preserve anti-aliased edges.
4. Crop to foreground bounds.
5. Add transparent padding.
6. Store original source-sheet coordinates in the manifest.

## Naming

Use semantic stable names for production assets, for example:

```text
face_base
hair_back
bangs
side_hair_L
side_hair_R
eyebrow_L
eyebrow_R
eye_L_open
eye_R_open
eye_L_closed
eye_R_closed
mouth_smile
```

The extraction prototype currently uses generic `part_XX` names because automatic semantic classification is a later pipeline stage.
