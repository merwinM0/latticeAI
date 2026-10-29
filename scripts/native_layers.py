"""Extract original painted pixels. Masks locate artwork; no generated strokes/colors."""
from collections import deque
import math

from PIL import Image, ImageChops, ImageDraw, ImageFilter
from character_geometry import bilinear, component, cubic, mask_of, pixels_where


def red(c):
    r, g, b, a = c
    return a > 128 and r > 70 and r > g * 1.35 and r > b * 1.18


def columns(mask):
    box = mask.getbbox()
    if not box:
        raise ValueError("Empty original-art mask")
    left, top, right, bottom = box
    pixels = mask.load()
    values = {}
    for x in range(left, right):
        ys = [y for y in range(top, bottom) if pixels[x, y] > 64]
        if ys:
            values[x] = (min(ys) - 0.6, max(ys) + 0.6)
    if len(values) < 3:
        raise ValueError("Painted part too small to rig")
    return values


def at(profile, x):
    keys = sorted(profile)
    x = min(keys[-1], max(keys[0], x))
    ix = int(math.floor(x))
    a = max((key for key in keys if key <= ix), default=keys[0])
    b = min((key for key in keys if key >= x), default=keys[-1])
    u = (x - a) / (b - a) if b != a else 0
    return tuple(profile[a][i] * (1 - u) + profile[b][i] * u for i in (0, 1))


def eye_window(image, eye):
    blue = pixels_where(image, eye["bounds"], lambda c: c[3] > 128 and c[2] >= 100 and c[2] > c[0] * 1.4 and c[2] > c[1] * 1.05)
    iris = component(blue, eye["seed"])
    candidates = pixels_where(image, eye["bounds"], lambda c: c[3] > 128 and c[0] > 150 and c[1] > 150 and max(c[:3])-min(c[:3]) < 45 and c[2] >= c[0] * 0.96 and c[2] >= c[1] * 0.98)
    near = mask_of(image.size, points=iris).filter(ImageFilter.MaxFilter(9))
    whites = {p for p in candidates if near.getpixel(p)}
    queue = deque(sorted(whites))
    while queue:
        x, y = queue.popleft()
        for p in ((x-1,y),(x+1,y),(x,y-1),(x,y+1),(x-1,y-1),(x+1,y-1),(x-1,y+1),(x+1,y+1)):
            if p in candidates and p not in whites:
                whites.add(p)
                queue.append(p)
    if len(iris) < 100 or not whites:
        raise ValueError(f"Cannot locate eye: {eye['name']}")
    points = iris | whites
    for x, y in pixels_where(image, eye["bounds"], lambda c: c[3] > 128 and c[2] > c[0] * 1.15 and c[2] > c[1] * 1.01):
        if near.getpixel((x, y)):
            points.add((x, y))
    raw = mask_of(image.size, points=points)
    prof = columns(raw)
    # Fill the actual per-column opening, not a convex ellipse or a Bezier replacement.
    mask = Image.new("L", image.size)
    draw = ImageDraw.Draw(mask)
    for x in range(min(prof), max(prof) + 1):
        upper, lower = at(prof, x)
        draw.line((x, math.ceil(upper), x, math.floor(lower)), fill=255)
    return mask


def material(c):
    r, g, b, a = c
    if a < 128:
        return "empty"
    if b > r * 1.15 and b > g * 1.03:
        return "hair"
    if r > 235 and g > 130 and b > 100 and r >= g * 0.97 and r >= b * 0.98:
        return "skin"
    return "other"


def inpaint_native(image, mask, skin_windows, protected):
    """Native color continuation with separate hair/skin fields and fixed boundaries.

    Only holes change. No misaligned frame borrowing or flat/quadratic skin plate.
    """
    mask = ImageChops.subtract(mask.filter(ImageFilter.MaxFilter(3)), protected)
    left, top, right, bottom = mask.getbbox()
    box = (max(0, left-48), max(0, top-48), min(image.width, right+48), min(image.height, bottom+48))
    source, holes, forced = image.crop(box), mask.crop(box), skin_windows.crop(box)
    w, h = source.size
    original, hole_values, force_values = list(source.getdata()), list(holes.getdata()), list(forced.getdata())
    classes = [material(c) if not hole else "unknown" for c, hole in zip(original, hole_values)]
    labels = [1 if force else 1 if c == "skin" else 2 if c == "hair" else 0 for c, force in zip(classes, force_values)]
    queue = deque(i for i, label in enumerate(labels) if label)
    def neighbors(i):
        x, y = i % w, i // w
        if x: yield i-1
        if x+1 < w: yield i+1
        if y: yield i-w
        if y+1 < h: yield i+w
    while queue:
        i = queue.popleft()
        for other in neighbors(i):
            if not labels[other]:
                labels[other] = labels[i]
                queue.append(other)
    fills = {}
    for name in ("skin", "hair"):
        known = [c == name for c in classes]
        values, seen = [c[:3] for c in original], known.copy()
        queue = deque(i for i, valid in enumerate(known) if valid)
        while queue:
            i = queue.popleft()
            for other in neighbors(i):
                if not seen[other]:
                    seen[other] = True
                    values[other] = values[i]
                    queue.append(other)
        filled = Image.new("RGB", source.size)
        filled.putdata(values)
        fixed = Image.new("L", source.size)
        fixed.putdata([255 if value else 0 for value in known])
        rgb = source.convert("RGB")
        for _ in range(110):
            filled = Image.composite(rgb, filled.filter(ImageFilter.GaussianBlur(2.5)), fixed)
        fills[name] = list(filled.getdata())
    output = source.copy()
    output.putdata([(*fills["skin" if labels[i] == 1 else "hair"][i], c[3]) if hole_values[i] else c for i, c in enumerate(original)])
    result = image.copy()
    result.paste(output, box)
    return result


def restore_hair_edges(original, clean, brow_holes, paths):
    """Clone intact native cross-sections across the short hidden brow crossings."""
    result = clean.copy()
    touched = brow_holes.filter(ImageFilter.MaxFilter(5))
    excluded = brow_holes.filter(ImageFilter.MaxFilter(13))
    for path in paths:
        samples = []
        for a, b in zip(path, path[1:]):
            dx, dy = b[0]-a[0], b[1]-a[1]
            length = math.hypot(dx, dy)
            nx, ny = -dy/length, dx/length
            for i in range(math.ceil(length)):
                x, y = a[0]+dx*i/length, a[1]+dy*i/length
                valid = not excluded.getpixel((round(x), round(y)))
                if valid:
                    offset = min(range(-6, 7), key=lambda d: sum(bilinear(original, x+nx*d, y+ny*d)[:3]))
                    x, y = x+nx*offset, y+ny*offset
                samples.append((x, y, nx, ny, valid))
        valid_indices = [i for i, value in enumerate(samples) if value[4]]
        for i, value in enumerate(samples):
            if value[4]: continue
            before = max((j for j in valid_indices if j < i), default=None)
            after = min((j for j in valid_indices if j > i), default=None)
            if before is None or after is None: continue
            a, b = samples[before], samples[after]
            u = (i-before)/(after-before)
            x, y = a[0]*(1-u)+b[0]*u, a[1]*(1-u)+b[1]*u
            nx, ny = a[2]*(1-u)+b[2]*u, a[3]*(1-u)+b[3]*u
            for offset in range(-7, 8):
                px, py = round(x+nx*offset), round(y+ny*offset)
                if touched.getpixel((px, py)):
                    ca = bilinear(original, a[0]+a[2]*offset, a[1]+a[3]*offset)
                    cb = bilinear(original, b[0]+b[2]*offset, b[1]+b[3]*offset)
                    result.putpixel((px, py), tuple(round(c*(1-u)+d*u) for c, d in zip(ca, cb)))
    return result


def painted(image, mask):
    result = image.copy()
    result.putalpha(ImageChops.multiply(image.getchannel("A"), mask))
    return result


def brow_mask(image, brow, pose):
    guide = brow[pose]
    left, right = guide["span"]
    points = set()
    for x, y in pixels_where(image, brow["bounds"], lambda c: c[3] > 128 and c[2] > c[0] * 1.3 and c[2] > c[1] * 1.1 and c[2] < 135):
        u = max(0, min(1, (x - left) / (right - left)))
        if abs(y - cubic(guide["curve"], u)) < 5:
            points.add((x, y))
    return mask_of(image.size, points=points)


def unmatte_paint(part, background):
    """Remove skin/hair contamination from flattened paint AA, using native pixels.

    C = alpha*F + (1-alpha)*B. Strong pigment stays literal; weak edges borrow only
    a nearby native pigment to estimate alpha. No preset ink or lip color.
    """
    source,mask = part["image"],part["mask"]
    result = Image.new("RGBA",source.size)
    box = mask.getbbox()
    for y in range(box[1],box[3]):
        for x in range(box[0],box[2]):
            c = source.getpixel((x,y))
            if not c[3]: continue
            bg = background.getpixel((x,y))
            strength = max(abs(c[i]-bg[i]) for i in range(3))
            if strength<8: continue
            alpha=1.0
            if strength<105:
                candidates=[]
                for yy in range(max(box[1],y-3),min(box[3],y+4)):
                    for xx in range(max(box[0],x-3),min(box[2],x+4)):
                        p=source.getpixel((xx,yy))
                        if not p[3]: continue
                        b=background.getpixel((xx,yy))
                        value=max(abs(p[i]-b[i]) for i in range(3))
                        if value>strength+20: candidates.append(((xx-x)**2+(yy-y)**2,p))
                if candidates:
                    pigment=min(candidates,key=lambda p:p[0])[1]
                    delta=[pigment[i]-bg[i] for i in range(3)]
                    alpha=max(0.01,min(1,sum((c[i]-bg[i])*delta[i] for i in range(3))/max(1,sum(v*v for v in delta))))
                    required=max((bg[i]-c[i])/max(1,bg[i]) if c[i]<bg[i] else (c[i]-bg[i])/max(1,255-bg[i]) for i in range(3))
                    alpha=max(alpha,required)
            foreground=tuple(max(0,min(255,round((c[i]-(1-alpha)*bg[i])/alpha))) for i in range(3))
            result.putpixel((x,y),(*foreground,round(c[3]*alpha)))
    return result


def align_profile(profile, reference):
    a, b = min(profile), max(profile)
    left, right = min(reference), max(reference)
    return {x: at(profile, a+(b-a)*(x-left)/(right-left)) for x in range(left, right+1)}


def preserve_stroke(source, target):
    a, b = min(source), max(source)
    left, right = min(target), max(target)
    result = {}
    for x in range(left, right+1):
        top, bottom = at(source, a+(b-a)*(x-left)/(right-left))
        mid = sum(at(target,x))/2
        result[x] = (mid-(bottom-top)/2, mid+(bottom-top)/2)
    return result


def extract(images, config):
    ref = images["rest"]
    removal, skin_windows, brow_holes = Image.new("L", ref.size), Image.new("L", ref.size), Image.new("L", ref.size)
    static_hair = Image.new("L", ref.size)
    hair_draw = ImageDraw.Draw(static_hair)
    for polygon in config["staticHairPolygons"]:
        hair_draw.polygon([tuple(point) for point in polygon], fill=255)
    raw_windows = [eye_window(ref,eye) for eye in config["eyes"]]
    eye_exclusion = ImageChops.lighter(*raw_windows).filter(ImageFilter.MaxFilter(9))
    hair_core = Image.new("L",ref.size)
    hair_core.putdata([255 if c[2]>100 and c[1]>55 and c[2]>c[0]*1.4 and c[1]>c[0]*1.12 and not excluded else 0 for c,excluded in zip(ref.getdata(),eye_exclusion.getdata())])
    # Include the native dark hair outline, not just blue interiors. This keeps
    # nearby hair tips from being misclassified as long, animated lash spikes.
    static_hair = ImageChops.lighter(static_hair,hair_core.filter(ImageFilter.MaxFilter(5)))
    geometry_hair = static_hair.copy()
    protected = Image.new("L", ref.size)
    draw = ImageDraw.Draw(protected)
    for path in config["protectedHairEdges"]:
        draw.line([tuple(point) for point in path], fill=255, width=4)
    parts = []
    def add(name, region, kind, source, mask, targets, role="paint", rows=3):
        if not mask.getbbox():
            return
        parts.append(dict(name=name, region=region, kind=kind, source=source, mask=mask, image=painted(images[source], mask), targets=targets, role=role, rows=rows))
        return parts[-1]

    for eye in config["eyes"]:
        region, name = eye["id"], eye["name"]
        window = ImageChops.subtract(raw_windows[region-1], static_hair)
        sad = eye_window(images["sad"], eye)
        crease = mask_of(ref.size,points=pixels_where(ref,eye["creaseBounds"],lambda c:red(c) and c[0]>150 and max(c[:3])<248))
        lash_area = mask_of(ref.size, polygon=eye["lashPolygon"]).filter(ImageFilter.MaxFilter(7))
        native_ink = mask_of(ref.size, points=pixels_where(ref, eye["bounds"], lambda c: c[3] > 128 and max(c[:3]) < 238))
        ink = ImageChops.multiply(lash_area, native_ink)
        cool_hair = mask_of(ref.size, points=pixels_where(ref, eye["bounds"], lambda c: c[2] > 60 and c[1] >= c[0]*1.18 and c[2] > c[0]*1.4))
        ink = ImageChops.subtract(ink, ImageChops.lighter(static_hair, ImageChops.lighter(protected, cool_hair)))
        crease = ImageChops.subtract(crease, protected)
        # Materials are disjoint: no iris blue or crease paint is stretched as lash.
        ink = ImageChops.subtract(ink, ImageChops.lighter(window, crease))
        normal_lash = columns(ink)
        closed_gate = mask_of(ref.size, polygon=eye["closedLashPolygon"]).filter(ImageFilter.MaxFilter(3))
        closed_pixels = mask_of(ref.size, points=pixels_where(images["blink"], eye["bounds"], lambda c: c[3] > 128 and max(c[:3]) < 239))
        native_closed = align_profile(columns(ImageChops.multiply(closed_gate,closed_pixels)),normal_lash)
        native_closed = {x:tuple(sum(at(native_closed,x+d)[i]*w for d,w in zip(range(-2,3),(1,2,3,2,1)))/9 for i in (0,1)) for x in native_closed}
        opened = columns(window)
        sad_opened = align_profile(columns(sad),opened)
        # Both lid and aperture meet the same native closed-lash edge. Horizontal
        # anchors remain on the reference face; the rigid iris never squashes.
        collapse = {x: (at(native_closed,x)[1],at(native_closed,x)[1]) for x in opened}
        window_targets = [sad_opened if f["id"] == "sad" else collapse if f["id"] == "blink" else opened for f in config["frames"]]
        add(name+"-window",region,0,"rest",window,window_targets,"window-left" if region==1 else "window-right",5)
        add(name+"-surface",region,1,"rest",window,[opened]*7,"eye-left" if region==1 else "eye-right",2)
        sad_lash = {x: tuple(y+at(sad_opened,x)[0]-at(opened,x)[0] for y in values) for x,values in normal_lash.items()}
        lash_targets = [sad_lash if f["id"]=="sad" else native_closed if f["id"]=="blink" else normal_lash for f in config["frames"]]
        lid = add(name+"-lash",region,3,"rest",ink,lash_targets)
        lid["cage"] = {"opening": opened, "targets": window_targets}
        if crease.getbbox():
            normal = columns(crease)
            samples = [min(normal_lash)+(max(normal_lash)-min(normal_lash))*u/10 for u in range(2,9)]
            shift = sum(at(native_closed,x)[0]-at(normal_lash,x)[0] for x in samples)/len(samples)*0.55
            # Native fine strokes keep their thickness and relative spacing.
            closed = {x:(a+shift,b+shift) for x,(a,b) in normal.items()}
            add(name+"-crease",region,3,"rest",crease,[closed if f["id"]=="blink" else normal for f in config["frames"]])
        erased = ImageChops.lighter(window, ImageChops.lighter(lash_area, crease)).filter(ImageFilter.MaxFilter(5))
        removal = ImageChops.lighter(removal, erased)
        skin_windows = ImageChops.lighter(skin_windows, ImageChops.subtract(erased, geometry_hair))

    bounds = config["mouth"]["bounds"]
    mouths = {}
    for name, im in images.items():
        local_bounds = config["mouth"]["closedBounds"] if name in ("rest","sad") else bounds
        points = pixels_where(im, local_bounds, lambda c: c[3] > 128 and c[0] > 50 and c[0] > c[1]*1.12 and c[0] > c[2]*1.10 and (c[1] < 195 or c[2] < 185 or c[0] < 246))
        candidate = mask_of(ref.size, points=points)
        if name in ("rest","sad"):
            near = candidate.filter(ImageFilter.MaxFilter(13))
            points |= pixels_where(im,local_bounds,lambda c:c[3]>128 and c[0]>c[1]*1.12 and c[0]>c[2]*1.10)
            candidate = ImageChops.multiply(mask_of(ref.size,points=points),near)
        else:
            candidate = mask_of(ref.size,points=component(points))
        filled = Image.new("L", ref.size)
        draw = ImageDraw.Draw(filled)
        for x, (upper, lower) in columns(candidate).items():
            draw.line((x, math.ceil(upper), x, math.floor(lower)), fill=255)
        mouths[name] = filled
    profiles = {name: columns(mask) for name, mask in mouths.items()}
    upper_masks, lower_masks = {}, {}
    upper_profiles, lower_profiles, holes = {}, {}, {}
    for name, mask in mouths.items():
        prof = profiles[name]
        upper, lower, inside = Image.new("L", ref.size), Image.new("L", ref.size), Image.new("L", ref.size)
        up, low, hole = {}, {}, {}
        for x in range(min(prof), max(prof) + 1):
            top, bottom = at(prof, x)
            gap = bottom - top
            thickness = min(2.3, gap / 2)
            if name in ("rest", "sad"):
                mid = (top + bottom) / 2
                up[x], low[x], hole[x] = (top, mid), (mid, bottom), (mid, mid)
            else:
                up[x], low[x], hole[x] = (top, top + thickness), (bottom - thickness, bottom), (top + thickness, bottom - thickness)
            for y in range(max(0, int(top)), min(ref.height, math.ceil(bottom) + 1)):
                if not mask.getpixel((x, y)):
                    continue
                if y <= up[x][1]: upper.putpixel((x, y), 255)
                elif y >= low[x][0]: lower.putpixel((x, y), 255)
                else: inside.putpixel((x, y), 255)
        upper_masks[name], lower_masks[name] = upper, lower
        upper_profiles[name], lower_profiles[name], holes[name] = up, low, hole
    # Exact colored rest-frame lip strokes, NOT constant-color generated curves.
    add("upper-lip", 3, 5, "rest", upper_masks["rest"], [upper_profiles[f["id"]] for f in config["frames"]], rows=2)
    add("lower-lip", 3, 6, "rest", lower_masks["rest"], [lower_profiles[f["id"]] for f in config["frames"]], rows=2)
    # Quiet speech is the canonical cavity: its point spacing matches the body
    # at the common pose, instead of crushing a large-open grid into a fine patch.
    inner_mask = ImageChops.subtract(mouths["soft"],ImageChops.lighter(upper_masks["soft"],lower_masks["soft"]))
    add("mouth-window",3,0,"soft",inner_mask,[holes[f["id"]] for f in config["frames"]],"window-mouth",5)
    add("mouth-inside",3,7,"soft",inner_mask,[holes[f["id"]] for f in config["frames"]],"mouth",5)
    removal = ImageChops.lighter(removal, mouths["rest"])
    for brow in config["brows"]:
        raw = brow_mask(ref, brow, "rest")
        brow_holes = ImageChops.lighter(brow_holes, raw)
        mask = ImageChops.subtract(raw, protected)
        sad_mask = brow_mask(images["sad"], brow, "sad")
        normal = columns(mask)
        sad_target = preserve_stroke(normal,columns(sad_mask))
        targets = [sad_target if f["id"] == "sad" else normal for f in config["frames"]]
        add(brow["name"], brow["id"], 8, "rest", mask, targets)
        removal = ImageChops.lighter(removal, mask)
    order = {"window-left": 0, "window-right": 0, "window-mouth": 0, "eye-left": 1, "eye-right": 1, "mouth": 2, "paint": 3}
    parts.sort(key=lambda p: (order[p["role"]], p["region"], p["kind"]))
    removal = ImageChops.lighter(removal, brow_holes)
    hair_guard = Image.new("L", ref.size)
    hair_guard.putdata([255 if c[2] > 60 and c[1] >= c[0]*1.18 and c[2] > c[0]*1.4 and not window else 0 for c, window in zip(ref.getdata(), skin_windows.getdata())])
    protection = ImageChops.subtract(ImageChops.lighter(static_hair, ImageChops.lighter(protected, hair_guard)), brow_holes.filter(ImageFilter.MaxFilter(5)))
    removal = ImageChops.subtract(removal, protection)
    clean = inpaint_native(ref, removal, skin_windows, protection)
    clean = restore_hair_edges(ref, clean, brow_holes, config["protectedHairEdges"])
    for part in parts:
        if part["source"]=="rest" and part["kind"] in (3,5,6,8):
            part["image"] = unmatte_paint(part,clean)
    return clean, parts
