#!/usr/bin/env python3
"""Generate review assets for every refrigerant-can cylinder fit.

Each RAW frame is treated independently. The script fits the straight body
silhouette, projects a calibrated 3D cylinder grid back into the photograph,
and creates one clean lens-corrected cylindrical unwrap of that frame. It does
not register views, stitch labels, remove lighting, or call an image model.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np

from reconstruct_refrigerants import (
    CAMERA_FOCAL_LENGTH_PX,
    CAMERA_PITCH_DEGREES,
    LENS_DISTORTION_PTLENS,
    SERIES,
    VISIBLE_LIMIT_DEGREES,
    ViewFit,
    camera_distance_for_view,
    decode_raw,
    detect_view_fit,
)


@dataclass(frozen=True)
class ReviewSeries:
    slug: str
    display_name: str
    files: tuple[str, ...]
    body_tops: tuple[float, ...]
    body_bottoms: tuple[float, ...]
    body_height_in_radii: float


COLD_SHOT = ReviewSeries(
    slug="cold-shot",
    display_name="Cold Shot R-12",
    files=tuple(f"DSC008{index}.ARW" for index in range(63, 68)),
    body_tops=(1150, 1140, 1135, 1132, 1150),
    body_bottoms=(3477, 3403, 3379, 3358, 3470),
    body_height_in_radii=3.48,
)


def review_series(slug: str) -> ReviewSeries:
    if slug == COLD_SHOT.slug:
        return COLD_SHOT
    config = SERIES[slug]
    return ReviewSeries(
        slug=config.slug,
        display_name=config.name,
        files=config.files,
        body_tops=config.body_tops,
        body_bottoms=config.body_bottoms,
        body_height_in_radii=config.body_height_in_radii,
    )


# Match the physical left-to-right order used by the collection view.
REVIEW_ORDER = (
    "sercon-1",
    "du-pont-freon",
    "interdynamics",
    "cold-shot",
    "chargette",
    "sercon-2",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Root refrigerants RAW folder")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/assets/cylinder-review"),
    )
    parser.add_argument(
        "--series",
        choices=("all", *REVIEW_ORDER),
        default="all",
    )
    parser.add_argument("--photo-width", type=int, default=1424)
    parser.add_argument("--flat-width", type=int, default=1440)
    return parser.parse_args()


def projected_coordinates(
    image_shape: tuple[int, ...],
    fit: ViewFit,
    theta_degrees: np.ndarray,
    global_v: np.ndarray,
    body_height: float,
) -> tuple[np.ndarray, np.ndarray]:
    """Project local cylinder coordinates into the distorted RAW frame."""
    theta, local_v = np.broadcast_arrays(theta_degrees, global_v)
    theta_radians = np.deg2rad(theta)
    pitch = math.radians(CAMERA_PITCH_DEGREES)
    sin_pitch = math.sin(pitch)
    cos_pitch = math.cos(pitch)
    half_height = body_height * 0.5
    camera_distance = camera_distance_for_view(fit, body_height)

    def projected_y_without_offset(world_y: float) -> float:
        denominator = camera_distance - world_y * sin_pitch - cos_pitch
        return CAMERA_FOCAL_LENGTH_PX * (
            sin_pitch - world_y * cos_pitch
        ) / denominator

    camera_center_y = 0.5 * (
        fit.top
        - projected_y_without_offset(half_height)
        + fit.bottom
        - projected_y_without_offset(-half_height)
    )
    world_y = (0.5 - local_v) * body_height
    cosine = np.cos(theta_radians)
    denominator = camera_distance - world_y * sin_pitch - cosine * cos_pitch
    ideal_x = (
        fit.center_top
        + (fit.center_bottom - fit.center_top) * local_v
        + CAMERA_FOCAL_LENGTH_PX * np.sin(theta_radians) / denominator
    )
    ideal_y = camera_center_y + CAMERA_FOCAL_LENGTH_PX * (
        cosine * sin_pitch - world_y * cos_pitch
    ) / denominator

    principal_x = image_shape[1] * 0.5
    principal_y = image_shape[0] * 0.5
    normalization = image_shape[1] * 0.5
    dx = (ideal_x - principal_x) / normalization
    dy = (ideal_y - principal_y) / normalization
    radial = np.sqrt(dx * dx + dy * dy)
    a, b, c = LENS_DISTORTION_PTLENS
    distortion = a * radial**3 + b * radial**2 + c * radial + 1.0 - a - b - c
    source_x = principal_x + dx * distortion * normalization
    source_y = principal_y + dy * distortion * normalization
    return source_x, source_y


def flatten_view(
    image: np.ndarray,
    fit: ViewFit,
    body_height: float,
    width: int,
) -> np.ndarray:
    visible_radians = math.radians(VISIBLE_LIMIT_DEGREES * 2.0)
    height = int(round(width * body_height / visible_radians))
    theta = np.linspace(
        -VISIBLE_LIMIT_DEGREES,
        VISIBLE_LIMIT_DEGREES,
        width,
        dtype=np.float32,
    )[None, :]
    global_v = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
    map_x, map_y = projected_coordinates(
        image.shape,
        fit,
        theta,
        global_v,
        body_height,
    )
    return cv2.remap(
        image,
        map_x.astype(np.float32),
        map_y.astype(np.float32),
        cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT,
    )


def review_photo(image: np.ndarray, width: int) -> np.ndarray:
    height = int(round(image.shape[0] * width / image.shape[1]))
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_AREA)


def cylinder_grid(
    source_shape: tuple[int, ...],
    review_shape: tuple[int, ...],
    fit: ViewFit,
    body_height: float,
) -> np.ndarray:
    overlay = np.zeros((review_shape[0], review_shape[1], 4), dtype=np.uint8)
    scale_x = review_shape[1] / source_shape[1]
    scale_y = review_shape[0] / source_shape[0]

    def polyline(
        theta: np.ndarray,
        global_v: np.ndarray,
        color: tuple[int, int, int, int],
        thickness: int,
    ) -> None:
        source_x, source_y = projected_coordinates(
            source_shape,
            fit,
            theta,
            global_v,
            body_height,
        )
        points = np.stack(
            [source_x * scale_x, source_y * scale_y], axis=-1
        ).reshape(-1, 2)
        finite = np.isfinite(points).all(axis=1)
        points = np.rint(points[finite]).astype(np.int32)
        if len(points) > 1:
            cv2.polylines(
                overlay,
                [points],
                False,
                color,
                thickness,
                cv2.LINE_AA,
            )

    vertical_v = np.linspace(0.0, 1.0, 900, dtype=np.float32)
    for longitude in range(-75, 76, 15):
        is_center = longitude == 0
        is_major = longitude % 30 == 0
        color = (40, 230, 255, 235) if is_center else (255, 220, 35, 185)
        polyline(
            np.full_like(vertical_v, longitude),
            vertical_v,
            color,
            3 if is_center else (2 if is_major else 1),
        )

    ring_theta = np.linspace(-90.0, 90.0, 1200, dtype=np.float32)
    for row in np.linspace(0.0, 1.0, 11, dtype=np.float32):
        is_boundary = row == 0.0 or row == 1.0
        polyline(
            ring_theta,
            np.full_like(ring_theta, row),
            (255, 80, 235, 235) if is_boundary else (255, 220, 35, 175),
            3 if is_boundary else 1,
        )

    silhouette_v = np.linspace(0.0, 1.0, 1000, dtype=np.float32)
    for longitude in (-90.0, 90.0):
        polyline(
            np.full_like(silhouette_v, longitude),
            silhouette_v,
            (255, 80, 235, 245),
            3,
        )
    return overlay


def write_image(path: Path, image: np.ndarray, parameters: list[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), image, parameters):
        raise RuntimeError(f"Could not write {path}")


def process_frame(
    source_root: Path,
    output_root: Path,
    config: ReviewSeries,
    filename: str,
    top: float,
    bottom: float,
    index: int,
    photo_width: int,
    flat_width: int,
) -> dict[str, object]:
    source_path = source_root / config.slug / filename
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    image = decode_raw(source_path)
    fit = detect_view_fit(image, filename, top, bottom)
    photo = review_photo(image, photo_width)
    grid = cylinder_grid(image.shape, photo.shape, fit, config.body_height_in_radii)
    flattened = flatten_view(
        image,
        fit,
        config.body_height_in_radii,
        flat_width,
    )

    stem = Path(filename).stem.lower()
    frame_output = output_root / config.slug / stem
    photo_path = frame_output / "photo.webp"
    grid_path = frame_output / "grid.png"
    flat_path = frame_output / "flat.webp"
    write_image(photo_path, photo, [cv2.IMWRITE_WEBP_QUALITY, 90])
    write_image(grid_path, grid, [cv2.IMWRITE_PNG_COMPRESSION, 9])
    write_image(flat_path, flattened, [cv2.IMWRITE_WEBP_QUALITY, 94])

    print(
        f"[{config.slug}] {index + 1:02}/{len(config.files):02} {filename}: "
        f"center {fit.center_top:.1f}px, radius {fit.radius_top:.1f}→"
        f"{fit.radius_bottom:.1f}px",
        flush=True,
    )
    public_root = "/assets/cylinder-review"
    return {
        "index": index,
        "filename": filename,
        "source_size": [int(image.shape[1]), int(image.shape[0])],
        "photo_size": [int(photo.shape[1]), int(photo.shape[0])],
        "flat_size": [int(flattened.shape[1]), int(flattened.shape[0])],
        "photo": f"{public_root}/{config.slug}/{stem}/photo.webp",
        "grid": f"{public_root}/{config.slug}/{stem}/grid.png",
        "flat": f"{public_root}/{config.slug}/{stem}/flat.webp",
        "visible_longitude_degrees": [
            -VISIBLE_LIMIT_DEGREES,
            VISIBLE_LIMIT_DEGREES,
        ],
        "fit": asdict(fit),
    }


def main() -> None:
    args = parse_args()
    source_root = args.source.expanduser().resolve()
    output_root = args.output.resolve()
    selected = REVIEW_ORDER if args.series == "all" else (args.series,)
    groups: list[dict[str, object]] = []

    for slug in selected:
        config = review_series(slug)
        frames = [
            process_frame(
                source_root,
                output_root,
                config,
                filename,
                top,
                bottom,
                index,
                args.photo_width,
                args.flat_width,
            )
            for index, (filename, top, bottom) in enumerate(
                zip(
                    config.files,
                    config.body_tops,
                    config.body_bottoms,
                    strict=True,
                )
            )
        ]
        groups.append(
            {
                "slug": config.slug,
                "display_name": config.display_name,
                "frame_count": len(frames),
                "body_height_in_radii": config.body_height_in_radii,
                "frames": frames,
            }
        )

    manifest = {
        "version": 1,
        "status": "review only; no cross-view reconstruction or image-model call",
        "source_root": str(source_root),
        "fit_method": "per-frame robust silhouette cylinder fit",
        "projection": "50 mm calibrated perspective cylinder with embedded PTLens distortion",
        "camera_focal_length_pixels": CAMERA_FOCAL_LENGTH_PX,
        "camera_pitch_degrees": CAMERA_PITCH_DEGREES,
        "lens_distortion_ptlens": list(LENS_DISTORTION_PTLENS),
        "grid": {
            "longitude_step_degrees": 15,
            "latitude_divisions": 10,
            "visible_longitude_degrees": [
                -VISIBLE_LIMIT_DEGREES,
                VISIBLE_LIMIT_DEGREES,
            ],
        },
        "total_frames": sum(group["frame_count"] for group in groups),
        "groups": groups,
    }
    output_root.mkdir(parents=True, exist_ok=True)
    (output_root / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        f"Wrote {manifest['total_frames']} review frames to {output_root}",
        flush=True,
    )


if __name__ == "__main__":
    main()
