# AI Bone Studio V0.1

A beginner-friendly browser editor for assembling AI-generated 2D character parts before skeletal rigging.

## Implemented

- Batch import PNG/WebP character parts
- Parts library with thumbnails
- Drag parts directly on an 800x650 assembly canvas
- Select, move and fine-tune X/Y
- Rotation and scale controls
- Z-order editing
- Editable pivot X/Y
- Visibility, lock, reset and delete
- Export a native `.project.json` assembly description
- Experimental `Spine draft JSON` export scaffold
- Responsive compact layout for smaller screens

## Important note about Spine export

The current Spine button exports a **draft/intermediate JSON scaffold**, not a guaranteed production-compatible Spine runtime asset. A real Spine exporter must be version-tested and must also produce/correlate image dimensions, atlas data, bones, slots, skins and animation structures. The native AI Bone Studio project format remains the source of truth.

## Run

```bash
cd apps/editor
npm install
npm run dev
```

Build:

```bash
npm run build
```

## V0.2 target

- Joint/bone creation mode
- Parent-child bone hierarchy
- Bind a part to a bone
- Bone manipulation moves child parts
- Visual bone overlay

## V0.3 target

- Timeline
- Transform keyframes
- Playback and looping
- Beginner animation presets such as idle breathing, blink and wave
