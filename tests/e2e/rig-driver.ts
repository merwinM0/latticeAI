import type { Page } from "@playwright/test";
import type { CharacterModel } from "../../src/client/particles/data";
import type { CharacterPose } from "../../src/client/particles/poses";

/** Review API redraws the production pipeline synchronously, then reads actual GPU pixels. */
export async function drawRigPose(page:Page,model:CharacterModel,pose:CharacterPose,reset=false,protectedSkin:number[][]=[]) {
  return page.locator("canvas").evaluate((_canvas,args)=>{
    const api=window.characterReview!;api.setPose(args.pose);
    const {pixels,width,height,layout,error}=api.capture();
    const store=window as unknown as {__rigBaseline?:Uint8Array};const baseline=store.__rigBaseline;
    const different=(offset:number)=>Boolean(baseline&&(baseline[offset]!==pixels[offset]||baseline[offset+1]!==pixels[offset+1]||baseline[offset+2]!==pixels[offset+2]));
    let changed=0;for(let offset=0;offset<pixels.length;offset+=4)if(different(offset))changed++;
    const ratio=width/layout.width,diameter=layout.diameter*ratio;
    const xOf=(x:number)=>layout.faceX*ratio+(x-args.width/2)*diameter/args.height;
    const yOf=(y:number)=>layout.faceY*ratio+(y-args.height/2)*diameter/args.height;
    const protectedChanged=args.protectedSkin.map(([left,top,right,bottom])=>{
      let count=0;
      for(let y=Math.max(0,Math.ceil(yOf(top!)));y<Math.min(height,Math.floor(yOf(bottom!)));y++)for(let x=Math.max(0,Math.ceil(xOf(left!)));x<Math.min(width,Math.floor(xOf(right!)));x++)if(different(((height-y-1)*width+x)*4))count++;
      return count;
    });
    if(args.reset||!baseline)store.__rigBaseline=pixels;
    return {changed,protectedChanged,error};
  },{pose,width:model.width,height:model.height,reset,protectedSkin});
}
