import {effective,type Adjustments,type Analysis}from'./model';
import {measureCast}from'./modules/auto-tone';
import {measureLook}from'./modules/look';
import {angleOf,effectiveCrop}from'./modules/geometry';
import {PEU_DE_DETAILS,peuDeDetails,RAISON_LUMIERES,RAISON_SOMBRE,TRES_SOMBRE,BRULEE,ECRETAGE_GLOBAL}from'./modules/quality';
/**
 * Le repère du vignettage : le centre et les bords du cadre réellement
 * appliqué, pas ceux de la photo entière. Le rendu ne recadre qu'après ce
 * calcul (pipeline.ts) : centré sur la photo, le vignettage d'une photo
 * recadrée tombait de travers, à l'aperçu comme à l'export (bord gauche du
 * cadre 134, bord droit 197 sur une image unie, relecture du 29/09/2026).
 * Le pixel de la source est placé dans le repère redressé, comme dans
 * geometry.ts (sourceVersRedresse), puis dans le cadre. Sans cadre ni
 * redressement, c'est exactement l'ancien repère.
 */
function repereVignette(a:Adjustments,width:number,height:number){
const c=effectiveCrop(a,width,height),t=angleOf(a)*Math.PI/180,cos=Math.cos(t),sin=Math.sin(t);
return(px:number,py:number):[number,number]=>{const dx=(px/width-.5)*width,dy=(py/height-.5)*height,fx=.5+(cos*dx-sin*dy)/width,fy=.5+(sin*dx+cos*dy)/height;return[(fx-c.x)/c.w-.5,(fy-c.y)/c.h-.5];};}
export function transform(data:Uint8ClampedArray|Uint16Array,width:number,height:number,a:Adjustments):void{
const peak=data instanceof Uint16Array?65535:255;
const e=effective(a),exp=2**e.exposure,con=1+e.contrast/100,sat=Math.max(0,1+e.saturation/100),warm=e.warmth*.0018,tint=e.tint*.0014,fade=e.fade/500;
const vignette=e.vignette?repereVignette(a,width,height):undefined;
for(let i=0;i<data.length;i+=4){let r=data[i]/peak,g=data[i+1]/peak,b=data[i+2]/peak;const l=.2126*r+.7152*g+.0722*b,tone=e.shadows/100*.3*(1-l)**2+e.highlights/100*.3*l*l;
r=(r*exp+tone+warm+tint-.5)*con+.5;g=(g*exp+tone-tint-.5)*con+.5;b=(b*exp+tone-warm+tint-.5)*con+.5;const lum=.2126*r+.7152*g+.0722*b;r=lum+(r-lum)*sat;g=lum+(g-lum)*sat;b=lum+(b-lum)*sat;const p=i/4,x=(p%width)/width-.5,y=Math.floor(p/width)/height-.5;let vin=1;if(vignette){const[u,v]=vignette(p%width,Math.floor(p/width));vin=1-e.vignette/100*Math.min(1,(u*u+v*v)*1.7);}const noise=e.grain ? (((Math.sin(Math.floor((x+.5)*1800)*12.9898+Math.floor((y+.5)*1800)*78.233)*43758.5453)%1)+1)%1-.5 : 0;const finish=(v:number)=>Math.max(0,Math.min(1,(v*(1-fade)+fade)*vin+noise*e.grain/2200))*peak;data[i]=finish(r);data[i+1]=finish(g);data[i+2]=finish(b);}}
/** La raison posée quand l'image entière manque de détails. */
// « Peu de détails » vit dans quality.ts, avec les autres jugements que le verdict partage.
export {PEU_DE_DETAILS,peuDeDetails};
/** Le rendu ne doit jamais faire échouer une analyse : il est facultatif. */
function safeLook(data:Uint8ClampedArray,w:number,h:number){try{return measureLook(data,w,h)}catch{return undefined}}
export function analyzePixels(data:Uint8ClampedArray,w:number,h:number):Analysis{const gray=new Float32Array(w*h);let total=0,clip=0;for(let j=0;j<gray.length;j++){const i=j*4;gray[j]=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];total+=gray[j];if(gray[j]>249)clip++;}// La même variance du laplacien, aussi par case d'une grille de 8 × 8 : la case
// la plus nette dit si l'image a un endroit net (voir peuDeDetails).
let sum=0,sum2=0,n=0;const cs=new Float64Array(64),cs2=new Float64Array(64),cn=new Float64Array(64);for(let y=1;y<h-1;y++){const ligne=Math.min(7,Math.floor(y*8/h))*8;for(let x=1;x<w-1;x++){const i=y*w+x,v=4*gray[i]-gray[i-1]-gray[i+1]-gray[i-w]-gray[i+w];sum+=v;sum2+=v*v;n++;const c=ligne+Math.min(7,Math.floor(x*8/w));cs[c]+=v;cs2[c]+=v*v;cn[c]++;}}let nettetePointe=0;for(let c=0;c<64;c++)if(cn[c])nettetePointe=Math.max(nettetePointe,cs2[c]/cn[c]-(cs[c]/cn[c])**2);const sharpness=n?sum2/n-(sum/n)**2:0,brightness=total/Math.max(1,gray.length)/255,clipped=clip/Math.max(1,gray.length);let dhash='';for(let y=0;y<8;y++)for(let x=0;x<8;x++){const yy=Math.min(h-1,Math.floor((y+.5)*h/8)),xx=Math.min(w-2,Math.floor(x*w/9)),nx=Math.min(w-1,Math.floor((x+1)*w/9));dhash+=gray[yy*w+xx]>gray[yy*w+nx]?'1':'0';}const reasons:string[]=[];if(brightness<TRES_SOMBRE)reasons.push(RAISON_SOMBRE);if(brightness>BRULEE||clipped>ECRETAGE_GLOBAL)reasons.push(RAISON_LUMIERES);
if(peuDeDetails(sharpness,w,nettetePointe))reasons.push(PEU_DE_DETAILS);
return{brightness,sharpness,sharpnessWidth:w,nettetePointe,clipped,dhash,cast:measureCast(data,w,h).cast,look:safeLook(data,w,h),advice:reasons.length?'review':'normal',reasons};}
