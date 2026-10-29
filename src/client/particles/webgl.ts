import { animateParticles, type ParticleEngine, type ParticleFrame, type ParticleState } from "./animation";
import type { CharacterModel } from "./data";
import { createParticleAttributes, encodeVertices, resolveMesh } from "./rig";
import { fragmentShader, meshFragmentShader, meshVertexShader, vertexShader } from "./shaders";

/** Alpha textures are mattes only in the particle view; no RGB picture/frame swapping. */
export function createWebGLScene(canvas: HTMLCanvasElement, initial: ParticleState, model: CharacterModel, nativeBase?: HTMLImageElement): ParticleEngine {
  const gl=canvas.getContext("webgl",{alpha:false,antialias:false,premultipliedAlpha:false,powerPreference:"low-power",preserveDrawingBuffer:false});
  if (!gl || gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)<1) throw new Error("Mesh particles need vertex textures");
  const buffers:WebGLBuffer[]=[], textures:WebGLTexture[]=[],shaders:WebGLShader[]=[],programs:WebGLProgram[]=[],fbos:WebGLFramebuffer[]=[];
  const dispose=()=> {buffers.forEach(b=>gl.deleteBuffer(b));textures.forEach(t=>gl.deleteTexture(t));shaders.forEach(s=>gl.deleteShader(s));programs.forEach(p=>gl.deleteProgram(p));fbos.forEach(f=>gl.deleteFramebuffer(f));};
  try {
    function program(vs:string,fs:string) {
      const p=gl!.createProgram();if (!p) throw new Error("WebGL program unavailable");programs.push(p);
      for (const [type,source] of [[gl!.VERTEX_SHADER,vs],[gl!.FRAGMENT_SHADER,fs]] as const) {
        const s=gl!.createShader(type);if(!s)throw new Error("WebGL shader unavailable");shaders.push(s);
        gl!.shaderSource(s,source);gl!.compileShader(s);
        if (!gl!.getShaderParameter(s,gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s)||"Mesh shader compilation failed");
        gl!.attachShader(p,s);
      }
      gl!.linkProgram(p);if(!gl!.getProgramParameter(p,gl!.LINK_STATUS))throw new Error(gl!.getProgramInfoLog(p)||"Mesh shader link failed");
      return p;
    }
    const points=program(vertexShader,fragmentShader),mesh=program(meshVertexShader,meshFragmentShader);
    const makeBuffer=(data:AllowSharedBufferSource,target:number=gl.ARRAY_BUFFER,usage:number=gl.STATIC_DRAW)=> {
      const b=gl.createBuffer();if(!b)throw new Error("Mesh buffer unavailable");buffers.push(b);gl.bindBuffer(target,b);gl.bufferData(target,data,usage);return b;
    };
    const texture=(unit:number,width:number,height:number,data:Uint8Array|null,linear=false)=> {
      const t=gl.createTexture();if(!t)throw new Error("Mesh texture unavailable");textures.push(t);
      gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,linear?gl.LINEAR:gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,linear?gl.LINEAR:gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,data);return t;
    };
    const atlasPixels=nativeBase?model.atlas.slice():model.atlas;
    if(nativeBase)for(let i=0;i<atlasPixels.length;i+=4)for(let j=0;j<3;j++)atlasPixels[i+j]=Math.round(atlasPixels[i+j]!*atlasPixels[i+3]!/255);
    const atlas=texture(0,model.atlasWidth,model.atlasHeight,atlasPixels,true);
    const vertexWidth=128,vertexHeight=Math.ceil(model.vertexCount/vertexWidth),vertexPixels=new Uint8Array(vertexWidth*vertexHeight*4);
    const vertexTexture=texture(1,vertexWidth,vertexHeight,vertexPixels);
    const empty=texture(2,1,1,new Uint8Array(4)),matte=texture(2,1,1,null,true);
    if (nativeBase) { texture(3,1,1,null,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,nativeBase); }
    const framebuffer=gl.createFramebuffer();if(!framebuffer)throw new Error("Matte framebuffer unavailable");fbos.push(framebuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,matte,0);gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    const vertices=new Float32Array(model.vertexCount*2),positionBuffer=makeBuffer(vertices,gl.ARRAY_BUFFER,gl.DYNAMIC_DRAW),uvBuffer=makeBuffer(model.uv),indexBuffer=makeBuffer(model.triangles,gl.ELEMENT_ARRAY_BUFFER);
    const quad=makeBuffer(new Float32Array([0,0,1,0,0,1,1,1]));
    const attributes=createParticleAttributes(model);
    const pointAttributes=[
      ["aSource",makeBuffer(attributes.source),2,gl.FLOAT,false], ["aCorners",makeBuffer(attributes.corners),3,gl.FLOAT,false],
      ["aBary",makeBuffer(attributes.bary),3,gl.FLOAT,false], ["aArea",makeBuffer(attributes.areas),1,gl.FLOAT,false],
      ["aColor",makeBuffer(model.colors),4,gl.UNSIGNED_BYTE,true], ["aMeta",makeBuffer(model.metadata),4,gl.UNSIGNED_BYTE,false],
    ] as const;
    const uniformCache=new Map<WebGLProgram,Map<string,WebGLUniformLocation|null>>();
    const uniform=(p:WebGLProgram,name:string)=> { let cache=uniformCache.get(p);if(!cache){cache=new Map();uniformCache.set(p,cache);}if(!cache.has(name))cache.set(name,gl.getUniformLocation(p,name));return cache.get(name)!; };
    const maxAttributes=gl.getParameter(gl.MAX_VERTEX_ATTRIBS) as number;
    const clearAttributes=()=> { for(let i=0;i<maxAttributes;i++)gl.disableVertexAttribArray(i); };
    const attribute=(p:WebGLProgram,name:string,b:WebGLBuffer,size:number,type:number,normalized=false)=> {const loc=gl.getAttribLocation(p,name);if(loc<0)return;gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,type,normalized,0,0);};
    const bindMesh=(body=false)=> {clearAttributes();attribute(mesh,"aPosition",body?quad:positionBuffer,2,gl.FLOAT);attribute(mesh,"aUV",body?quad:uvBuffer,2,gl.FLOAT);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indexBuffer);};
    function view(p:WebGLProgram,frame:ParticleFrame) {
      const l=frame.layout;
      gl!.uniform1f(uniform(p,"uScale"),l.diameter/l.height);gl!.uniform1f(uniform(p,"uAspect"),l.width/l.height);gl!.uniform1f(uniform(p,"uImageAspect"),model.width/model.height);
      gl!.uniform2f(uniform(p,"uCenter"),l.faceX/l.width*2-1,1-l.faceY/l.height*2);gl!.uniform2f(uniform(p,"uViewport"),canvas.width,canvas.height);gl!.uniform1i(uniform(p,"uMatte"),2);
    }
    let matteWidth=0,matteHeight=0;
    const maxTexture=gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.disable(gl.DEPTH_TEST);
    if(gl.getError()!==gl.NO_ERROR)throw new Error("Native mesh upload failed");
    return animateParticles(canvas,initial,frame=> {
      resolveMesh(model,frame.pose,vertices);
      encodeVertices(vertices,vertexPixels);
      gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,vertexTexture);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,vertexWidth,vertexHeight,gl.RGBA,gl.UNSIGNED_BYTE,vertexPixels);
      gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,vertices);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,atlas);
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,matte);
      const matteScale=Math.min(1,maxTexture/canvas.width,maxTexture/canvas.height);
      const mw=Math.max(1,Math.round(canvas.width*matteScale)),mh=Math.max(1,Math.round(canvas.height*matteScale));
      if (matteWidth!==mw || matteHeight!==mh) {
        matteWidth=mw;matteHeight=mh;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,matteWidth,matteHeight,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
        if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error("Matte framebuffer incomplete");
      }
      // Never sample the attached texture during the matte pass (WebGL feedback).
      gl.bindTexture(gl.TEXTURE_2D,empty);gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.viewport(0,0,matteWidth,matteHeight);
      gl.colorMask(true,true,true,true);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(mesh);bindMesh();view(mesh,frame);
      gl.uniform1i(uniform(mesh,"uAtlas"),0);gl.uniform1f(uniform(mesh,"uPaint"),0);
      for (const layer of model.layers) {
        if (layer.role.startsWith("eye-"))continue;
        gl.colorMask(true,layer.role==="window-left",layer.role==="window-right",layer.role==="window-mouth");
        gl.drawElements(gl.TRIANGLES,layer.triangleCount*3,gl.UNSIGNED_SHORT,layer.triangleStart*6);
      }
      gl.colorMask(true,true,true,true);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,matte);
      gl.clearColor(4/255,13/255,32/255,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      if (nativeBase) {
        gl.useProgram(mesh);view(mesh,frame);gl.uniform1f(uniform(mesh,"uPaint"),1);gl.uniform1f(uniform(mesh,"uPremult"),0);gl.uniform1f(uniform(mesh,"uKind"),0);gl.uniform1f(uniform(mesh,"uRegion"),0);
        bindMesh(true);gl.uniform1i(uniform(mesh,"uAtlas"),3);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        bindMesh();gl.uniform1i(uniform(mesh,"uAtlas"),0);gl.uniform1f(uniform(mesh,"uPremult"),1);
        for(const layer of model.layers) {
          if(layer.role.startsWith("window"))continue;
          gl.uniform1f(uniform(mesh,"uKind"),layer.kind);gl.uniform1f(uniform(mesh,"uRegion"),layer.region);
          gl.drawElements(gl.TRIANGLES,layer.triangleCount*3,gl.UNSIGNED_SHORT,layer.triangleStart*6);
        }
      } else {
        gl.useProgram(points);clearAttributes();for(const [name,buffer,size,type,normalized] of pointAttributes)attribute(points,name,buffer,size,type,normalized);
        view(points,frame);gl.uniform1i(uniform(points,"uVertices"),1);gl.uniform2f(uniform(points,"uVertexSize"),vertexWidth,vertexHeight);
        gl.uniform1f(uniform(points,"uPointScale"),frame.layout.diameter/model.height*frame.ratio*1.08);
        gl.drawArrays(gl.POINTS,0,model.count);
      }
    },dispose);
  } catch(error) {dispose();throw error;}
}
