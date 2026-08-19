import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the six-can refrigerant archive", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Refrigerant Archive — Six Photo-fitted 3D Cans<\/title>/i);
  assert.match(html, /Photo-fitted study · Six archival objects/);
  assert.match(html, /thirty-three 50/);
  assert.match(html, /Collection/);
  assert.match(html, /Single can/);
  assert.match(html, /Can rain/);
  assert.match(html, /Cylinder fits · 33/);
  assert.match(html, /Flat labels/);
  assert.match(html, /Fitted GPT/);
  assert.doesNotMatch(html, /Cycle label texture source|CV-assisted|Direct GPT/);
  assert.match(html, /Cold Shot/);
  assert.match(html, /Chargette/);
  assert.match(html, /Du Pont Freon/);
  assert.match(html, /Interdynamics/);
  assert.match(html, /Sercon Black/);
  assert.match(html, /Sercon White/);
  assert.match(
    html,
    /Interactive three-dimensional collection of six vintage refrigerant cans/,
  );
  assert.doesNotMatch(html, /loading skeleton|Your site is taking shape|codex-preview/i);
});

test("publishes a review-only cylinder fit and unwrap for every source photograph", async () => {
  const [manifestText, panel, generator] = await Promise.all([
    readFile(
      new URL(
        "../public/assets/cylinder-review/manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../app/CylinderReviewPanel.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/generate_cylinder_review.py", import.meta.url),
      "utf8",
    ),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.total_frames, 33);
  assert.match(manifest.status, /review only/i);
  assert.match(manifest.status, /no cross-view reconstruction/i);
  assert.match(manifest.status, /no .*image-model call/i);
  assert.equal(manifest.camera_focal_length_pixels, 5980);
  assert.equal(manifest.camera_pitch_degrees, 13.1458);
  assert.deepEqual(manifest.grid.visible_longitude_degrees, [-78, 78]);
  assert.deepEqual(
    manifest.groups.map((group) => [group.slug, group.frame_count]),
    [
      ["sercon-1", 6],
      ["du-pont-freon", 6],
      ["interdynamics", 5],
      ["cold-shot", 5],
      ["chargette", 5],
      ["sercon-2", 6],
    ],
  );

  let frameCount = 0;
  for (const group of manifest.groups) {
    assert.equal(group.frames.length, group.frame_count);
    for (const frame of group.frames) {
      frameCount += 1;
      assert.deepEqual(frame.source_size, [2848, 4256]);
      assert.deepEqual(frame.photo_size, [1424, 2128]);
      assert.equal(frame.flat_size[0], 1440);
      assert.ok(frame.flat_size[1] > 1800);
      assert.deepEqual(frame.visible_longitude_degrees, [-78, 78]);
      assert.ok(frame.fit.top < frame.fit.bottom);
      assert.ok(frame.fit.radius_top > frame.fit.radius_bottom);

      for (const asset of [frame.photo, frame.grid, frame.flat]) {
        const assetUrl = new URL(`../public${asset}`, import.meta.url);
        await access(assetUrl);
        assert.ok((await stat(assetUrl)).size > 2_000);
      }
    }
  }
  assert.equal(frameCount, 33);

  assert.match(panel, /data-testid="cylinder-review-panel"/);
  assert.match(panel, /Cylinder grid opacity/);
  assert.match(panel, /Lens-corrected cylindrical unwrap/);
  assert.match(panel, /review-group-/);
  assert.match(generator, /detect_view_fit/);
  assert.match(generator, /projected_coordinates/);
  assert.match(generator, /flatten_view/);
  assert.doesNotMatch(generator, /OpenAI|gpt-image|imagegen/i);
});

test("uses measured can geometry, albedo-only labels, and instanced physics", async () => {
  const [models, viewer, rain, packageJson] = await Promise.all([
    readFile(new URL("../app/canModels.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/ColdShotViewer.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/canRain.ts", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.equal(models.match(/slug: "/g)?.length, 6);
  assert.match(models, /new THREE\.CylinderGeometry\(/);
  assert.match(models, /new THREE\.LatheGeometry\(/);
  assert.match(models, /createGlossyLabelMaterial/);
  assert.match(models, /undistortedTexture/);
  assert.match(
    models,
    /loader\.loadAsync\(\s*withBasePath\(definition\.undistortedTexture\)/,
  );
  assert.doesNotMatch(
    models,
    /loader\.loadAsync\(definition\.(?:restored|direct)Texture\)/,
  );
  assert.match(models, /map: texture/);
  assert.match(models, /labelTopInset: 0\.075/);
  assert.match(models, /labelTopInset: 0\.105/);
  assert.match(models, /directVRange: \[0\.035, 0\.91\]/);
  assert.match(models, /bodyBase/);
  assert.match(models, /polygonOffset: true/);
  assert.match(models, /polygonOffsetFactor: -1/);
  assert.doesNotMatch(models, /roughnessMap|bumpMap|metalnessMap/);
  assert.match(viewer, /new OrbitControls\(/);
  assert.match(viewer, /CAN_DEFINITIONS\.map/);
  assert.match(viewer, /const ACTIVE_LABEL_NAME = "Fitted GPT"/);
  assert.doesNotMatch(
    viewer,
    /LABEL_VARIANTS|labelVariant|Cycle label texture source|CV-assisted|Direct GPT/,
  );
  assert.match(rain, /new THREE\.InstancedMesh\(/);
  assert.match(rain, /parts\.bodyBase\.geometry/);
  assert.match(rain, /parts\.body\.geometry/);
  assert.match(rain, /parts\.shoulder\.geometry/);
  assert.match(rain, /materialFor\(parts\.shoulder\)/);
  assert.match(rain, /model\.sharedMaterials\.label/);
  assert.doesNotMatch(rain, /setLabelVariant/);
  assert.doesNotMatch(rain, /new THREE\.CylinderGeometry\(/);
  assert.match(rain, /RigidBodyDesc\.dynamic\(\)/);
  assert.match(rain, /ColliderDesc\.cuboid\(/);
  assert.match(rain, /ColliderDesc\.cuboid\(35\.5, 0\.5, 35\.5\)/);
  assert.doesNotMatch(rain, /fixedSurfaces|11\.85|7\.85/);
  assert.match(rain, /const MAX_CANS = 420/);
  assert.match(rain, /world\.timestep = 1 \/ 60/);
  assert.match(packageJson, /"@dimforge\/rapier3d-compat"/);
  assert.match(packageJson, /"three": "\^0\.185\.1"/);
  assert.match(viewer, /const RAIN_MAX_DISTANCE = 125/);
  assert.match(viewer, /type ViewerMode = "collection" \| "single" \| "rain"/);
  assert.match(viewer, /data-testid="single-can-controls"/);
  assert.match(viewer, /PerspectiveCamera\(33, 1, 0\.5, 260\)/);
});

test("records all three production texture sources", async () => {
  const expected = [
    ["cold-shot", 5, [4096, 2268], "label-print-albedo.webp", [2048, 1008]],
    ["chargette", 5, [3072, 1789], "label-restored.webp", [2064, 1008]],
    ["du-pont-freon", 6, [3072, 1701], "label-restored.webp", [2064, 1136]],
    ["interdynamics", 5, [3072, 1687], "label-restored.webp", [2048, 1088]],
    ["sercon-1", 6, [3072, 1721], "label-restored.webp", [2048, 1152]],
    ["sercon-2", 6, [3072, 1789], "label-restored.webp", [2064, 1184]],
  ];

  for (const [slug, frameCount, outputSize, restoredName] of expected) {
    const reconstruction = JSON.parse(
      await readFile(
        new URL(`../public/assets/${slug}/reconstruction.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(reconstruction.source_directory, slug);
    assert.equal(reconstruction.source_files.length, frameCount);
    assert.deepEqual(reconstruction.output_size, outputSize);
    assert.match(reconstruction.projection, /perspective projection/);
    await access(new URL(`../public/assets/${slug}/${restoredName}`, import.meta.url));
    await access(new URL(`../public/assets/${slug}/label-direct.webp`, import.meta.url));
    await access(
      new URL(`../public/assets/${slug}/label-undistorted.webp`, import.meta.url),
    );
  }

  const generation = JSON.parse(
    await readFile(
      new URL(
        "../output/imagegen/refrigerants/generation-manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(generation.model, "gpt-image-2");
  assert.equal(
    generation.prompt,
    "generate the original albedo image for this unwrapped label from a glossy can",
  );
  assert.equal(generation.outputs.length, 5);

  const directGeneration = JSON.parse(
    await readFile(
      new URL(
        "../output/imagegen/refrigerants-direct/generation-manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(directGeneration.model, "gpt-image-2");
  assert.equal(
    directGeneration.prompt,
    "Take these different perspectives on a single can, and generate an albedo image of the label that could be used as a texture map.",
  );
  assert.match(directGeneration.preprocessing, /no cropping.*CV analysis/i);
  assert.equal(directGeneration.outputs.length, 6);
  assert.deepEqual(
    directGeneration.outputs.map((output) => output.references.length),
    [5, 5, 6, 5, 6, 6],
  );

  const fittedGeneration = JSON.parse(
    await readFile(
      new URL(
        "../output/imagegen/refrigerants-undistorted/generation-manifest.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.equal(fittedGeneration.model, "gpt-image-2");
  assert.equal(fittedGeneration.quality, "high");
  assert.match(fittedGeneration.mode, /one request per can/);
  assert.match(fittedGeneration.prompt_template, /Remove reflections, dirt, and rust/);
  assert.match(fittedGeneration.aspect_policy, /without stretching or padding/);
  assert.match(fittedGeneration.deduplication_policy, /loop-closure/i);
  assert.equal(fittedGeneration.targeted_iterations.length, 4);
  assert.equal(fittedGeneration.outputs.length, 6);
  assert.deepEqual(
    fittedGeneration.outputs.map((output) => output.references.length),
    [6, 4, 4, 4, 4, 6],
  );
  assert.match(
    fittedGeneration.outputs.find((output) => output.can === "interdynamics")
      .generated,
    /interdynamics-label-undistorted-v3\.png$/,
  );

  assert.doesNotMatch(
    JSON.stringify(fittedGeneration.outputs.slice(1, 5)),
    /dsc00853|dsc00857|dsc00862|dsc00867|dsc00872/i,
  );

  for (const output of fittedGeneration.outputs) {
    assert.ok(Math.abs(output.aspect_error_percent) < 0.3);
    const expectedSize = expected.find(([slug]) => slug === output.can)[4];
    assert.deepEqual(output.requested_size, expectedSize);
    await access(new URL(`../${output.generated}`, import.meta.url));
    await access(new URL(`../${output.viewer_asset}`, import.meta.url));
  }
});
