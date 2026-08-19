"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import reviewManifestJson from "../public/assets/cylinder-review/manifest.json";
import { withBasePath } from "./assetPath";

type ReviewFit = {
  filename: string;
  top: number;
  bottom: number;
  center_top: number;
  center_bottom: number;
  radius_top: number;
  radius_bottom: number;
  angle_offset: number;
};

type ReviewFrame = {
  index: number;
  filename: string;
  source_size: [number, number];
  photo_size: [number, number];
  flat_size: [number, number];
  photo: string;
  grid: string;
  flat: string;
  visible_longitude_degrees: [number, number];
  fit: ReviewFit;
};

type ReviewGroup = {
  slug: string;
  display_name: string;
  frame_count: number;
  body_height_in_radii: number;
  frames: ReviewFrame[];
};

type ReviewManifest = {
  status: string;
  fit_method: string;
  projection: string;
  camera_focal_length_pixels: number;
  camera_pitch_degrees: number;
  total_frames: number;
  groups: ReviewGroup[];
};

const reviewManifest = reviewManifestJson as ReviewManifest;

const SHORT_NAMES: Record<string, string> = {
  "sercon-1": "Sercon Black",
  "du-pont-freon": "Du Pont",
  interdynamics: "Interdynamics",
  "cold-shot": "Cold Shot",
  chargette: "Chargette",
  "sercon-2": "Sercon White",
};

function format(value: number) {
  return value.toFixed(1);
}

export function CylinderReviewPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [groupIndex, setGroupIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [gridOpacity, setGridOpacity] = useState(88);
  const group = reviewManifest.groups[groupIndex];
  const frame = group.frames[frameIndex];
  const photoPath = withBasePath(frame.photo);
  const gridPath = withBasePath(frame.grid);
  const flatPath = withBasePath(frame.flat);

  const absoluteFrame = useMemo(
    () =>
      reviewManifest.groups
        .slice(0, groupIndex)
        .reduce((total, item) => total + item.frame_count, 0) +
      frameIndex +
      1,
    [frameIndex, groupIndex],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") {
        setFrameIndex((index) =>
          (index - 1 + group.frames.length) % group.frames.length,
        );
      }
      if (event.key === "ArrowRight") {
        setFrameIndex((index) => (index + 1) % group.frames.length);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [group.frames.length, onClose]);

  const chooseGroup = (index: number) => {
    setGroupIndex(index);
    setFrameIndex(0);
  };

  return (
    <section
      className="cylinder-review-panel"
      role="dialog"
      aria-modal="true"
      aria-label="Per-photo cylinder fitting review"
      data-testid="cylinder-review-panel"
    >
      <header className="review-header">
        <div>
          <p className="eyebrow">Geometry source · approved for Fitted GPT</p>
          <h2>Cylinder fitting review</h2>
          <p>
            {reviewManifest.total_frames} independent RAW fits · grid projection +
            single-view unwrap
          </p>
        </div>
        <div className="review-header-actions">
          <span>
            {String(absoluteFrame).padStart(2, "0")} / {reviewManifest.total_frames}
          </span>
          <button type="button" onClick={onClose} aria-label="Close cylinder fitting review">
            Close
          </button>
        </div>
      </header>

      <nav className="review-series-tabs" aria-label="Can series">
        {reviewManifest.groups.map((item, index) => (
          <button
            type="button"
            key={item.slug}
            data-testid={`review-group-${item.slug}`}
            className={index === groupIndex ? "active" : ""}
            aria-pressed={index === groupIndex}
            onClick={() => chooseGroup(index)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {SHORT_NAMES[item.slug] ?? item.display_name}
            <small>{item.frame_count}</small>
          </button>
        ))}
      </nav>

      <nav className="review-frame-strip" aria-label={`${group.display_name} photographs`}>
        {group.frames.map((item, index) => (
          <button
            type="button"
            key={item.filename}
            data-testid={`review-frame-${item.filename.replace(".ARW", "").toLowerCase()}`}
            className={index === frameIndex ? "active" : ""}
            aria-current={index === frameIndex ? "true" : undefined}
            onClick={() => setFrameIndex(index)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            {item.filename.replace(".ARW", "")}
          </button>
        ))}
      </nav>

      <div className="review-comparison">
        <article className="review-card">
          <div className="review-card-heading">
            <div>
              <span>01 · Projected fit</span>
              <h3>Calibrated cylinder grid</h3>
            </div>
            <a href={photoPath} target="_blank" rel="noreferrer">
              Open photo
            </a>
          </div>
          <div className="review-visual review-photo-stack">
            <Image
              data-testid="review-photo"
              src={photoPath}
              alt={`${frame.filename} developed RAW photograph`}
              width={frame.photo_size[0]}
              height={frame.photo_size[1]}
              unoptimized
              priority
            />
            <Image
              data-testid="review-grid"
              className="review-grid-overlay"
              src={gridPath}
              alt=""
              aria-hidden="true"
              width={frame.photo_size[0]}
              height={frame.photo_size[1]}
              unoptimized
              priority
              style={{ opacity: gridOpacity / 100 }}
            />
          </div>
          <div className="review-opacity-control">
            <button
              type="button"
              aria-pressed={gridOpacity > 0}
              onClick={() => setGridOpacity((opacity) => (opacity > 0 ? 0 : 88))}
            >
              Grid {gridOpacity > 0 ? "on" : "off"}
            </button>
            <input
              type="range"
              min="0"
              max="100"
              value={gridOpacity}
              aria-label="Cylinder grid opacity"
              onChange={(event) => setGridOpacity(Number(event.target.value))}
            />
            <output>{gridOpacity}%</output>
          </div>
        </article>

        <article className="review-card">
          <div className="review-card-heading">
            <div>
              <span>02 · Per-photo extraction</span>
              <h3>Lens-corrected cylindrical unwrap</h3>
            </div>
            <a href={flatPath} target="_blank" rel="noreferrer">
              Open unwrap
            </a>
          </div>
          <div className="review-visual review-flat-visual">
            <Image
              data-testid="review-flat"
              src={flatPath}
              alt={`Flattened cylindrical body extracted from ${frame.filename}`}
              width={frame.flat_size[0]}
              height={frame.flat_size[1]}
              unoptimized
              priority
            />
          </div>
          <p className="review-card-note">
            One frame only · {frame.visible_longitude_degrees[0]}° to +
            {frame.visible_longitude_degrees[1]}° · no stitching or relighting
          </p>
        </article>
      </div>

      <footer className="review-footer">
        <div className="review-frame-title">
          <p className="eyebrow">{SHORT_NAMES[group.slug]}</p>
          <strong>{frame.filename}</strong>
          <span>
            Source {frame.source_size[0]} × {frame.source_size[1]} · body height {group.body_height_in_radii.toFixed(2)}r
          </span>
        </div>
        <dl>
          <div>
            <dt>Body bounds</dt>
            <dd>{format(frame.fit.top)}–{format(frame.fit.bottom)} px</dd>
          </div>
          <div>
            <dt>Center line</dt>
            <dd>{format(frame.fit.center_top)} px</dd>
          </div>
          <div>
            <dt>Radius</dt>
            <dd>{format(frame.fit.radius_top)}→{format(frame.fit.radius_bottom)} px</dd>
          </div>
          <div>
            <dt>Camera</dt>
            <dd>50 mm · {reviewManifest.camera_pitch_degrees.toFixed(2)}° pitch</dd>
          </div>
        </dl>
        <div className="review-navigation">
          <button
            type="button"
            aria-label="Previous photograph"
            onClick={() =>
              setFrameIndex(
                (frameIndex - 1 + group.frames.length) % group.frames.length,
              )
            }
          >
            ← Previous
          </button>
          <button
            type="button"
            aria-label="Next photograph"
            onClick={() => setFrameIndex((frameIndex + 1) % group.frames.length)}
          >
            Next →
          </button>
        </div>
      </footer>
    </section>
  );
}
