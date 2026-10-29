export const CHARACTER_FRAMES = ["rest", "soft", "open", "round", "sad", "happy", "blink"] as const;
export const REGION = { body: 0, leftEye: 1, rightEye: 2, mouth: 3, leftBrow: 4, rightBrow: 5 } as const;
export const MATERIAL = { body: 0, sclera: 1, iris: 2, upperLid: 3, lowerLid: 4, upperLip: 5, lowerLip: 6, mouthInside: 7, brow: 8 } as const;
export interface ArtLayer {
  id: number; name: string; region: number; kind: number;
  role: "paint" | "eye-left" | "eye-right" | "mouth" | "window-left" | "window-right" | "window-mouth";
  deformation: "lid-cage" | "native-strip";
  sourceFrame: number; vertexStart: number; vertexCount: number; triangleStart: number; triangleCount: number;
  atlas: { x: number; y: number; width: number; height: number; sourceX: number; sourceY: number };
}
export interface CharacterModel {
  width: number; height: number; count: number; bodyCount: number; featureCount: number; frameCount: number;
  vertexCount: number; triangleCount: number; atlasWidth: number; atlasHeight: number; layers: ArtLayer[];
  positions: Uint16Array; colors: Uint8Array; metadata: Uint8Array; bindings: Uint16Array; layerIds: Uint8Array;
  vertices: Float32Array; uv: Float32Array; triangles: Uint16Array; atlas: Uint8Array;
}
const invalid = () => new Error("角色网格素材损坏，请重新生成或刷新后重试。");

/** A bounded, little-endian native-mesh format. LATIMG01/02 patches are rejected. */
export function decodeCharacter(buffer: ArrayBuffer): CharacterModel {
  if (buffer.byteLength < 20 || buffer.byteLength > 20_000_000) throw invalid();
  const view = new DataView(buffer);
  const text = new TextDecoder("utf-8", { fatal: true });
  if (text.decode(new Uint8Array(buffer, 0, 8)) !== "LATMSH03") throw invalid();
  const descriptorSize = view.getUint32(8, true), dataSize = view.getUint32(12, true);
  if (descriptorSize > 64_000 || descriptorSize % 4 || 16 + descriptorSize + dataSize !== buffer.byteLength) throw invalid();
  const d = JSON.parse(text.decode(new Uint8Array(buffer, 16, descriptorSize)));
  const integer = (n: unknown, min: number, max: number): n is number => Number.isInteger(n) && Number(n) >= min && Number(n) <= max;
  for (const name of ["width", "height"]) if (!integer(d[name], 16, 4096)) throw invalid();
  if (d.version !== 3 || d.frameCount !== 7 || !integer(d.count, 1, 200_000) || !integer(d.bodyCount, 1, d.count)
    || d.featureCount !== d.count-d.bodyCount || !integer(d.vertexCount, 3, 16_000) || !integer(d.triangleCount, 1, 60_000)
    || !integer(d.atlasWidth, 1, 2048) || !integer(d.atlasHeight, 1, 2048) || !Array.isArray(d.layers) || !integer(d.layers.length, 1, 32)) throw invalid();
  const ranges: [number, number][] = [];
  function section(name: string, length: number, type: "B" | "H" | "f") {
    const s = d.sections?.[name], size = type === "B" ? 1 : type === "H" ? 2 : 4;
    if (!s || s.type !== type || s.length !== length || !integer(s.offset, 0, dataSize) || s.offset % 4 || s.offset+length*size > dataSize) throw invalid();
    const range: [number, number] = [s.offset, s.offset+length*size];
    if (ranges.some(([a,b]) => range[0] < b && range[1] > a)) throw invalid();
    ranges.push(range);
    const offset = 16+descriptorSize+s.offset;
    return type === "B" ? new Uint8Array(buffer, offset, length) : type === "H" ? new Uint16Array(buffer, offset, length) : new Float32Array(buffer, offset, length);
  }
  const model: CharacterModel = { ...d,
    positions: section("positions", d.count*2, "H") as Uint16Array,
    colors: section("colors", d.count*4, "B") as Uint8Array,
    metadata: section("metadata", d.count*4, "B") as Uint8Array,
    bindings: section("bindings", d.count*3, "H") as Uint16Array,
    layerIds: section("layerIds", d.count, "B") as Uint8Array,
    vertices: section("vertices", d.frameCount*d.vertexCount*2, "f") as Float32Array,
    uv: section("uv", d.vertexCount*2, "f") as Float32Array,
    triangles: section("triangles", d.triangleCount*3, "H") as Uint16Array,
    atlas: section("atlas", d.atlasWidth*d.atlasHeight*4, "B") as Uint8Array,
  };
  const roles = new Set(["paint", "eye-left", "eye-right", "mouth", "window-left", "window-right", "window-mouth"]);
  let vertices = 0, triangles = 0;
  for (const [index, layer] of model.layers.entries()) {
    if (!["lid-cage","native-strip"].includes(layer.deformation) || layer.id !== index+1 || typeof layer.name !== "string" || !roles.has(layer.role) || !integer(layer.region, 1, 5) || !integer(layer.kind, 0, 8)
      || !integer(layer.sourceFrame, 0, 6) || layer.vertexStart !== vertices || layer.triangleStart !== triangles
      || !integer(layer.vertexCount, 3, model.vertexCount-vertices) || !integer(layer.triangleCount, 1, model.triangleCount-triangles)) throw invalid();
    const a=layer.atlas;
    if(!a||!integer(a.x,0,model.atlasWidth-1)||!integer(a.y,0,model.atlasHeight-1)||!integer(a.width,1,model.atlasWidth-a.x)||!integer(a.height,1,model.atlasHeight-a.y)
      ||!integer(a.sourceX,0,model.width-a.width)||!integer(a.sourceY,0,model.height-a.height))throw invalid();
    for(let t=layer.triangleStart*3;t<(layer.triangleStart+layer.triangleCount)*3;t++)if(model.triangles[t]!<layer.vertexStart||model.triangles[t]!>=layer.vertexStart+layer.vertexCount)throw invalid();
    for(let v=layer.vertexStart;v<layer.vertexStart+layer.vertexCount;v++)if(model.uv[v*2]!<a.x/model.atlasWidth||model.uv[v*2]!>(a.x+a.width)/model.atlasWidth||model.uv[v*2+1]!<a.y/model.atlasHeight||model.uv[v*2+1]!>(a.y+a.height)/model.atlasHeight)throw invalid();
    vertices += layer.vertexCount; triangles += layer.triangleCount;
  }
  if (vertices !== model.vertexCount || triangles !== model.triangleCount || model.vertices.some(n => !Number.isFinite(n) || n < 0 || n > 1)
    || model.uv.some(n => !Number.isFinite(n) || n < 0 || n > 1) || model.triangles.some(n => n >= model.vertexCount)) throw invalid();
  for (let i=0; i<model.count; i++) {
    const id = model.layerIds[i]!, tri = model.bindings[i*3]!;
    if (model.bindings[i*3+1]!+model.bindings[i*3+2]! > 65535 || model.metadata[i*4+2] === 0) throw invalid();
    if(model.colors[i*4+3]===0)throw invalid();
    if (i < model.bodyCount) { if (id !== 0 || tri !== 65535 || model.metadata[i*4] !== 0 || model.metadata[i*4+3] !== 0) throw invalid(); }
    else {
      const layer = model.layers[id-1];
      if (!layer || layer.role.startsWith("window") || tri < layer.triangleStart || tri >= layer.triangleStart+layer.triangleCount
        || model.metadata[i*4] !== layer.region || (layer.kind===1?![1,2].includes(model.metadata[i*4+3]!):model.metadata[i*4+3]!==layer.kind)) throw invalid();
      for (let j=0; j<3; j++) { const v = model.triangles[tri*3+j]!; if (v < layer.vertexStart || v >= layer.vertexStart+layer.vertexCount) throw invalid(); }
    }
  }
  return model;
}

/** Persistent identity: fixed native RGBA; only its triangle/barycentric position changes. */
export function sampleParticle(model: CharacterModel, index: number, vertices: Float32Array, output = new Float32Array(6)): Float32Array {
  if (index < 0 || index >= model.count) throw new RangeError("Invalid particle index");
  if (index < model.bodyCount) {
    output[0] = model.positions[index*2]!/65535; output[1] = model.positions[index*2+1]!/65535;
  } else {
    const tri = model.bindings[index*3]!*3;
    const a = model.bindings[index*3+1]!/65535, b = model.bindings[index*3+2]!/65535;
    const weights = [a, b, 1-a-b];
    output[0] = output[1] = 0;
    for (let j=0;j<3;j++) {
      const v = model.triangles[tri+j]!*2;
      output[0] += vertices[v]!*weights[j]!; output[1] += vertices[v+1]!*weights[j]!;
    }
  }
  for (let j=0;j<4;j++) output[j+2] = model.colors[index*4+j]!/255;
  return output;
}
