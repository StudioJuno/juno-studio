import type {Adjustments,CropRect,LocalEdit,Point} from '../model';
import {maskAt, type MasquesSujet, type SubjectMask} from './subject';
// Le cadre et le passage écran ↔ source vivent dans geometry.ts : ils
// dépendent désormais du redressement et des dimensions de la photo.
// A stroke is composited once through its coverage mask: overlapping dabs never compound exposure.
/**
 * Applique les retouches locales.
 *
 * `subject` est le seul outil qui ne se peint pas : sa zone vient du masque
 * de détourage, avec sa transparence par pixel. Les cheveux et un voile de
 * mariée ne sont ni dedans ni dehors, et un contour net les hacherait.
 */
export function applyLocalEdits(data:Uint8ClampedArray|Uint16Array,w:number,h:number,edits:LocalEdit[]=[],subject?:MasquesSujet){
 const peak=data instanceof Uint16Array?65535:255;
 for(const e of edits){
  if(!e.visible||e.tool==='mask')continue;
  // Chaque calque « Sujet détouré » a son masque : deux personnes détourées
  // sont deux masques, pas le premier appliqué deux fois.
  if(e.tool==='subject'){const m=typeof subject==='function'?subject(e):subject;if(m)applySubject(data,w,h,e,m,peak);continue;}
  if(!e.points.length)continue;
  const radius=Math.max(1,e.radius*Math.min(w,h));
  const x0=Math.max(0,Math.floor(Math.min(...e.points.map(p=>p.x))*w-radius)),y0=Math.max(0,Math.floor(Math.min(...e.points.map(p=>p.y))*h-radius)),x1=Math.min(w,Math.ceil(Math.max(...e.points.map(p=>p.x))*w+radius)),y1=Math.min(h,Math.ceil(Math.max(...e.points.map(p=>p.y))*h+radius)),mw=Math.max(0,x1-x0),mh=Math.max(0,y1-y0);if(!mw||!mh)continue;const mask=new Float32Array(mw*mh);
  const dab=(p:Point)=>{const cx=p.x*w,cy=p.y*h;for(let y=Math.max(0,Math.floor(cy-radius));y<Math.min(h,Math.ceil(cy+radius));y++)for(let x=Math.max(0,Math.floor(cx-radius));x<Math.min(w,Math.ceil(cx+radius));x++){const d=Math.hypot(x+.5-cx,y+.5-cy)/radius;if(d>=1)continue;const weight=Math.min(1,(1-d)*3)*Math.max(0,Math.min(1,e.opacity));const mi=(y-y0)*mw+x-x0;mask[mi]=Math.max(mask[mi],weight);}};
  dab(e.points[0]);for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],steps=Math.ceil(Math.hypot((b.x-a.x)*w,(b.y-a.y)*h)/Math.max(1,radius/3));for(let j=1;j<=steps;j++)dab({x:a.x+(b.x-a.x)*j/steps,y:a.y+(b.y-a.y)*j/steps});}
  const source=(e.tool==='clone'||e.tool==='soften')?data.slice():data;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const m=mask[(y-y0)*mw+x-x0];if(!m)continue;const i=(y*w+x)*4;
   for(let ch=0;ch<3;ch++){let target=data[i+ch];if(e.tool==='exposure')target*=2**e.amount;
    if(e.tool==='warmth')target+=(ch===0?1:ch===2?-1:0)*e.amount*.08*peak;
    if(e.tool==='clone'&&e.source){const sx=Math.round(x+(e.source.x-e.points[0].x)*w),sy=Math.round(y+(e.source.y-e.points[0].y)*h);if(sx<0||sx>=w||sy<0||sy>=h)continue;target=source[(sy*w+sx)*4+ch];}
    if(e.tool==='soften'){let sum=0,count=0;const step=Math.max(1,Math.round(Math.min(w,h)*.003));for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++){const px=Math.max(0,Math.min(w-1,x+xx*step)),py=Math.max(0,Math.min(h-1,y+yy*step));sum+=source[(py*w+px)*4+ch];count++;}target=sum/count;}
    data[i+ch]=Math.round(Math.max(0,Math.min(peak,data[i+ch]*(1-m)+target*m)));
   }
  }
 }
}
/**
 * Éclaircir ou assombrir le sujet détouré, ou le fond si `invert`.
 *
 * `amount` est en diaphragmes, comme l'exposition globale : c'est la retouche
 * qu'on veut faire à des mariés pris devant une fenêtre. La transparence du
 * masque est respectée, donc les cheveux et un voile se fondent au lieu de
 * former un contour découpé.
 */
function applySubject(data:Uint8ClampedArray|Uint16Array,w:number,h:number,e:LocalEdit,mask:SubjectMask,peak:number){
 const force=Math.max(0,Math.min(1,e.opacity));
 const gain=2**e.amount;
 if(!force||gain===1)return;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const brut=maskAt(mask,x,y,w,h);
  const m=(e.invert?1-brut:brut)*force;
  if(m<=0.002)continue;
  const i=(y*w+x)*4;
  for(let ch=0;ch<3;ch++)
   data[i+ch]=Math.round(Math.max(0,Math.min(peak,data[i+ch]*(1-m+m*gain))));
 }
}
export function encodeTiff16(data:Uint8ClampedArray|Uint16Array,w:number,h:number,icc?:Uint8Array):ArrayBuffer{
 // Uncompressed little-endian RGB, one strip, 16 bits per sample. Original files are never rewritten.
 const tags=icc?13:12,ifdSize=2+tags*12+4,bitsOffset=8+ifdSize,iccOffset=bitsOffset+6,pixelsOffset=iccOffset+(icc?.length||0),size=w*h*6;
 const out=new ArrayBuffer(pixelsOffset+size),v=new DataView(out);v.setUint16(0,0x4949,true);v.setUint16(2,42,true);v.setUint32(4,8,true);v.setUint16(8,tags,true);
 const entries=[[256,4,1,w],[257,4,1,h],[258,3,3,bitsOffset],[259,3,1,1],[262,3,1,2],[273,4,1,pixelsOffset],[274,3,1,1],[277,3,1,3],[278,4,1,h],[279,4,1,size],[284,3,1,1],[339,3,1,1]];
 if(icc){entries.push([34675,7,icc.length,iccOffset]);new Uint8Array(out,iccOffset,icc.length).set(icc);}
 entries.forEach(([tag,type,count,value],i)=>{const p=10+i*12;v.setUint16(p,tag,true);v.setUint16(p+2,type,true);v.setUint32(p+4,count,true);if(type===3&&count===1)v.setUint16(p+8,value,true);else v.setUint32(p+8,value,true)});
 [0,2,4].forEach(i=>v.setUint16(bitsOffset+i,16,true));const factor=data instanceof Uint16Array?1:257;
 for(let i=0;i<w*h;i++)for(let c=0;c<3;c++)v.setUint16(pixelsOffset+(i*3+c)*2,data[i*4+c]*factor,true);
 return out;
}
