"""Deterministic offline sampling and native-pixel mask helpers (Pillow only)."""
from collections import deque
import math

from PIL import Image, ImageDraw


def bilinear(image, x, y):
    w, h = image.size
    x, y = min(w-1, max(0, x)), min(h-1, max(0, y))
    ix, iy = int(x), int(y)
    dx, dy = x-ix, y-iy
    p = image.load()
    values = [p[ix,iy],p[min(ix+1,w-1),iy],p[ix,min(iy+1,h-1)],p[min(ix+1,w-1),min(iy+1,h-1)]]
    weights = [(1-dx)*(1-dy),dx*(1-dy),(1-dx)*dy,dx*dy]
    return tuple(round(sum(value[c]*weight for value,weight in zip(values,weights))) for c in range(4))


def grid(bounds, spacing, rng):
    left, top, right, bottom = bounds
    for row in range(math.ceil((bottom-top)/spacing)):
        for col in range(math.ceil((right-left)/spacing)):
            x = left+(col+0.5+rng.uniform(-0.3,0.3))*spacing
            y = top+(row+0.5+rng.uniform(-0.3,0.3))*spacing
            if x<right and y<bottom:
                yield x,y


def cubic(values, u):
    # Segmentation guide for the native eyebrow pixels, NEVER a painted stroke.
    v = 1-u
    return v**3*values[0]+3*v*v*u*values[1]+3*v*u*u*values[2]+u**3*values[3]


def pixels_where(image, bounds, predicate):
    p = image.load()
    left, top, right, bottom = bounds
    return {(x,y) for y in range(top,bottom) for x in range(left,right) if predicate(p[x,y])}


def component(points, seed=None):
    remaining = set(points)
    groups = []
    while remaining:
        origin = min(remaining) if seed is None else min(remaining,key=lambda p:(p[0]-seed[0])**2+(p[1]-seed[1])**2)
        group = set()
        queue = deque([origin])
        remaining.remove(origin)
        while queue:
            x,y = queue.popleft()
            group.add((x,y))
            for neighbor in ((x-1,y),(x+1,y),(x,y-1),(x,y+1),(x-1,y-1),(x+1,y-1),(x-1,y+1),(x+1,y+1)):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    queue.append(neighbor)
        if seed is not None:
            return group
        groups.append(group)
    return max(groups,key=len) if groups else set()


def mask_of(size, points=None, polygon=None):
    mask = Image.new("L",size)
    draw = ImageDraw.Draw(mask)
    if polygon:
        draw.polygon(polygon,fill=255)
    if points:
        for point in points:
            draw.point(point,fill=255)
    return mask
