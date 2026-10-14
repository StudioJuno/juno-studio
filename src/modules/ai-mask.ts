import type {Photo,Point} from '../model';import {effectiveCrop,sourceToDisplay as versEcran} from './geometry';import {toBlob} from '../image';
/** Un point de la source placé à l'écran, redressement compris : voir geometry.ts. */
export function sourceToDisplay(p:Point,photo:Photo){return versEcran(p,photo.adjustments,photo.width,photo.height)}
export async function createAIMask(photo:Photo,width:number,height:number){
 const edits=(photo.adjustments.localEdits||[]).filter(e=>e.tool==='mask'&&e.visible);if(!edits.length)return undefined;
 const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d')!;ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);ctx.globalCompositeOperation='destination-out';ctx.strokeStyle='#000';ctx.fillStyle='#000';ctx.lineCap='round';ctx.lineJoin='round';const crop=effectiveCrop(photo.adjustments,photo.width,photo.height),swap=photo.adjustments.rotation%180!==0,scale=width/(swap?photo.height*crop.h:photo.width*crop.w);
 for(const e of edits){ctx.lineWidth=2*e.radius*Math.min(photo.width,photo.height)*scale;ctx.globalAlpha=1;ctx.beginPath();e.points.forEach((p,i)=>{const q=sourceToDisplay(p,photo);if(i)ctx.lineTo(q.x*width,q.y*height);else ctx.moveTo(q.x*width,q.y*height)});if(e.points.length===1){const p=sourceToDisplay(e.points[0],photo);ctx.lineTo(p.x*width+.01,p.y*height)}ctx.stroke();}
 return (await toBlob(c,'image/png')).arrayBuffer();
}
