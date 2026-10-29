const projection = `
uniform float uScale;
uniform float uAspect;
uniform float uImageAspect;
uniform vec2 uCenter;
vec4 project(vec2 p) {
  vec2 position=(p-0.5)*vec2(uImageAspect,1.0)*2.0;
  return vec4(vec2(position.x*uScale/uAspect,-position.y*uScale)+uCenter,0.0,1.0);
}`;
const aperture = `
uniform sampler2D uMatte;
uniform vec2 uViewport;
float aperture(float kind,float region,vec4 matte) {
  if(kind<0.5) return 1.0-matte.r;
  if(kind<2.5) return region<1.5 ? matte.g : matte.b;
  if(abs(kind-7.0)<0.1) return matte.a;
  return 1.0;
}`;
export const vertexShader = `
precision highp float;
attribute vec2 aSource;
attribute vec3 aCorners;
attribute vec3 aBary;
attribute float aArea;
attribute vec4 aColor;
attribute vec4 aMeta;
uniform sampler2D uVertices;
uniform vec2 uVertexSize;
uniform float uPointScale;
varying vec4 vColor;
varying vec2 vKind;
${projection}
vec2 vertexAt(float i) {
  vec2 uv=(vec2(mod(i,uVertexSize.x),floor(i/uVertexSize.x))+0.5)/uVertexSize;
  vec4 p=floor(texture2D(uVertices,uv)*255.0+0.5);
  return vec2(p.r*256.0+p.g,p.b*256.0+p.a)/65535.0;
}
void main() {
  vec2 p=aSource;
  float jacobian=1.0;
  if(aMeta.x>0.5) {
    vec2 a=vertexAt(aCorners.x), b=vertexAt(aCorners.y), c=vertexAt(aCorners.z);
    p=a*aBary.x+b*aBary.y+c*aBary.z;
    vec2 ab=b-a,ac=c-a;
    jacobian=clamp(abs(ab.x*ac.y-ab.y*ac.x)/max(aArea,0.000000000001),0.0,6.0);
  }
  float desired=aMeta.z/32.0*uPointScale*sqrt(jacobian);
  float size=max(1.0,desired);
  gl_PointSize=size;
  gl_Position=project(p);
  vColor=aColor;
  // Subpixel ink does not become a thick, bright 1px sticker.
  vColor.a*=min(1.0,desired*desired/(size*size));
  vKind=vec2(aMeta.w,aMeta.x);
}`;
export const fragmentShader = `
precision mediump float;
varying vec4 vColor;
varying vec2 vKind;
${aperture}
void main() {
  float d=length(gl_PointCoord-0.5);
  float kernel=1.0-smoothstep(0.30,0.50,d);
  vec4 matte=texture2D(uMatte,gl_FragCoord.xy/uViewport);
  float alpha=vColor.a*kernel*aperture(vKind.x,vKind.y,matte);
  if(alpha<0.002) discard;
  gl_FragColor=vec4(vColor.rgb,alpha);
}`;
export const meshVertexShader = `
precision highp float;
attribute vec2 aPosition;
attribute vec2 aUV;
varying vec2 vUV;
${projection}
void main() { vUV=aUV;gl_Position=project(aPosition); }
`;
export const meshFragmentShader = `
precision mediump float;
varying vec2 vUV;
uniform sampler2D uAtlas;
uniform float uPaint;
uniform float uPremult;
uniform float uKind;
uniform float uRegion;
${aperture}
void main() {
  vec4 color=texture2D(uAtlas,vUV);
  if(color.a<0.002) discard;
  if(uPaint<0.5) gl_FragColor=vec4(color.a);
  else {
    if(uPremult>0.5) color.rgb/=max(0.001,color.a);
    float coverage=uKind<0.5 ? 1.0 : aperture(uKind,uRegion,texture2D(uMatte,gl_FragCoord.xy/uViewport));
    gl_FragColor=vec4(color.rgb,color.a*coverage);
  }
}`;
