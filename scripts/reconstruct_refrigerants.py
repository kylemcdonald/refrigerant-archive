#!/usr/bin/env python3
"""Reconstruct all photographed refrigerant-can cylindrical albedos.

The camera and lens are shared by every turntable sequence.  Each series keeps
small per-frame vertical bounds, while the cylinder center/radius and rotation
increments are recovered from the photographs themselves.  The output is a
source texture for the restored-print image pass and a metadata file consumed
by the viewer.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2
import numpy as np
import rawpy


CAMERA_FOCAL_LENGTH_PX = 5980.0
CAMERA_PITCH_DEGREES = 13.1458
LENS_DISTORTION_PTLENS = (0.02533463, -0.05879530, 0.04566922)
VISIBLE_LIMIT_DEGREES = 78.0


@dataclass(frozen=True)
class SeriesConfig:
    slug: str
    name: str
    files: tuple[str, ...]
    body_tops: tuple[float, ...]
    body_bottoms: tuple[float, ...]
    fallback_angles: tuple[float, ...]
    seam_view: int
    body_height_in_radii: float
    shoulder_style: str
    nominal_ounces: int


@dataclass(frozen=True)
class ViewFit:
    filename: str
    top: float
    bottom: float
    center_top: float
    center_bottom: float
    radius_top: float
    radius_bottom: float
    angle_offset: float


SERIES = {
    config.slug: config
    for config in (
        SeriesConfig(
            "chargette",
            "Chargette Refrigerant 12",
            tuple(f"DSC008{index}.ARW" for index in range(68, 73)),
            (1178, 1169, 1166, 1140, 1151),
            (3551, 3527, 3499, 3452, 3403),
            (0, 86, 176, 270, 360),
            3,
            3.66,
            "dome",
            14,
        ),
        SeriesConfig(
            "du-pont-freon",
            "Du Pont Freon 12",
            tuple(f"DSC008{index}.ARW" for index in range(52, 58)),
            (1135, 1144, 1116, 1132, 1112, 1140),
            (3380, 3398, 3345, 3364, 3373, 3343),
            (0, 15, 91, 180, 270, 360),
            4,
            3.48,
            "stepped",
            12,
        ),
        SeriesConfig(
            "interdynamics",
            "Interdynamics Refrigerant 12",
            tuple(f"DSC008{index}.ARW" for index in range(58, 63)),
            (1140, 1126, 1150, 1145, 1135),
            (3327, 3325, 3306, 3349, 3314),
            (0, 88, 179, 270, 360),
            3,
            3.45,
            "stepped",
            12,
        ),
        SeriesConfig(
            "sercon-1",
            "Sercon Refrigerant 12 Black",
            tuple(f"DSC008{index}.ARW" for index in range(46, 52)),
            (1163, 1299, 1293, 1258, 1257, 1282),
            (3518, 3699, 3694, 3679, 3686, 3686),
            (0, 68, 108, 190, 276, 360),
            2,
            3.52,
            "dome",
            12,
        ),
        SeriesConfig(
            "sercon-2",
            "Sercon Refrigerant 12 White",
            tuple(f"DSC008{index}.ARW" for index in range(73, 79)),
            (1117, 1122, 1124, 1142, 1137, 1137),
            (3494, 3471, 3470, 3510, 3511, 3488),
            (0, 72, 147, 211, 283, 360),
            4,
            3.66,
            "dome",
            14,
        ),
    )
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Root refrigerants photo folder")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/assets"),
        help="Parent output folder",
    )
    parser.add_argument(
        "--series",
        choices=("all", *SERIES.keys()),
        default="all",
    )
    parser.add_argument("--width", type=int, default=3072)
    parser.add_argument(
        "--diagnostics",
        type=Path,
        default=Path(".work/reconstruction-diagnostics"),
    )
    return parser.parse_args()


def decode_raw(path: Path) -> np.ndarray:
    with rawpy.imread(str(path)) as raw:
        rgb = raw.postprocess(
            use_camera_wb=True,
            no_auto_bright=False,
            output_bps=8,
            demosaic_algorithm=rawpy.DemosaicAlgorithm.AHD,
        )
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def contiguous_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    transitions = np.diff(np.r_[False, mask, False].astype(np.int8))
    return list(zip(np.flatnonzero(transitions == 1), np.flatnonzero(transitions == -1)))


def robust_line(points: np.ndarray) -> np.ndarray:
    keep = np.ones(len(points), dtype=bool)
    design = np.stack([points[:, 0], np.ones(len(points))], axis=1)
    coefficients = np.array([0.0, float(np.median(points[:, 1]))])
    for _ in range(7):
        coefficients, *_ = np.linalg.lstsq(
            design[keep], points[keep, 1], rcond=None
        )
        residual = points[:, 1] - design @ coefficients
        scale = max(float(np.median(np.abs(residual[keep]))) * 1.4826, 1.0)
        keep = np.abs(residual) < scale * 2.8
    return coefficients


def detect_view_fit(
    image: np.ndarray,
    filename: str,
    top: float,
    bottom: float,
) -> ViewFit:
    smooth = cv2.GaussianBlur(image.astype(np.float32), (0, 0), 2.6)
    sample_ys = np.linspace(top + 80, bottom - 360, 48)
    left_points: list[tuple[float, float]] = []
    right_points: list[tuple[float, float]] = []

    for y_float in sample_ys:
        y = int(round(y_float))
        band = smooth[y - 3 : y + 4].mean(axis=0)
        left_background = band[300:550].mean(axis=0)
        right_background = band[2300:2550].mean(axis=0)
        fraction = np.linspace(0.0, 1.0, image.shape[1])[:, None]
        background = (
            left_background[None, :] * (1.0 - fraction)
            + right_background[None, :] * fraction
        )
        deviation = np.linalg.norm(band - background, axis=1)
        deviation = cv2.GaussianBlur(deviation[:, None], (1, 0), 2.2).ravel()
        runs = [
            (start + 500, end + 500)
            for start, end in contiguous_runs(deviation[500:2300] > 8.0)
            if end - start >= 18
        ]
        if not runs:
            continue
        left, right = runs[0][0], runs[-1][1]
        if 550 < left < 1100 and 1800 < right < 2250 and right - left > 1050:
            left_points.append((y_float, float(left)))
            right_points.append((y_float, float(right)))

    if len(left_points) < 12 or len(right_points) < 12:
        raise RuntimeError(f"Could not fit cylinder silhouette in {filename}")

    left_values = np.asarray(left_points, dtype=np.float64)[:, 1]
    right_values = np.asarray(right_points, dtype=np.float64)[:, 1]
    centers = (left_values + right_values) * 0.5
    radii = (right_values - left_values) * 0.5
    # Painted white edges occasionally disappear into the sweep, and a label
    # rule is then mistaken for one side of the can.  A free two-line fit can
    # turn that into an impossible tilted cylinder.  The camera calibration
    # says the centerline is effectively vertical and the apparent radius
    # changes by about eight percent from top to bottom, so robustly estimate
    # the center and mid-radius and enforce those physical constraints.
    center = float(np.median(centers))
    mid_radius = float(np.percentile(radii, 25))
    radius_top = mid_radius * 1.04
    radius_bottom = mid_radius * 0.96
    return ViewFit(
        filename=filename,
        top=top,
        bottom=bottom,
        center_top=center,
        center_bottom=center,
        radius_top=radius_top,
        radius_bottom=radius_bottom,
        angle_offset=0.0,
    )


def camera_distance_for_view(fit: ViewFit, body_height: float) -> float:
    pitch = math.radians(CAMERA_PITCH_DEGREES)
    half_height = body_height * 0.5
    distance_from_top = math.sqrt(
        (CAMERA_FOCAL_LENGTH_PX / fit.radius_top) ** 2 + math.cos(pitch) ** 2
    ) + half_height * math.sin(pitch)
    distance_from_bottom = math.sqrt(
        (CAMERA_FOCAL_LENGTH_PX / fit.radius_bottom) ** 2 + math.cos(pitch) ** 2
    ) - half_height * math.sin(pitch)
    return (distance_from_top + distance_from_bottom) * 0.5


def sample_view(
    image: np.ndarray,
    fit: ViewFit,
    longitude: np.ndarray,
    global_v: np.ndarray,
    body_height: float,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    theta = (longitude - fit.angle_offset + 180.0) % 360.0 - 180.0
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
    world_y = (0.5 - global_v) * body_height
    cosine = np.cos(theta_radians)
    denominator = camera_distance - world_y * sin_pitch - cosine * cos_pitch
    ideal_x = (
        fit.center_top
        + (fit.center_bottom - fit.center_top) * global_v
        + CAMERA_FOCAL_LENGTH_PX * np.sin(theta_radians) / denominator
    )
    ideal_y = camera_center_y + CAMERA_FOCAL_LENGTH_PX * (
        cosine * sin_pitch - world_y * cos_pitch
    ) / denominator

    principal_x = image.shape[1] * 0.5
    principal_y = image.shape[0] * 0.5
    normalization = image.shape[1] * 0.5
    dx = (ideal_x - principal_x) / normalization
    dy = (ideal_y - principal_y) / normalization
    radial = np.sqrt(dx * dx + dy * dy)
    a, b, c = LENS_DISTORTION_PTLENS
    distortion = a * radial**3 + b * radial**2 + c * radial + 1.0 - a - b - c
    map_x = (principal_x + dx * distortion * normalization).astype(np.float32)
    map_y = (principal_y + dy * distortion * normalization).astype(np.float32)
    sampled = cv2.remap(
        image,
        map_x,
        map_y,
        cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT,
    )
    valid = (np.abs(theta) < VISIBLE_LIMIT_DEGREES) & (global_v >= 0.0) & (global_v <= 1.0)
    return sampled, theta, valid


def local_patch(image: np.ndarray, fit: ViewFit, body_height: float) -> np.ndarray:
    width, height = 1280, 720
    longitude = np.linspace(
        -VISIBLE_LIMIT_DEGREES,
        VISIBLE_LIMIT_DEGREES,
        width,
        dtype=np.float32,
    )[None, :]
    global_v = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]
    sampled, _, _ = sample_view(image, fit, longitude, global_v, body_height)
    return sampled


def estimate_angle_increment(
    first: np.ndarray,
    second: np.ndarray,
    expected: float,
) -> tuple[float, int]:
    first_gray = cv2.cvtColor(first, cv2.COLOR_BGR2GRAY)
    second_gray = cv2.cvtColor(second, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(12, 8))
    first_gray = clahe.apply(first_gray)
    second_gray = clahe.apply(second_gray)
    sift = cv2.SIFT_create(nfeatures=5000, contrastThreshold=0.012, edgeThreshold=14)
    first_points, first_descriptors = sift.detectAndCompute(first_gray, None)
    second_points, second_descriptors = sift.detectAndCompute(second_gray, None)
    if first_descriptors is None or second_descriptors is None:
        return expected, 0

    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(first_descriptors, second_descriptors, k=2)
    candidates: list[float] = []
    for best, alternate in pairs:
        if best.distance >= 0.72 * alternate.distance:
            continue
        first_x, first_y = first_points[best.queryIdx].pt
        second_x, second_y = second_points[best.trainIdx].pt
        if abs(first_y - second_y) > 70:
            continue
        first_theta = (
            first_x / (first.shape[1] - 1) * 2.0 - 1.0
        ) * VISIBLE_LIMIT_DEGREES
        second_theta = (
            second_x / (second.shape[1] - 1) * 2.0 - 1.0
        ) * VISIBLE_LIMIT_DEGREES
        increment = first_theta - second_theta
        tolerance = max(18.0, expected * 0.36)
        if abs(increment - expected) <= tolerance:
            candidates.append(float(increment))

    if len(candidates) < 8:
        return expected, len(candidates)
    values = np.asarray(candidates)
    center = float(np.median(values))
    scale = max(float(np.median(np.abs(values - center))) * 1.4826, 0.7)
    inliers = values[np.abs(values - center) < scale * 2.8]
    if len(inliers) < 8:
        return expected, len(inliers)
    return float(np.median(inliers)), len(inliers)


def recover_angles(
    patches: list[np.ndarray], fallback: tuple[float, ...]
) -> tuple[list[float], list[dict[str, float | int]]]:
    increments: list[float] = []
    match_counts: list[int] = []
    diagnostics: list[dict[str, float | int]] = []
    for index in range(len(patches) - 1):
        expected = fallback[index + 1] - fallback[index]
        measured, matches = estimate_angle_increment(
            patches[index], patches[index + 1], expected
        )
        increments.append(measured)
        match_counts.append(matches)
        diagnostics.append(
            {
                "pair": index,
                "expected_degrees": expected,
                "measured_degrees": measured,
                "inlier_matches": matches,
            }
        )

    measured_total = sum(increments)
    if measured_total < 300.0 or measured_total > 420.0:
        return list(fallback), diagnostics
    # The repeated final photograph closes the loop at 360 degrees.  Preserve
    # well-supported pair registrations and place closure error into weak or
    # fallback pairs, instead of scaling every angle and moving otherwise
    # aligned lettering at each join.
    correction = 360.0 - measured_total
    uncertainty = np.asarray(
        [
            (4.0 if count < 8 else 1.0) / math.sqrt(max(count, 1))
            for count in match_counts
        ],
        dtype=np.float64,
    )
    uncertainty /= uncertainty.sum()
    adjusted = [
        increment + correction * float(weight)
        for increment, weight in zip(increments, uncertainty, strict=True)
    ]
    angles = [0.0]
    for increment in adjusted:
        angles.append(angles[-1] + increment)
    angles[-1] = 360.0
    return angles, diagnostics


def reconstruct(
    images: list[np.ndarray],
    fits: list[ViewFit],
    body_height: float,
    width: int,
) -> np.ndarray:
    height = int(round(width * body_height / (2.0 * math.pi)))
    longitude = np.linspace(0.0, 360.0, width, endpoint=False, dtype=np.float32)[None, :]
    global_v = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]

    samples: list[np.ndarray] = []
    distances: list[np.ndarray] = []
    valid_masks: list[np.ndarray] = []
    for image, fit in zip(images, fits, strict=True):
        sampled, theta, valid = sample_view(
            image, fit, longitude, global_v, body_height
        )
        samples.append(np.power(np.clip(sampled / 255.0, 0.0, 1.0), 2.2))
        distances.append(np.abs(theta))
        valid_masks.append(valid)

    distance_stack = np.stack(distances)
    valid_stack = np.stack(valid_masks)
    masked_distance = np.where(valid_stack, distance_stack, 999.0)
    nearest = masked_distance.min(axis=0)
    # Keep the feather deliberately narrow.  A wide cross-fade turns tiny
    # camera-position and label-wrinkle differences into doubled lettering;
    # the source albedo is more useful with a crisp, well-placed join.
    scores = np.exp(-1.25 * (masked_distance - nearest[None, ...])) * valid_stack
    scores *= np.clip(
        (VISIBLE_LIMIT_DEGREES - masked_distance) / 7.0,
        0.0,
        1.0,
    )
    weights = scores / np.maximum(scores.sum(axis=0, keepdims=True), 1e-6)

    linear = np.zeros_like(samples[0], dtype=np.float32)
    for index, sample in enumerate(samples):
        linear += sample * weights[index][..., None]
    result = np.power(np.clip(linear, 0.0, 1.0), 1.0 / 2.2)
    return (result * 255.0 + 0.5).astype(np.uint8)


def save_diagnostics(
    path: Path,
    config: SeriesConfig,
    patches: list[np.ndarray],
    angles: list[float],
) -> None:
    panels = []
    for patch, angle, filename in zip(patches, angles, config.files, strict=True):
        panel = cv2.resize(patch, (384, 216), interpolation=cv2.INTER_AREA)
        cv2.putText(
            panel,
            f"{filename[:-4]} / {angle:.1f} deg",
            (12, 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (20, 20, 20),
            3,
            cv2.LINE_AA,
        )
        cv2.putText(
            panel,
            f"{filename[:-4]} / {angle:.1f} deg",
            (12, 24),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (245, 245, 245),
            1,
            cv2.LINE_AA,
        )
        panels.append(panel)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), cv2.hconcat(panels), [cv2.IMWRITE_JPEG_QUALITY, 94])


def process_series(
    source_root: Path,
    output_root: Path,
    diagnostics_root: Path,
    config: SeriesConfig,
    width: int,
) -> None:
    source = source_root / config.slug
    missing = [filename for filename in config.files if not (source / filename).exists()]
    if missing:
        raise FileNotFoundError(f"{config.slug}: missing {', '.join(missing)}")

    print(f"[{config.slug}] decoding {len(config.files)} RAW photographs", flush=True)
    images = [decode_raw(source / filename) for filename in config.files]
    initial_fits = [
        detect_view_fit(image, filename, top, bottom)
        for image, filename, top, bottom in zip(
            images,
            config.files,
            config.body_tops,
            config.body_bottoms,
            strict=True,
        )
    ]
    patches = [
        local_patch(image, fit, config.body_height_in_radii)
        for image, fit in zip(images, initial_fits, strict=True)
    ]
    angles, angle_diagnostics = recover_angles(patches, config.fallback_angles)
    fits = [
        ViewFit(**{**asdict(fit), "angle_offset": angle})
        for fit, angle in zip(initial_fits, angles, strict=True)
    ]
    print(
        f"[{config.slug}] recovered view angles: "
        + ", ".join(f"{angle:.2f}" for angle in angles),
        flush=True,
    )

    albedo = reconstruct(images, fits, config.body_height_in_radii, width)
    cut_angle = angles[config.seam_view]
    cut = int(round(cut_angle / 360.0 * width))
    albedo = np.roll(albedo, -cut, axis=1)

    output = output_root / config.slug
    output.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(
        str(output / "label-source.webp"),
        albedo,
        [cv2.IMWRITE_WEBP_QUALITY, 96],
    ):
        raise RuntimeError(f"Could not write {output / 'label-source.webp'}")

    metadata = {
        "source_directory": config.slug,
        "source_files": list(config.files),
        "display_name": config.name,
        "nominal_ounces": config.nominal_ounces,
        "output_size": [int(albedo.shape[1]), int(albedo.shape[0])],
        "projection": "lens-corrected perspective projection of a pitched 3D cylinder",
        "camera_focal_length_pixels": CAMERA_FOCAL_LENGTH_PX,
        "camera_pitch_degrees": CAMERA_PITCH_DEGREES,
        "body_height_in_radii": config.body_height_in_radii,
        "shoulder_style": config.shoulder_style,
        "cut_longitude_degrees": cut_angle,
        "front_u": ((360.0 - cut_angle) % 360.0) / 360.0,
        "view_angles_degrees": angles,
        "views": [asdict(fit) for fit in fits],
        "angle_registration": angle_diagnostics,
    }
    (output / "reconstruction.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )
    save_diagnostics(
        diagnostics_root / f"{config.slug}-registered.jpg",
        config,
        patches,
        angles,
    )
    print(f"[{config.slug}] wrote {output / 'label-source.webp'}", flush=True)


def main() -> None:
    args = parse_args()
    selected = SERIES.values() if args.series == "all" else (SERIES[args.series],)
    for config in selected:
        process_series(
            args.source.expanduser().resolve(),
            args.output.resolve(),
            args.diagnostics.resolve(),
            config,
            args.width,
        )


if __name__ == "__main__":
    main()
