import type { ArtLayer, CharacterModel } from "./data";

export function atlasCanvas(model: CharacterModel, mask=false): HTMLCanvasElement {
  const canvas=document.createElement("canvas");canvas.width=model.atlasWidth;canvas.height=model.atlasHeight;
  const context=canvas.getContext("2d");if(!context)throw new Error("Canvas atlas unavailable");
  const pixels=new Uint8ClampedArray(model.atlas);
  if(mask)for(let i=0;i<pixels.length;i+=4)pixels[i]=pixels[i+1]=pixels[i+2]=255;
  context.putImageData(new ImageData(pixels,canvas.width,canvas.height),0,0);
  return canvas;
}
/** Warp the *actual alpha matte* through the same triangles as the particles. */
export function paintLayer(context:CanvasRenderingContext2D,atlas:HTMLCanvasElement,model:CharacterModel,vertices:Float32Array,layer:ArtLayer,project:(x:number,y:number)=>[number,number]):void {
  for(let i=layer.triangleStart;i<layer.triangleStart+layer.triangleCount;i++) {
    const indices=[model.triangles[i*3]!,model.triangles[i*3+1]!,model.triangles[i*3+2]!];
    const target=indices.map(v=>project(vertices[v*2]!,vertices[v*2+1]!));
    const source=indices.map(v=>[model.uv[v*2]!*model.atlasWidth,model.uv[v*2+1]!*model.atlasHeight]);
    const [a,b,c]=target as [[number,number],[number,number],[number,number]];
    if(Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))<1e-7)continue;
    const [u,v,w]=source as [[number,number],[number,number],[number,number]];
    const du=v[0]-u[0],dv=v[1]-u[1],eu=w[0]-u[0],ev=w[1]-u[1],det=du*ev-eu*dv;
    if(Math.abs(det)<1e-9)continue;
    const aa=((b[0]-a[0])*ev-(c[0]-a[0])*dv)/det,cc=(du*(c[0]-a[0])-eu*(b[0]-a[0]))/det;
    const bb=((b[1]-a[1])*ev-(c[1]-a[1])*dv)/det,dd=(du*(c[1]-a[1])-eu*(b[1]-a[1]))/det;
    context.save();context.beginPath();context.moveTo(...a);context.lineTo(...b);context.lineTo(...c);context.closePath();context.clip();
    context.transform(aa,bb,cc,dd,a[0]-aa*u[0]-cc*u[1],a[1]-bb*u[0]-dd*u[1]);context.drawImage(atlas,0,0);context.restore();
  }
}
