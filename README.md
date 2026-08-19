# Refrigerant Archive

An interactive Three.js reconstruction of six vintage R-12 refrigerant cans.
The collection, single-can viewer, flat-label panel, and can-rain scene all use
one approved label treatment:

- **Fitted GPT:** one `gpt-image-2` multi-image edit per can, using only the
  approved lens-corrected cylindrical views. Cold Shot and Chargette are
  cropped to their recovered printed-label bounds before submission.

The earlier CV-assisted and direct multi-view experiments remain in the asset
archive for provenance, but they are no longer loaded or exposed by the viewer.

Every label uses the same smooth glossy `MeshStandardMaterial` with one albedo
texture—there are no label roughness, metalness, or bump maps. Each can also
has independent physical label bounds over its painted steel body: Sercon
Black is a full-height wrap, while Cold Shot and Chargette retain the exposed
white bands visible in the reference photography. The collection is ordered
and height-fitted to the source lineup in its cool-white studio environment.

The can-rain mode supports up to 420 bodies. Its `InstancedMesh` groups reuse
the collection models’ exact painted body, printed label shell, lathed
shoulder, rolled lower chime, gasket, cap geometry, and the same material
objects. Only the invisible Rapier collision body uses the high-count box
fallback.

The rain scene has no containment walls. Its only static collider is a broad
floor matching the visible studio plane, so cans can tumble outward and settle
into a naturally spreading pile. The rain camera can pull back far enough to
frame that full open pile.

## Run locally

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server. Drag to orbit, scroll to
zoom, switch among collection, single-can, and can-rain modes, inspect all six
Fitted GPT flat labels, or open
**Cylinder fits · 33**
to review every photograph before another reconstruction is attempted. This
project is intended to run locally and is not configured for a public
deployment.

## Per-photo cylinder review

The current reconstruction checkpoint treats every RAW photograph
independently. For each of the 33 views it develops the source, fits the
straight cylindrical body silhouette, projects a calibrated 15° cylinder grid
over the photograph, and produces a lens-corrected single-view unwrap. It does
not align or stitch views, normalize lighting, or call an image model.

Regenerate the review set with:

```bash
.work/texture-venv/bin/python scripts/generate_cylinder_review.py \
  "/path/to/photos/raw/refrigerants"
```

The outputs and fit metadata are written under
`public/assets/cylinder-review/`. The viewer groups them by can and exposes the
original/grid overlay, a grid-opacity control, the extracted frame, source
dimensions, body bounds, radius, and camera pitch. These approved fits are the
source set for the active Fitted GPT textures.

## Fitted multi-view labels

The active texture source sends each can's approved unwrapped views to
`gpt-image-2` in one independent high-quality edit request. Corrected Du Pont,
Interdynamics, Cold Shot, and Chargette runs use four distinct quarter-turn
views, excluding loop-closure and near-angle duplicates. The output canvas
for each can matches the physical circumference-to-label-height ratio of its
Three.js geometry. The generated image is mapped at 1×1 UV scale, without
resizing, padding, or stretching; every pixel-to-surface aspect error is below
0.3%. The exact prompt, input lists, crop bounds, output sizes, and asset paths
are recorded in
`output/imagegen/refrigerants-undistorted/generation-manifest.json`.

## CV-assisted reconstructions

Create a Python environment and install the texture dependencies:

```bash
python3 -m venv .venv-texture
source .venv-texture/bin/activate
pip install -r requirements-texture.txt
```

Reconstruct all five additional can series from the parent photo folder:

```bash
python scripts/reconstruct_refrigerants.py \
  "/path/to/photos/raw/refrigerants" \
  --series all
```

The script writes `label-source.webp` and `reconstruction.json` under
`public/assets/`. The metadata records the 50 mm calibration, 13.15° camera
pitch, recovered view rotation, measured body proportions, and perspective
cylindrical projection. The CV-assisted clean artwork pass is documented in
`output/imagegen/refrigerants/generation-manifest.json`.

## Direct multi-view labels

The second pass used all 33 full-resolution 2848×4256 JPEG views directly with
`gpt-image-2` at high quality. The exact prompt was:

> Take these different perspectives on a single can, and generate an albedo image of the label that could be used as a texture map.

Input lists, generated PNGs, and viewer asset paths are recorded in
`output/imagegen/refrigerants-direct/generation-manifest.json`.

## Verification

```bash
npm test
npm run lint
```

Browser rendering and interaction checks use Playwright against the local
development server.

## GitHub Pages

Pushes to `main` build and publish the static, single-route viewer at the
repository's GitHub Pages URL. The Pages build adds the project subpath without
changing local development URLs.
