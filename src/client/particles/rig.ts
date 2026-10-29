import type { CharacterModel } from "./data";
import { regionWeights, type CharacterPose } from "./poses";

/** Resolve vertices ONCE per frame. Native paint, mattes and points share these vertices. */
export function resolveMesh(model: CharacterModel, pose: CharacterPose, output=new Float32Array(model.vertexCount*2)): Float32Array {
  output.fill(0);
  for (const layer of model.layers) {
    const weights=regionWeights(pose,layer.region);
    for (let frame=0;frame<7;frame++) {
      const weight=weights[frame]!;
      if (!weight) continue;
      const offset=frame*model.vertexCount*2;
      for (let i=layer.vertexStart*2;i<(layer.vertexStart+layer.vertexCount)*2;i++) output[i]=output[i]!+model.vertices[offset+i]!*weight;
    }
    if(layer.region>=4 && pose.browLift)for(let i=layer.vertexStart*2+1;i<(layer.vertexStart+layer.vertexCount)*2;i+=2)output[i]=output[i]!-pose.browLift/model.height;
  }
  return output;
}
export function triangleArea(vertices: Float32Array, triangles: Uint16Array, triangle: number): number {
  const a=triangles[triangle*3]!*2,b=triangles[triangle*3+1]!*2,c=triangles[triangle*3+2]!*2;
  return (vertices[b]!-vertices[a]!)*(vertices[c+1]!-vertices[a+1]!)-(vertices[b+1]!-vertices[a+1]!)*(vertices[c]!-vertices[a]!);
}
export function createParticleAttributes(model: CharacterModel) {
  const source=Float32Array.from(model.positions,n=>n/65535),corners=new Float32Array(model.count*3),bary=new Float32Array(model.count*3),areas=new Float32Array(model.count).fill(1);
  for (let i=model.bodyCount;i<model.count;i++) {
    const triangle=model.bindings[i*3]!;
    corners.set(model.triangles.subarray(triangle*3,triangle*3+3),i*3);
    const a=model.bindings[i*3+1]!/65535,b=model.bindings[i*3+2]!/65535;
    bary.set([a,b,1-a-b],i*3);
    const layer=model.layers[model.layerIds[i]!-1]!;
    const vertices=model.vertices.subarray(layer.sourceFrame*model.vertexCount*2,(layer.sourceFrame+1)*model.vertexCount*2);
    areas[i]=Math.abs(triangleArea(vertices,model.triangles,triangle));
  }
  return {source,corners,bary,areas};
}
export function encodeVertices(vertices: Float32Array, output: Uint8Array): void {
  output.fill(0);
  for (let i=0;i<vertices.length/2;i++) {
    const x=Math.round(vertices[i*2]!*65535),y=Math.round(vertices[i*2+1]!*65535);
    output.set([x>>>8,x&255,y>>>8,y&255],i*4);
  }
}
