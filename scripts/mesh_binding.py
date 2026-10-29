"""Source-art strip triangulation and persistent barycentric particle bindings."""
from bisect import bisect_right
import math

from PIL import Image
from native_layers import at


def make_mesh(part, frame_ids):
    source = part["targets"][frame_ids.index(part["source"])]
    left, right = min(source) - 0.75, max(source) + 0.75
    # Dense actual contour samples, not a fitted ellipse/lip stroke.
    count = max(3, math.ceil((right - left) / 2))
    critical = set()
    # Preserve painted lash spikes/corners instead of cutting across a 1px extremum.
    for x in sorted(source):
        before, value, after = at(source,x-1), at(source,x), at(source,x+1)
        if any(abs(before[j]+after[j]-2*value[j])>1 for j in (0,1)):
            critical.add(float(x))
    knots = {left,right} | critical
    for i in range(1,count):
        value = left+(right-left)*i/count
        if all(abs(value-x)>0.3 for x in critical): knots.add(value)
    xs = sorted(knots)
    rows = 4 if part.get("cage") else part["rows"]
    frames = []
    if part.get("cage"):
        opening = part["cage"]["opening"]
        top = min(min(v[0] for v in source.values()),min(v[0] for v in opening.values()))-2
        bottom = max(max(v[1] for v in source.values()),max(v[1] for v in opening.values()))+2
        for frame,target in enumerate(part["cage"]["targets"]):
            vertices = []
            collapsed = max(v[1]-v[0] for v in target.values())<0.01
            for row in range(rows):
                for x in xs:
                    a,b = at(opening,x)
                    a,b = a-0.8,b+0.8
                    ta,tb = at(target,x)
                    if not collapsed: ta,tb = ta-0.8,tb+0.8
                    outside = x<min(opening) or x>max(opening)
                    values = (top+ta-a,ta,tb,max(bottom,tb+2) if outside else bottom+tb-b)
                    # The painted outer wing has its own contour landmark. Blend
                    # it into the lid cage near corners; do not pull it into a whisker.
                    edge=min(x-min(opening),max(opening)-x)
                    wing=max(0,min(1,(18-edge)/18))
                    wing=wing*wing*(3-2*wing)
                    s0,s1=at(source,x)
                    t0,t1=at(part["targets"][frame],x)
                    factor=max(0.3,min(2,(t1-t0)/max(0.1,s1-s0)))
                    raw=t0+((top,a,b,bottom)[row]-s0)*factor
                    vertices.append((x,values[row]*(1-wing)+raw*wing))
            frames.append(vertices)
    else:
        for target in part["targets"]:
            a, b = min(target) - 0.75, max(target) + 0.75
            vertices = []
            collapse = max(v[1] - v[0] for v in target.values()) < 0.01
            pad = 0 if collapse else 0.8
            for row in range(rows):
                v = row / (rows - 1)
                for x in xs:
                    u = (x - left) / (right - left)
                    px = a + (b - a) * u
                    upper, lower = at(target, px)
                    py = upper - pad + v * (max(0, lower - upper) + pad * 2)
                    vertices.append((px, py))
            frames.append(vertices)
    canonical = frames[frame_ids.index(part["source"])]
    triangles = []
    stride = len(xs)
    for row in range(rows - 1):
        for col in range(len(xs) - 1):
            a = row * stride + col
            b, c, d = a + 1, a + stride, a + stride + 1
            triangles.extend(((a, b, c), (b, d, c)))
    return {"xs": xs, "rows": rows, "frames": frames, "source": canonical, "triangles": triangles}


def barycentric(point, a, b, c):
    ax, ay = a
    bx, by = b
    cx, cy = c
    denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(denominator) < 1e-9:
        return None
    first = ((by - cy) * (point[0] - cx) + (cx - bx) * (point[1] - cy)) / denominator
    second = ((cy - ay) * (point[0] - cx) + (ax - cx) * (point[1] - cy)) / denominator
    return first, second, 1 - first - second


def bind(mesh, point):
    xs, source = mesh["xs"], mesh["source"]
    col = max(0, min(len(xs) - 2, bisect_right(xs, point[0]) - 1))
    # Only the triangles in the candidate column need testing.
    for row in range(mesh["rows"] - 1):
        index = (row * (len(xs) - 1) + col) * 2
        for triangle in (index, index + 1):
            a, b, c = mesh["triangles"][triangle]
            weights = barycentric(point, source[a], source[b], source[c])
            if weights and min(weights) >= -1e-5:
                return triangle, weights
    return None


def pack_atlas(parts):
    width, x, y, row_height = 512, 1, 1, 0
    unique = {}
    tiles = []
    for part in parts:
        bounds = part["mask"].getbbox()
        left, top, right, bottom = bounds
        rig = part.get("rigBounds",bounds)
        box = (max(0, math.floor(min(left,rig[0]))-2),max(0,math.floor(min(top,rig[1]))-2),min(part["image"].width,math.ceil(max(right,rig[2]))+2),min(part["image"].height,math.ceil(max(bottom,rig[3]))+2))
        image = part["image"].crop(box)
        key = (box, image.tobytes())
        if key in unique:
            part["atlas"] = unique[key]
            continue
        if x + image.width + 1 > width:
            x, y, row_height = 1, y + row_height + 2, 0
        placement = {"x": x, "y": y, "width": image.width, "height": image.height, "sourceX": box[0], "sourceY": box[1]}
        unique[key] = placement
        part["atlas"] = placement
        tiles.append((image, x, y))
        x += image.width + 2
        row_height = max(row_height, image.height)
    height = 2 ** math.ceil(math.log2(y + row_height + 2))
    atlas = Image.new("RGBA", (width, height))
    for image, x, y in tiles:
        atlas.paste(image, (x, y))
    return atlas


def normalized_uv(point, placement, atlas_size):
    return ((point[0] - placement["sourceX"] + placement["x"] + 0.5) / atlas_size[0],
            (point[1] - placement["sourceY"] + placement["y"] + 0.5) / atlas_size[1])
