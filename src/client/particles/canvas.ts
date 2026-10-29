import { animateParticles, type ParticleEngine, type ParticleState } from "./animation";
import { atlasCanvas, paintLayer } from "./canvas-occlusion";
import { sampleParticle, type CharacterModel } from "./data";
import { resolveMesh, triangleArea } from "./rig";

/** Same native mattes/bindings, with a cached static point field at 15fps. */
export function createCanvasScene(canvas:HTMLCanvasElement,initial:ParticleState,model:CharacterModel,nativeBase?:HTMLImageElement):ParticleEngine {
  const context=canvas.getContext("2d");if(!context)throw new Error("Canvas unavailable");
  const makeLayer=()=> {const image=document.createElement("canvas"),ctx=image.getContext("2d");if(!ctx)throw new Error("Canvas layer unavailable");return {image,ctx};};
  const body=makeLayer(),foreground=makeLayer(),masks=[makeLayer(),makeLayer(),makeLayer(),makeLayer()];
  const matteAtlas=atlasCanvas(model,true),artAtlas=nativeBase?atlasCanvas(model):null;
  const vertices=new Float32Array(model.vertexCount*2),sample=new Float32Array(6),sourceAreas=new Float32Array(model.triangleCount),scales=new Float32Array(model.triangleCount);
  for(const layer of model.layers) {
    const source=model.vertices.subarray(layer.sourceFrame*model.vertexCount*2,(layer.sourceFrame+1)*model.vertexCount*2);
    for(let t=layer.triangleStart;t<layer.triangleStart+layer.triangleCount;t++)sourceAreas[t]=Math.abs(triangleArea(source,model.triangles,t));
  }
  const color=(i:number)=>`rgb(${model.colors[i*4]} ${model.colors[i*4+1]} ${model.colors[i*4+2]})`;
  body.image.width=model.width;body.image.height=model.height;
  if(nativeBase)body.ctx.drawImage(nativeBase,0,0);
  else for(let i=0;i<model.bodyCount;i++) {
    const x=model.positions[i*2]!/65535*model.width,y=model.positions[i*2+1]!/65535*model.height;
    const radius=model.metadata[i*4+2]!/32*1.08/2;
    body.ctx.fillStyle=color(i);body.ctx.globalAlpha=model.colors[i*4+3]!/255*0.82;
    body.ctx.beginPath();body.ctx.arc(x,y,radius,0,Math.PI*2);body.ctx.fill();
  }
  let minX=1,minY=1,maxX=0,maxY=0;
  for(let i=0;i<model.vertices.length;i+=2) {minX=Math.min(minX,model.vertices[i]!);maxX=Math.max(maxX,model.vertices[i]!);minY=Math.min(minY,model.vertices[i+1]!);maxY=Math.max(maxY,model.vertices[i+1]!);}
  canvas.style.backgroundColor="#040d20";
  return animateParticles(canvas,initial,frame=> {
    resolveMesh(model,frame.pose,vertices);
    for(let t=0;t<model.triangleCount;t++)scales[t]=Math.sqrt(Math.min(6,Math.abs(triangleArea(vertices,model.triangles,t))/Math.max(1e-12,sourceAreas[t]!)));
    const scale=frame.layout.diameter/model.height,work=Math.min(1,scale*frame.ratio);
    const width=Math.ceil((maxX-minX)*model.width*work)+4,height=Math.ceil((maxY-minY)*model.height*work)+4;
    for(const layer of [...masks,foreground]) {
      if(layer.image.width!==width||layer.image.height!==height){layer.image.width=width;layer.image.height=height;}
      layer.ctx.setTransform(1,0,0,1,0,0);layer.ctx.globalCompositeOperation="source-over";layer.ctx.globalAlpha=1;layer.ctx.clearRect(0,0,width,height);
    }
    const project=(x:number,y:number):[number,number]=>[(x-minX)*model.width*work+2,(y-minY)*model.height*work+2];
    for(const layer of model.layers) {
      if(layer.role.startsWith("eye-"))continue;
      const window=layer.role==="window-left"?1:layer.role==="window-right"?2:layer.role==="window-mouth"?3:0;
      paintLayer(masks[window]!.ctx,matteAtlas,model,vertices,layer,project);
    }
    for(let m=1;m<4;m++)masks[0]!.ctx.drawImage(masks[m]!.image,0,0);
    const {layout,ratio}=frame,imageWidth=layout.diameter*model.width/model.height;
    const left=layout.faceX+(minX-0.5)*imageWidth-2*scale/work,top=layout.faceY+(minY-0.5)*layout.diameter-2*scale/work;
    context.setTransform(ratio,0,0,ratio,0,0);context.clearRect(0,0,layout.width,layout.height);
    context.drawImage(body.image,layout.faceX-imageWidth/2,layout.faceY-layout.diameter/2,imageWidth,layout.diameter);
    if(!nativeBase) {
      context.globalCompositeOperation="destination-out";context.drawImage(masks[0]!.image,left,top,width*scale/work,height*scale/work);context.globalCompositeOperation="source-over";
    }
    for(let group=1;group<=4;group++) {
      const ctx=foreground.ctx;ctx.globalCompositeOperation="source-over";ctx.clearRect(0,0,width,height);
      if(nativeBase && artAtlas) {
        for(const layer of model.layers) {
          const member=layer.role==="eye-left"?1:layer.role==="eye-right"?2:layer.role==="mouth"?3:layer.role==="paint"?4:0;
          if(member===group)paintLayer(ctx,artAtlas,model,vertices,layer,project);
        }
      } else for(let i=model.bodyCount;i<model.count;i++) {
        const kind=model.metadata[i*4+3]!,region=model.metadata[i*4]!;
        const member=kind<2.5?region===1?1:2:kind===7?3:4;
        if(member!==group)continue;
        sampleParticle(model,i,vertices,sample);
        const [x,y]=project(sample[0]!,sample[1]!);
        const radius=model.metadata[i*4+2]!/32*work*1.08/2*scales[model.bindings[i*3]!]!;
        if(radius<0.01)continue;
        ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle=color(i);ctx.globalAlpha=sample[5]!*0.82;ctx.fill();
      }
      ctx.globalAlpha=1;
      if(group<4) {ctx.globalCompositeOperation="destination-in";ctx.drawImage(masks[group]!.image,0,0);ctx.globalCompositeOperation="source-over";}
      context.drawImage(foreground.image,left,top,width*scale/work,height*scale/work);
    }
    context.globalAlpha=1;
  },()=> {for(const layer of [body,foreground,...masks]){layer.image.width=0;layer.image.height=0;}matteAtlas.width=0;if(artAtlas)artAtlas.width=0;},15);
}
