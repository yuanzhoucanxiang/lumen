from pathlib import Path
from collections import defaultdict
import math

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "build" / "raven-icon-source.png"
OUT_DIR = ROOT / "design-proposals" / "icon-raven-photo-vector"
SVG_PATH = OUT_DIR / "raven-vector-traced-v1.svg"
MASK_PATH = OUT_DIR / "raven-vector-traced-v1-mask.png"
FORMAL_SVG_PATH = ROOT / "build" / "raven-icon-source.svg"


def largest_component(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask, structure=np.ones((3, 3), dtype=np.uint8))
    if count == 0:
        raise RuntimeError("No foreground component found")
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    return labels == int(np.argmax(sizes))


def marching_segments(mask: np.ndarray):
    # Corner bits: top-left=1, top-right=2, bottom-right=4, bottom-left=8.
    table = {
        1: (("l", "t"),),
        2: (("t", "r"),),
        3: (("l", "r"),),
        4: (("r", "b"),),
        5: (("l", "t"), ("r", "b")),
        6: (("t", "b"),),
        7: (("l", "b"),),
        8: (("b", "l"),),
        9: (("t", "b"),),
        10: (("t", "r"), ("b", "l")),
        11: (("r", "b"),),
        12: (("l", "r"),),
        13: (("t", "r"),),
        14: (("l", "t"),),
    }

    def edge_point(edge, x, y):
        if edge == "t":
            return (x + 0.5, y)
        if edge == "r":
            return (x + 1.0, y + 0.5)
        if edge == "b":
            return (x + 0.5, y + 1.0)
        return (x, y + 0.5)

    segments = []
    height, width = mask.shape
    for y in range(height - 1):
        for x in range(width - 1):
            case = (
                (1 if mask[y, x] else 0)
                | (2 if mask[y, x + 1] else 0)
                | (4 if mask[y + 1, x + 1] else 0)
                | (8 if mask[y + 1, x] else 0)
            )
            for first, second in table.get(case, ()):
                segments.append((edge_point(first, x, y), edge_point(second, x, y)))
    return segments


def segment_loops(segments):
    adjacency = defaultdict(list)
    for first, second in segments:
        adjacency[first].append(second)
        adjacency[second].append(first)

    unused = {frozenset((first, second)) for first, second in segments}
    loops = []
    while unused:
        edge = next(iter(unused))
        first, second = tuple(edge)
        unused.remove(edge)
        points = [first, second]
        previous, current = first, second

        while current != first:
            candidates = adjacency[current]
            next_point = None
            for candidate in candidates:
                candidate_edge = frozenset((current, candidate))
                if candidate != previous and candidate_edge in unused:
                    next_point = candidate
                    break
            if next_point is None:
                break
            unused.remove(frozenset((current, next_point)))
            points.append(next_point)
            previous, current = current, next_point

        if len(points) > 12 and points[-1] == points[0]:
            loops.append(points[:-1])
    return loops


def polygon_area(points):
    return 0.5 * sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    )


def point_line_distance(point, start, end):
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.dist(point, start)
    return abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]) / math.hypot(dx, dy)


def rdp(points, tolerance):
    if len(points) <= 2:
        return points
    start, end = points[0], points[-1]
    distances = [point_line_distance(point, start, end) for point in points[1:-1]]
    if not distances:
        return [start, end]
    max_distance = max(distances)
    index = distances.index(max_distance) + 1
    if max_distance <= tolerance:
        return [start, end]
    left = rdp(points[: index + 1], tolerance)
    right = rdp(points[index:], tolerance)
    return left[:-1] + right


def simplify_closed(points, tolerance=1.15):
    anchor = min(range(len(points)), key=lambda index: (points[index][0], points[index][1]))
    rotated = points[anchor:] + points[:anchor]
    farthest = max(range(1, len(rotated)), key=lambda index: math.dist(rotated[0], rotated[index]))
    first_half = rdp(rotated[: farthest + 1], tolerance)
    second_half = rdp(rotated[farthest:] + [rotated[0]], tolerance)
    return first_half[:-1] + second_half[:-1]


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("L")
    pixels = np.asarray(source)
    height, width = pixels.shape
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    crop = pixels[top : top + side, left : left + side]

    # The photograph has a very clear tonal gap: raven below 92, sky well above it.
    mask = largest_component(crop < 92)
    mask = ndimage.binary_fill_holes(mask)
    softened = ndimage.gaussian_filter(mask.astype(np.float32), sigma=0.72) >= 0.5
    mask = largest_component(softened)

    padded = np.pad(mask, 1, constant_values=False)
    loops = segment_loops(marching_segments(padded))
    if not loops:
        raise RuntimeError("Unable to trace a closed silhouette")
    outline = max(loops, key=lambda points: abs(polygon_area(points)))
    outline = [(x - 1, y - 1) for x, y in outline]
    outline = simplify_closed(outline)

    scale = 480.0 / side
    svg_points = [(16 + x * scale, 16 + y * scale) for x, y in outline]
    commands = [f"M {svg_points[0][0]:.2f} {svg_points[0][1]:.2f}"]
    commands.extend(f"L {x:.2f} {y:.2f}" for x, y in svg_points[1:])
    commands.append("Z")
    path_data = " ".join(commands)

    svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="title desc">
  <title id="title">Raven photograph silhouette trace</title>
  <desc id="desc">A vector contour traced from the supplied raven photograph, including its raised claw.</desc>
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#d7d8d9"/>
      <stop offset="0.55" stop-color="#bfc1c2"/>
      <stop offset="1" stop-color="#a7aaac"/>
    </linearGradient>
    <linearGradient id="bird" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#141619"/>
      <stop offset="0.58" stop-color="#090a0c"/>
      <stop offset="1" stop-color="#030405"/>
    </linearGradient>
    <clipPath id="tile"><rect x="16" y="16" width="480" height="480" rx="78"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect x="16" y="16" width="480" height="480" fill="url(#sky)"/>
    <path d="{path_data}" fill="url(#bird)"/>
  </g>
</svg>
'''
    SVG_PATH.write_text(svg, encoding="utf-8")
    FORMAL_SVG_PATH.write_text(svg, encoding="utf-8")

    preview = np.full((side, side, 3), 194, dtype=np.uint8)
    preview[mask] = (7, 8, 10)
    Image.fromarray(preview).save(MASK_PATH)
    print(SVG_PATH)
    print(FORMAL_SVG_PATH)
    print(MASK_PATH)
    print(f"nodes={len(svg_points)} threshold=92 crop={side}x{side}")


if __name__ == "__main__":
    main()
