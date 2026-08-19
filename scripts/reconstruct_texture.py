#!/usr/bin/env python3
"""Reconstruct the Cold Shot can label from the calibrated RAW photo turntable.

The fit is specific to DSC00863–DSC00867. It uses a perspective-aware
cylindrical projection, overlap calibration, and a narrow feather between the
four unique views. DSC00867 is the loop-closure photograph used to verify that
the first and last views meet at 360 degrees.
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


@dataclass(frozen=True)
class ViewFit:
    filename: str
    top: float
    bottom: float
    center_top: float
    center_bottom: float
    radius_top: float
    radius_bottom: float
    # Local rectified longitude -> global cylinder longitude.
    angle_scale: float
    angle_offset: float
    angle_scale_y: float
    angle_offset_y: float
    # Small vertical registration correction across view angle.
    vertical_scale: float
    vertical_offset: float
    vertical_angle: float
    vertical_angle_y: float


VIEWS = (
    ViewFit(
        "DSC00863.ARW",
        1150,
        3477,
        1425,
        1431,
        650,
        598.3,
        1.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
    ),
    ViewFit(
        "DSC00864.ARW",
        1140,
        3403,
        1405,
        1412,
        633,
        583.8,
        0.9944265408,
        93.8727476053,
        0.0568717264,
        2.5876518859,
        1.0019594207,
        0.0032725490,
        0.0032098625,
        -0.0008253562,
    ),
    ViewFit(
        "DSC00865.ARW",
        1135,
        3379,
        1339,
        1342,
        628,
        579.6,
        0.9946679961,
        178.3993675854,
        -0.0109289174,
        -0.3581821377,
        0.9997769279,
        0.0034630519,
        0.0047622959,
        0.0014418738,
    ),
    ViewFit(
        "DSC00866.ARW",
        1132,
        3358,
        1413,
        1417,
        623,
        575.3,
        0.9978213004,
        262.1326120824,
        0.0314770779,
        -2.0950274414,
        0.9976216625,
        0.0034321402,
        0.0018821935,
        -0.0005172223,
    ),
)

LOOP_CLOSURE = {
    "filename": "DSC00867.ARW",
    "fitted_center_degrees": 358.59063870,
    "closure_error_degrees": 1.40936130,
}

CAMERA_FOCAL_LENGTH_PX = 5980.0
CAMERA_PITCH_DEGREES = 13.1458
BODY_HEIGHT_IN_RADII = 3.48
VISIBLE_LIMIT_DEGREES = 80.0
CUT_LONGITUDE_DEGREES = VIEWS[-1].angle_offset
LENS_DISTORTION_PTLENS = (0.02533463, -0.05879530, 0.04566922)
PHOTOMETRIC_THETA_STEP = 1.0
PHOTOMETRIC_THETA_BINS = 161
PHOTOMETRIC_BANDS = 18
ENVIRONMENT_REFLECTION_AMOUNT = 0.28


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "source",
        type=Path,
        help="Folder containing DSC00863.ARW through DSC00867.ARW",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("public/assets/cold-shot"),
        help="Output asset folder",
    )
    parser.add_argument("--width", type=int, default=4096)
    parser.add_argument("--height", type=int, default=2268)
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


def circular_delta(values: np.ndarray, center: float) -> np.ndarray:
    return (values - center + 180.0) % 360.0 - 180.0


def camera_distance_for_view(fit: ViewFit) -> float:
    pitch = math.radians(CAMERA_PITCH_DEGREES)
    sin_pitch = math.sin(pitch)
    cos_pitch = math.cos(pitch)
    half_height = BODY_HEIGHT_IN_RADII * 0.5
    distance_from_top = math.sqrt(
        (CAMERA_FOCAL_LENGTH_PX / fit.radius_top) ** 2 + cos_pitch**2
    ) + half_height * sin_pitch
    distance_from_bottom = math.sqrt(
        (CAMERA_FOCAL_LENGTH_PX / fit.radius_bottom) ** 2 + cos_pitch**2
    ) - half_height * sin_pitch
    return (distance_from_top + distance_from_bottom) * 0.5


def sample_view(
    image: np.ndarray,
    fit: ViewFit,
    longitude: np.ndarray,
    global_v: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    delta = circular_delta(longitude, fit.angle_offset)

    # The calibrated horizontal mapping has a tiny height-dependent term.
    local_v = np.broadcast_to(global_v, (global_v.shape[0], longitude.shape[1]))
    centered_v = local_v - 0.5
    theta = (delta - fit.angle_offset_y * centered_v) / (
        fit.angle_scale + fit.angle_scale_y * centered_v
    )

    # Invert the vertical overlap correction, then refine theta once.
    normalized_theta = theta / 80.0
    local_v = (
        global_v
        - fit.vertical_offset
        - fit.vertical_angle * normalized_theta
        + 0.5 * fit.vertical_angle_y * normalized_theta
    ) / (fit.vertical_scale + fit.vertical_angle_y * normalized_theta)
    centered_v = local_v - 0.5
    theta = (delta - fit.angle_offset_y * centered_v) / (
        fit.angle_scale + fit.angle_scale_y * centered_v
    )
    normalized_theta = theta / 80.0
    local_v = (
        global_v
        - fit.vertical_offset
        - fit.vertical_angle * normalized_theta
        + 0.5 * fit.vertical_angle_y * normalized_theta
    ) / (fit.vertical_scale + fit.vertical_angle_y * normalized_theta)

    theta_radians = np.deg2rad(theta)
    pitch = math.radians(CAMERA_PITCH_DEGREES)
    sin_pitch = math.sin(pitch)
    cos_pitch = math.cos(pitch)
    half_height = BODY_HEIGHT_IN_RADII * 0.5

    # Infer the camera-to-cylinder distance from the two fitted silhouette
    # radii. The 5980 px focal length comes from the 50 mm EXIF focal length and
    # the full-frame sensor dimensions at this RAW resolution.
    camera_distance = camera_distance_for_view(fit)

    def projected_y_without_offset(world_y: float) -> float:
        denominator = camera_distance - world_y * sin_pitch - cos_pitch
        return CAMERA_FOCAL_LENGTH_PX * (
            sin_pitch - world_y * cos_pitch
        ) / denominator

    camera_center_y = 0.5 * (
        fit.top - projected_y_without_offset(half_height)
        + fit.bottom
        - projected_y_without_offset(-half_height)
    )

    world_y = (0.5 - local_v) * BODY_HEIGHT_IN_RADII
    cosine = np.cos(theta_radians)
    denominator = (
        camera_distance - world_y * sin_pitch - cosine * cos_pitch
    )
    center = fit.center_top + (fit.center_bottom - fit.center_top) * local_v
    ideal_x = center + CAMERA_FOCAL_LENGTH_PX * np.sin(theta_radians) / denominator
    ideal_y = (
        camera_center_y
        + CAMERA_FOCAL_LENGTH_PX
        * (cosine * sin_pitch - world_y * cos_pitch)
        / denominator
    )

    # Distortion correction was disabled in camera. Convert ideal projected
    # coordinates back into the Sony RAW's distorted coordinates using the
    # embedded FE 50 mm F1.2 GM PTLens profile. Sampling this way avoids an
    # extra full-frame resampling pass.
    principal_x = image.shape[1] * 0.5
    principal_y = image.shape[0] * 0.5
    normalization = image.shape[1] * 0.5
    dx = (ideal_x - principal_x) / normalization
    dy = (ideal_y - principal_y) / normalization
    radius = np.sqrt(dx * dx + dy * dy)
    distortion_a, distortion_b, distortion_c = LENS_DISTORTION_PTLENS
    distortion = (
        distortion_a * radius**3
        + distortion_b * radius**2
        + distortion_c * radius
        + 1.0
        - distortion_a
        - distortion_b
        - distortion_c
    )
    map_x = (principal_x + dx * distortion * normalization).astype(np.float32)
    map_y = (principal_y + dy * distortion * normalization).astype(np.float32)

    sample = cv2.remap(
        image,
        map_x,
        map_y,
        cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_REFLECT,
    )
    valid = (
        (np.abs(theta) < VISIBLE_LIMIT_DEGREES)
        & (local_v >= -0.012)
        & (local_v <= 1.012)
    )
    return sample, theta, valid


def lookup_angular_field(field: np.ndarray, theta: np.ndarray) -> np.ndarray:
    coordinate = np.clip(
        (theta + VISIBLE_LIMIT_DEGREES) / PHOTOMETRIC_THETA_STEP,
        0,
        PHOTOMETRIC_THETA_BINS - 1,
    )
    low = np.floor(coordinate).astype(np.int32)
    high = np.minimum(low + 1, PHOTOMETRIC_THETA_BINS - 1)
    fraction = (coordinate - low)[..., None]
    return field[low] * (1.0 - fraction) + field[high] * fraction


def lookup_environment_field(field: np.ndarray, theta: np.ndarray) -> np.ndarray:
    map_x = np.clip(
        (theta + VISIBLE_LIMIT_DEGREES) / PHOTOMETRIC_THETA_STEP,
        0,
        PHOTOMETRIC_THETA_BINS - 1,
    ).astype(np.float32)
    map_y = np.broadcast_to(
        np.linspace(0, field.shape[0] - 1, theta.shape[0], dtype=np.float32)[
            :, None
        ],
        theta.shape,
    )
    return np.stack(
        [
            cv2.remap(
                field[..., channel],
                map_x,
                map_y,
                cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_REPLICATE,
            )
            for channel in range(3)
        ],
        axis=2,
    )


def blur_angular_field(field: np.ndarray, sigma: float) -> np.ndarray:
    """Blur along camera angle without mixing the three color channels."""
    return cv2.GaussianBlur(
        field[None, ...], (0, 0), sigmaX=sigma, sigmaY=0
    )[0]


def estimate_white_illumination(
    samples: list[np.ndarray],
    thetas: list[np.ndarray],
    valids: list[np.ndarray],
) -> np.ndarray:
    observations: list[list[np.ndarray]] = [
        [] for _ in range(PHOTOMETRIC_THETA_BINS)
    ]
    for sample, theta, valid in zip(samples, thetas, valids, strict=True):
        height = sample.shape[0]
        row = np.arange(height, dtype=np.float32)[:, None] / max(height - 1, 1)
        # These narrow strips stay in the unprinted white/silver border at
        # every longitude, giving a neutral reference even at the true ends.
        white_band = ((row > 0.006) & (row < 0.038)) | (
            (row > 0.967) & (row < 0.995)
        )
        maximum = np.max(sample, axis=2)
        minimum = np.min(sample, axis=2)
        saturation = (maximum - minimum) / np.maximum(maximum, 0.02)
        mask = valid & white_band & (saturation < 0.55) & (maximum > 0.12)
        bins = np.clip(
            np.rint(
                (theta[mask] + VISIBLE_LIMIT_DEGREES)
                / PHOTOMETRIC_THETA_STEP
            ),
            0,
            PHOTOMETRIC_THETA_BINS - 1,
        ).astype(np.int32)
        selected = sample[mask]
        for index in np.unique(bins):
            observations[int(index)].append(selected[bins == index])

    profile = np.full((PHOTOMETRIC_THETA_BINS, 3), np.nan, dtype=np.float32)
    for index, parts in enumerate(observations):
        if parts:
            profile[index] = np.median(np.concatenate(parts, axis=0), axis=0)
    known = np.flatnonzero(np.isfinite(profile[:, 0]))
    if len(known) < 2:
        return np.ones(
            (PHOTOMETRIC_THETA_BINS, 3), dtype=np.float32
        )
    for channel in range(3):
        profile[:, channel] = np.interp(
            np.arange(PHOTOMETRIC_THETA_BINS), known, profile[known, channel]
        )
    profile = blur_angular_field(profile, 1.35)
    reference = np.median(profile[50:111], axis=0, keepdims=True)
    # Preserve all object-space dirt and print, but flatten both broad falloff
    # and narrow stationary reflection bands measured on the neutral border.
    diffuse_gain = np.clip(
        profile / np.maximum(reference, 0.02), 0.58, 1.45
    )
    return diffuse_gain


def solve_additive_environment(
    samples: list[np.ndarray],
    thetas: list[np.ndarray],
    valids: list[np.ndarray],
) -> np.ndarray:
    rows: list[np.ndarray] = []
    targets: list[np.ndarray] = []
    weights: list[float] = []
    luminances = [
        cv2.cvtColor(sample.astype(np.float32), cv2.COLOR_BGR2GRAY)
        for sample in samples
    ]
    gradients = []
    for luminance in luminances:
        gradient_x = cv2.Sobel(luminance, cv2.CV_32F, 1, 0, ksize=3)
        gradient_y = cv2.Sobel(luminance, cv2.CV_32F, 0, 1, ksize=3)
        gradients.append(np.sqrt(gradient_x * gradient_x + gradient_y * gradient_y))

    for first in range(len(samples)):
        for second in range(first + 1, len(samples)):
            mask = valids[first] & valids[second]
            mask &= gradients[first] < 0.16
            mask &= gradients[second] < 0.16
            mask &= luminances[first] > 0.025
            mask &= luminances[second] > 0.025
            mask &= luminances[first] < 0.82
            mask &= luminances[second] < 0.82
            mask[::2, :] = False
            mask[:, ::2] = False
            if not np.any(mask):
                continue

            first_bin = np.clip(
                np.rint(
                    (thetas[first][mask] + VISIBLE_LIMIT_DEGREES)
                    / PHOTOMETRIC_THETA_STEP
                ),
                0,
                PHOTOMETRIC_THETA_BINS - 1,
            ).astype(np.int32)
            second_bin = np.clip(
                np.rint(
                    (thetas[second][mask] + VISIBLE_LIMIT_DEGREES)
                    / PHOTOMETRIC_THETA_STEP
                ),
                0,
                PHOTOMETRIC_THETA_BINS - 1,
            ).astype(np.int32)
            keys = first_bin * PHOTOMETRIC_THETA_BINS + second_bin
            differences = samples[first][mask] - samples[second][mask]
            for key in np.unique(keys):
                selected = keys == key
                count = int(np.count_nonzero(selected))
                if count < 35:
                    continue
                one = int(key // PHOTOMETRIC_THETA_BINS)
                two = int(key % PHOTOMETRIC_THETA_BINS)
                if one == two:
                    continue
                row = np.zeros(PHOTOMETRIC_THETA_BINS, dtype=np.float64)
                row[one] = 1.0
                row[two] = -1.0
                rows.append(row)
                targets.append(np.median(differences[selected], axis=0))
                weights.append(min(math.sqrt(count) / 5.0, 5.0))

    for index in range(PHOTOMETRIC_THETA_BINS - 1):
        row = np.zeros(PHOTOMETRIC_THETA_BINS, dtype=np.float64)
        row[index] = 1.0
        row[index + 1] = -1.0
        rows.append(row)
        targets.append(np.zeros(3))
        weights.append(3.2)
    for index in range(1, PHOTOMETRIC_THETA_BINS - 1):
        row = np.zeros(PHOTOMETRIC_THETA_BINS, dtype=np.float64)
        row[index - 1] = 1.0
        row[index] = -2.0
        row[index + 1] = 1.0
        rows.append(row)
        targets.append(np.zeros(3))
        weights.append(10.0)
    for index in range(PHOTOMETRIC_THETA_BINS):
        row = np.zeros(PHOTOMETRIC_THETA_BINS, dtype=np.float64)
        row[index] = 1.0
        rows.append(row)
        targets.append(np.zeros(3))
        weights.append(2.2)
    anchor = np.ones(PHOTOMETRIC_THETA_BINS, dtype=np.float64)
    anchor /= PHOTOMETRIC_THETA_BINS
    rows.append(anchor)
    targets.append(np.zeros(3))
    weights.append(100.0)

    matrix = np.stack(rows)
    target = np.stack(targets)
    weight = np.asarray(weights)[:, None]
    field, *_ = np.linalg.lstsq(matrix * weight, target * weight, rcond=None)
    return blur_angular_field(field.astype(np.float32), 2.0)


def estimate_environment_reflection(
    samples: list[np.ndarray],
    thetas: list[np.ndarray],
    valids: list[np.ndarray],
) -> np.ndarray:
    height = samples[0].shape[0]
    bands = []
    for band in range(PHOTOMETRIC_BANDS):
        first_row = round(band / PHOTOMETRIC_BANDS * height)
        last_row = round((band + 1) / PHOTOMETRIC_BANDS * height)
        field = solve_additive_environment(
            [sample[first_row:last_row] for sample in samples],
            [theta[first_row:last_row] for theta in thetas],
            [valid[first_row:last_row] for valid in valids],
        )
        field -= np.percentile(field, 8, axis=0, keepdims=True)
        bands.append(np.clip(field, 0.0, 0.11))
    result = np.stack(bands)
    return cv2.GaussianBlur(result, (0, 0), sigmaX=1.5, sigmaY=1.0)


def remove_capture_lighting(
    sample: np.ndarray,
    theta: np.ndarray,
    diffuse_gain: np.ndarray,
    environment: np.ndarray,
) -> np.ndarray:
    local_gain = lookup_angular_field(diffuse_gain, theta)
    local_environment = lookup_environment_field(environment, theta)
    return np.clip(
        (sample - local_environment * ENVIRONMENT_REFLECTION_AMOUNT)
        / np.maximum(local_gain, 0.58),
        0.0,
        1.0,
    )


def reconstruct(source: Path, width: int, height: int) -> np.ndarray:
    missing = [view.filename for view in VIEWS if not (source / view.filename).exists()]
    if not (source / LOOP_CLOSURE["filename"]).exists():
        missing.append(LOOP_CLOSURE["filename"])
    if missing:
        raise FileNotFoundError(f"Missing calibrated source photographs: {', '.join(missing)}")

    # Estimate capture lighting at a smaller resolution. The four photographs
    # show the same print under the same stationary studio environment at four
    # rotations, so view-invariant differences reveal a smooth camera-space
    # reflection field rather than object-space albedo.
    estimate_width = min(width, 1024)
    estimate_height = max(2, round(height * estimate_width / width))
    estimate_longitude = np.linspace(
        0.0, 360.0, estimate_width, endpoint=False, dtype=np.float32
    )[None, :]
    estimate_v = np.linspace(
        0.0, 1.0, estimate_height, dtype=np.float32
    )[:, None]

    estimate_samples: list[np.ndarray] = []
    estimate_thetas: list[np.ndarray] = []
    estimate_valids: list[np.ndarray] = []
    for fit in VIEWS:
        sampled, theta, valid = sample_view(
            decode_raw(source / fit.filename),
            fit,
            estimate_longitude,
            estimate_v,
        )
        estimate_samples.append(
            np.power(np.clip(sampled / 255.0, 0.0, 1.0), 2.2)
        )
        estimate_thetas.append(theta)
        estimate_valids.append(valid)

    environment = estimate_environment_reflection(
        estimate_samples, estimate_thetas, estimate_valids
    )
    white_reference_samples = [
        np.clip(
            sample
            - lookup_environment_field(environment, theta)
            * ENVIRONMENT_REFLECTION_AMOUNT,
            0.0,
            1.0,
        )
        for sample, theta in zip(
            estimate_samples, estimate_thetas, strict=True
        )
    ]
    diffuse_gain = estimate_white_illumination(
        white_reference_samples, estimate_thetas, estimate_valids
    )
    del white_reference_samples
    del estimate_samples, estimate_thetas, estimate_valids

    longitude = np.linspace(
        0.0, 360.0, width, endpoint=False, dtype=np.float32
    )[None, :]
    global_v = np.linspace(0.0, 1.0, height, dtype=np.float32)[:, None]

    samples: list[np.ndarray] = []
    distances: list[np.ndarray] = []
    valid_masks: list[np.ndarray] = []
    for fit in VIEWS:
        sampled, theta, valid = sample_view(
            decode_raw(source / fit.filename), fit, longitude, global_v
        )
        linear = np.power(np.clip(sampled / 255.0, 0.0, 1.0), 2.2)
        samples.append(
            remove_capture_lighting(
                linear,
                theta,
                diffuse_gain,
                environment,
            )
        )
        distances.append(np.abs(theta))
        valid_masks.append(valid)

    distance_stack = np.stack(distances)
    valid_stack = np.stack(valid_masks)
    masked_distance = np.where(valid_stack, distance_stack, 999.0)
    nearest = masked_distance.min(axis=0)

    # A tight nearest-view feather retains the high-resolution lettering while
    # smoothing the four overlap cuts. The match calibration above keeps those
    # cuts on the same physical cylinder longitude.
    scores = np.exp(-0.60 * (masked_distance - nearest[None, ...])) * valid_stack
    scores *= np.clip(
        (VISIBLE_LIMIT_DEGREES - masked_distance) / 5.0, 0.0, 1.0
    )
    weights = scores / np.maximum(scores.sum(axis=0, keepdims=True), 1e-6)

    linear = np.zeros_like(samples[0], dtype=np.float32)
    for index, sample in enumerate(samples):
        linear += sample * weights[index][..., None]
    result = np.power(np.clip(linear, 0.0, 1.0), 1.0 / 2.2)
    result = (result * 255.0 + 0.5).astype(np.uint8)

    # Cut the final flat texture at the photographed vertical label seam.
    cut = int(round(CUT_LONGITUDE_DEGREES / 360.0 * width))
    return np.roll(result, -cut, axis=1)


def seamless_blur(noise: np.ndarray, sigma: float) -> np.ndarray:
    tiled = np.tile(noise, (3, 3))
    blurred = cv2.GaussianBlur(tiled, (0, 0), sigma)
    height, width = noise.shape
    return blurred[height : height * 2, width : width * 2]


def make_label_maps(albedo: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    hsv = cv2.cvtColor(albedo, cv2.COLOR_BGR2HSV).astype(np.float32)
    saturation = hsv[..., 1] / 255.0
    luminance = cv2.cvtColor(albedo, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0

    roughness = 0.53 - 0.12 * saturation + 0.06 * (1.0 - luminance)
    roughness = cv2.GaussianBlur(roughness, (0, 0), 1.2)
    roughness = (np.clip(roughness, 0.28, 0.68) * 255.0).astype(np.uint8)

    metalness = np.full_like(roughness, 5, dtype=np.uint8)
    x = np.arange(albedo.shape[1], dtype=np.float32)
    seam_distance = np.minimum(x, albedo.shape[1] - x)
    seam = np.clip(1.0 - seam_distance / (albedo.shape[1] * 0.018), 0.0, 1.0)
    unpainted = np.clip((0.32 - saturation) / 0.32, 0.0, 1.0)
    seam_metal = seam[None, :] * unpainted * np.clip((0.82 - luminance) / 0.6, 0.0, 1.0)
    metalness = np.maximum(metalness, (seam_metal * 210.0).astype(np.uint8))

    grayscale = (luminance * 255.0).astype(np.uint8)
    low_frequency = cv2.GaussianBlur(grayscale, (0, 0), 4.0).astype(np.float32)
    high_frequency = grayscale.astype(np.float32) - low_frequency
    bump = np.clip(128.0 + high_frequency * 1.35, 92.0, 164.0).astype(np.uint8)
    return roughness, metalness, bump


def make_metal_maps(size: int = 512) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    rng = np.random.default_rng(121934)
    fine = rng.normal(0.0, 1.0, (size, size)).astype(np.float32)
    broad = seamless_blur(rng.normal(0.0, 1.0, (size, size)).astype(np.float32), 18)
    broad /= max(float(broad.std()), 1e-6)
    brushed_tile = np.tile(fine, (1, 3))
    brushed_tile = cv2.GaussianBlur(
        brushed_tile, (0, 0), sigmaX=12.0, sigmaY=0.55
    )
    brushed = brushed_tile[:, size : size * 2]
    brushed /= max(float(brushed.std()), 1e-6)

    tone = np.clip(166.0 + broad * 5.0 + brushed * 2.6, 138.0, 194.0)
    base = np.empty((size, size, 3), dtype=np.float32)
    base[..., 0] = tone * 0.96
    base[..., 1] = tone * 1.00
    base[..., 2] = tone * 1.01

    # Sparse tarnish and handling marks keep the generated metal close to the
    # photographed shoulder without baking directional studio light into it.
    for _ in range(28):
        x = int(rng.integers(0, size))
        y = int(rng.integers(0, size))
        radius = int(rng.integers(1, 4))
        color = (int(rng.integers(108, 148)),) * 3
        cv2.circle(base, (x, y), radius, color, -1, cv2.LINE_AA)
    base = np.clip(base, 0.0, 255.0).astype(np.uint8)

    roughness = np.clip(
        182.0 + broad * 12.0 + np.abs(brushed) * 9.0, 142.0, 232.0
    )
    roughness = roughness.astype(np.uint8)
    bump = np.clip(128.0 + brushed * 8.0 + broad * 2.5, 96.0, 160.0).astype(np.uint8)
    return base, roughness, bump


def save_webp(path: Path, image: np.ndarray, quality: int = 96) -> None:
    if not cv2.imwrite(str(path), image, [cv2.IMWRITE_WEBP_QUALITY, quality]):
        raise RuntimeError(f"Could not write {path}")


def main() -> None:
    args = parse_args()
    source = args.source.expanduser().resolve()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)

    albedo = reconstruct(source, args.width, args.height)
    roughness, metalness, bump = make_label_maps(albedo)
    pbr_width = min(args.width, 1024)
    pbr_height = round(args.height * pbr_width / args.width)
    if pbr_width != args.width:
        pbr_size = (pbr_width, pbr_height)
        roughness = cv2.resize(roughness, pbr_size, interpolation=cv2.INTER_AREA)
        metalness = cv2.resize(metalness, pbr_size, interpolation=cv2.INTER_AREA)
        bump = cv2.resize(bump, pbr_size, interpolation=cv2.INTER_AREA)
    metal_base, metal_roughness, metal_bump = make_metal_maps()

    save_webp(output / "label-albedo.webp", albedo)
    save_webp(output / "label-roughness.webp", roughness, 92)
    save_webp(output / "label-metalness.webp", metalness, 92)
    save_webp(output / "label-bump.webp", bump, 92)
    save_webp(output / "metal-base.webp", metal_base, 94)
    save_webp(output / "metal-roughness.webp", metal_roughness, 92)
    save_webp(output / "metal-bump.webp", metal_bump, 92)

    metadata = {
        "source_directory": source.name,
        "source_files": sorted(path.name for path in source.glob("*.ARW")),
        "output_size": [args.width, args.height],
        "pbr_map_size": [pbr_width, pbr_height],
        "projection": "lens-corrected full perspective projection of a pitched 3D cylinder",
        "camera_focal_length_pixels": CAMERA_FOCAL_LENGTH_PX,
        "camera_pitch_degrees": CAMERA_PITCH_DEGREES,
        "camera_distance_in_can_radii": {
            view.filename: camera_distance_for_view(view) for view in VIEWS
        },
        "body_height_in_radii": BODY_HEIGHT_IN_RADII,
        "lens_distortion": {
            "model": "ptlens",
            "coefficients": list(LENS_DISTORTION_PTLENS),
            "source": "embedded Sony FE 50 mm F1.2 GM RAW profile",
        },
        "intrinsic_albedo": {
            "method": "cross-orientation camera-space illumination separation",
            "white_reference_bands": True,
            "environment_vertical_bands": PHOTOMETRIC_BANDS,
            "environment_angle_bins": PHOTOMETRIC_THETA_BINS,
        },
        "cut_longitude_degrees": CUT_LONGITUDE_DEGREES,
        "front_u": ((360.0 - CUT_LONGITUDE_DEGREES) % 360.0) / 360.0,
        "loop_closure": LOOP_CLOSURE,
        "views": [asdict(view) for view in VIEWS],
        "geometry": {
            "units": "inches",
            "body_radius": 1.375,
            "body_height": 1.375 * BODY_HEIGHT_IN_RADII,
        },
    }
    (output / "reconstruction.json").write_text(
        json.dumps(metadata, indent=2) + "\n", encoding="utf-8"
    )

    print(f"Wrote Cold Shot reconstruction assets to {output}")


if __name__ == "__main__":
    main()
