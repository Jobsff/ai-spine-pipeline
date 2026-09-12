# AI -> Spine Workflow

## 1. Character design

Create a stable turnaround before producing animation assets. For the current experiment this is a two-head-tall chibi female mage.

## 2. Define parts by animation responsibility

Do not simply cut along visible contours. A part should be separated when it needs independent motion, deformation, depth ordering, or attachment swapping.

For a modular head, a useful baseline is:

- `face_base`: skin/face shape only; no eyes, eyebrows, mouth or hair
- `hair_back`
- `bangs`
- `side_hair_L`
- `side_hair_R`
- `eyebrow_L`, `eyebrow_R`
- `eye_L_open`, `eye_R_open`
- `eye_L_closed`, `eye_R_closed`
- interchangeable mouth attachments

## 3. Generate an engineering parts sheet

Prefer a flat high-contrast chroma background when image editing does not reliably preserve alpha.

Requirements:

- one uniform background color
- no gradient, texture, checkerboard, cast shadow, text or labels
- parts do not touch each other
- consistent character identity, palette, rendering and scale
- hidden joint regions must be reconstructed, not merely cut at the visible boundary

## 4. Chroma extraction

`scripts/extract_chroma_parts.py` estimates the background from the image corners, creates a soft alpha mask, performs a basic green-spill reduction, finds connected foreground regions and exports cropped RGBA PNGs.

Example:

```bash
python scripts/extract_chroma_parts.py source.png build/mage_head --padding 8
```

## 5. Human/automated QA

Check:

- no residual chroma fringe
- no missing anti-aliased pixels
- no two intended parts merged into one crop
- no one intended part split into multiple crops
- reconstructed hidden areas provide sufficient overlap at joints
- left/right naming and depth ordering are correct

## 6. Spine assembly

Create bones, slots and attachments from the validated parts. Use attachment swaps for discrete facial states. Use meshes/weights where deformation is preferable to rigid rotation.

## 7. Runtime atlas

Do not ask the generative model to optimize the final runtime texture atlas. Once the rig is complete, use Spine Texture Packer for deterministic packing.
