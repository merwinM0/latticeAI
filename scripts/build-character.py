#!/usr/bin/env python3
"""Compile native painted layers, triangle bindings and inspectable review assets.

Python/Pillow are build-time only. No synthetic eyes, lips or constant stroke colors.
"""
import argparse
from array import array
import hashlib
from io import BytesIO
import json
import math
from pathlib import Path
import random
import struct
import sys

from PIL import Image, __version__ as PILLOW_VERSION
from character_geometry import grid
from native_layers import extract
from mesh_binding import bind, make_mesh, normalized_uv, pack_atlas

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src/images"
OUTPUT = ROOT / "src/client/particles/generated"
FRAMES = ["rest", "soft", "open", "round", "sad", "happy", "blink"]


def sample(image, x, y):
    """Premultiplied interpolation avoids sampling hidden skin/black edge RGB."""
    x, y = min(image.width - 1, max(0, x)), min(image.height - 1, max(0, y))
    ix, iy = int(x), int(y)
    dx, dy = x - ix, y - iy
    p = image.load()
    points = [p[ix, iy], p[min(ix + 1, image.width - 1), iy], p[ix, min(iy + 1, image.height - 1)], p[min(ix + 1, image.width - 1), min(iy + 1, image.height - 1)]]
    weights = [(1-dx)*(1-dy), dx*(1-dy), (1-dx)*dy, dx*dy]
    alpha = sum(c[3] * w for c, w in zip(points, weights))
    rgb = [round(sum(c[channel] * c[3] * w for c, w in zip(points, weights)) / alpha) if alpha else 0 for channel in range(3)]
    return (*rgb, round(alpha))


def poisson_points(image, bounds, spacing, rng):
    """Stable blue-noise cavity points do not form columns when the jaw compresses."""
    left,top,right,bottom=bounds
    wanted=max(1,round(sum(image.getchannel("A").crop(bounds).histogram()[32:])/(spacing*spacing)))
    distance=spacing*0.75
    cell=distance/math.sqrt(2)
    cells={}
    accepted=0
    for _ in range(wanted*60):
        x,y=rng.uniform(left,right-0.01),rng.uniform(top,bottom-0.01)
        if image.getpixel((int(x),int(y)))[3]<64: continue
        cx,cy=math.floor(x/cell),math.floor(y/cell)
        if any((x-p[0])**2+(y-p[1])**2<distance*distance for xx in range(cx-2,cx+3) for yy in range(cy-2,cy+3) for p in cells.get((xx,yy),[])): continue
        cells.setdefault((cx,cy),[]).append((x,y))
        yield x,y
        accepted+=1
        if accepted>=wanted: break


def build():
    config = json.loads((SOURCE / "character.json").read_text())
    if config["version"] != 3 or [f["id"] for f in config["frames"]] != FRAMES:
        raise ValueError("Expected native-mesh rig version 3 and ordered seven frames")
    images = {f["id"]: Image.open(SOURCE / f["file"]).convert("RGBA") for f in config["frames"]}
    if len({im.size for im in images.values()}) != 1:
        raise ValueError("Keyframes must have the same aligned canvas")
    width, height = images["rest"].size
    if [e["id"] for e in config["eyes"]]!=[1,2] or [b["id"] for b in config["brows"]]!=[4,5] or config["mouth"]["id"]!=3:
        raise ValueError("Expected two eyes, one mouth and two brows")
    clean, parts = extract(images, config)
    meshes = [make_mesh(part, FRAMES) for part in parts]
    for part, mesh in zip(parts,meshes):
        xs,ys = zip(*mesh["source"])
        part["rigBounds"] = (min(xs),min(ys),max(xs),max(ys))
        for frame,vertices in enumerate(mesh["frames"]):
            if any(not math.isfinite(x+y) or not 0<=x<=width or not 0<=y<=height for x,y in vertices):
                raise ValueError(f"Out-of-bounds mesh: {part['name']}, frame {frame}")
            for ia,ib,ic in mesh["triangles"]:
                a,b,c=vertices[ia],vertices[ib],vertices[ic]
                area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
                if area < -0.00001 or (frame==FRAMES.index(part["source"]) and area<=0.00000001):
                    raise ValueError(f"Folded/degenerate source mesh: {part['name']}, frame {frame}")
    atlas = pack_atlas(parts)
    vertex_count = sum(len(m["source"]) for m in meshes)
    triangle_count = sum(len(m["triangles"]) for m in meshes)
    if vertex_count>16000 or triangle_count>60000 or max(atlas.size)>2048:
        raise ValueError("Character mesh/atlas exceeds limits")
    vertices = [[] for _ in FRAMES]
    uv, triangles, layers = [], [], []
    vertex_start = triangle_start = 0
    for index, (part, mesh) in enumerate(zip(parts, meshes)):
        part["vertexStart"], part["triangleStart"] = vertex_start, triangle_start
        for frame, values in enumerate(mesh["frames"]):
            for x, y in values:
                vertices[frame].extend((x / width, y / height))
        for point in mesh["source"]:
            uv.extend(normalized_uv(point, part["atlas"], atlas.size))
        for tri in mesh["triangles"]:
            triangles.extend(vertex_start + corner for corner in tri)
        layers.append({"id": index + 1, "name": part["name"], "region": part["region"], "kind": part["kind"], "role": part["role"],
                       "deformation": "lid-cage" if part.get("cage") else "native-strip", "sourceFrame": FRAMES.index(part["source"]), "vertexStart": vertex_start, "vertexCount": len(mesh["source"]),
                       "triangleStart": triangle_start, "triangleCount": len(mesh["triangles"]), "atlas": part["atlas"]})
        vertex_start += len(mesh["source"])
        triangle_start += len(mesh["triangles"])
    rng = random.Random(104729)
    positions, colors, metadata, bindings, layer_ids = [], [], [], [], []
    def add(x, y, color, region, kind, spacing, layer=0, triangle=65535, bary=(0, 0, 1)):
        positions.extend((round(x / width * 65535), round(y / height * 65535)))
        colors.extend(color)
        metadata.extend((region, rng.randrange(256), round(spacing * 32), kind))
        a, b = round(max(0, bary[0]) * 65535), round(max(0, bary[1]) * 65535)
        if a + b > 65535: b = 65535 - a
        bindings.extend((triangle, a, b))
        layer_ids.append(layer)
    spacing = config["bodySpacing"]
    if not 1 <= spacing <= 7:
        raise ValueError("Invalid particle spacing")
    for x, y in grid((0, 0, width, height), spacing, rng):
        color = sample(clean, x, y)
        if color[3] >= 128: add(x, y, color, 0, 0, spacing)
    body_count = len(layer_ids)
    for index, (part, mesh) in enumerate(zip(parts, meshes)):
        if part["role"].startswith("window"):
            continue
        box = part["mask"].getbbox()
        area = sum(part["mask"].histogram()[128:])
        spacing = 2.0 if area < 1000 else config["bodySpacing"]
        points = poisson_points(part["image"],box,spacing,rng) if part["role"]=="mouth" else grid(box,spacing,rng)
        for x, y in points:
            color = sample(part["image"], x, y)
            if color[3] < 32:
                continue
            binding = bind(mesh, (x, y))
            if binding is None:
                continue
            triangle, bary = binding
            kind = part["kind"]
            if part["role"].startswith("eye-"):
                eye = config["eyes"][part["region"] - 1]
                cx, cy, rx, ry = eye["iris"]
                kind = 2 if ((x-cx)/rx)**2 + ((y-cy)/ry)**2 < 1 else 1
            add(x, y, color, part["region"], kind, spacing, index+1, part["triangleStart"]+triangle, bary)
    count = len(layer_ids)
    if count>200000:
        raise ValueError("Too many particles; increase bodySpacing")
    sections, binary = {}, bytearray()
    def section(name, values, code):
        while len(binary) % 4: binary.append(0)
        data = array(code, values)
        if sys.byteorder != "little": data.byteswap()
        sections[name] = {"offset": len(binary), "length": len(data), "type": code}
        binary.extend(data.tobytes())
    section("positions", positions, "H")
    section("colors", colors, "B")
    section("metadata", metadata, "B")
    section("bindings", bindings, "H")
    section("layerIds", layer_ids, "B")
    section("vertices", [v for frame in vertices for v in frame], "f")
    section("uv", uv, "f")
    section("triangles", triangles, "H")
    section("atlas", atlas.tobytes(), "B")
    descriptor = {"version": 3, "width": width, "height": height, "count": count, "bodyCount": body_count,
                  "featureCount": count-body_count, "frameCount": 7, "vertexCount": vertex_count, "triangleCount": triangle_count,
                  "atlasWidth": atlas.width, "atlasHeight": atlas.height, "layers": layers, "sections": sections}
    encoded = json.dumps(descriptor, separators=(",", ":"), ensure_ascii=False).encode()
    encoded += b" " * (-len(encoded) % 4)
    payload = struct.pack("<8sII", b"LATMSH03", len(encoded), len(binary)) + encoded + binary
    manifest = {k: v for k, v in descriptor.items() if k != "sections"}
    manifest.update(bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest(),pillowVersion=PILLOW_VERSION,
                    configSha256=hashlib.sha256((SOURCE/"character.json").read_bytes()).hexdigest(),
                    generators={name:hashlib.sha256((ROOT/"scripts"/name).read_bytes()).hexdigest() for name in ("build-character.py","native_layers.py","mesh_binding.py","character_geometry.py","requirements.txt")}, 
                    frames=[{**f, "sha256": hashlib.sha256((SOURCE/f["file"]).read_bytes()).hexdigest()} for f in config["frames"]],
                    invariants=["Native paint with edge decontamination", "No generated lip/lid strokes", "Persistent triangle + barycentric bindings", "Shared native/particle deformation", "Native alpha-matte occlusion"])
    return payload, (json.dumps(manifest, ensure_ascii=False, indent=2)+"\n").encode(), clean, atlas, parts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--preview-dir", type=Path)
    args = parser.parse_args()
    payload, manifest, clean, atlas, parts = build()
    outputs = {"character.bin":payload}
    for name,image in (("clean-base.png",clean),("art-atlas.png",atlas)):
        encoded=BytesIO();image.save(encoded,format="PNG");outputs[name]=encoded.getvalue()
    metadata=json.loads(manifest)
    metadata["reviewAssets"]={name:hashlib.sha256(value).hexdigest() for name,value in outputs.items() if name.endswith(".png")}
    outputs["character.json"]=(json.dumps(metadata,ensure_ascii=False,indent=2)+"\n").encode()
    if args.check:
        if any(not (OUTPUT/name).exists() or (OUTPUT/name).read_bytes() != value for name, value in outputs.items()):
            raise SystemExit("Assets are stale; run bun run assets:character")
        print("Native-art mesh assets are up to date.")
    else:
        OUTPUT.mkdir(parents=True, exist_ok=True)
        for name, value in outputs.items(): (OUTPUT/name).write_bytes(value)
        print(f"Baked {json.loads(manifest)['count']:,} particles, {len(parts)} native layers, {len(payload):,} bytes")
    if args.preview_dir:
        args.preview_dir.mkdir(parents=True, exist_ok=True)
        clean.save(args.preview_dir/"clean-base.png")
        atlas.save(args.preview_dir/"art-atlas.png")
        for part in parts: part["image"].crop(part["mask"].getbbox()).save(args.preview_dir/(part["name"]+".png"))


if __name__ == "__main__": main()
