import{describe,it,expect}from'vitest';import{DEFAULT,type Photo,type LocalEdit}from'../src/model';import{transform}from'../src/pixels';import{applyLocalEdits,encodeTiff16}from'../src/modules/local-edits';import{displayToSource}from'../src/modules/geometry';import{groupSuggestions,withFaces}from'../src/modules/culling';import * as UTIF from 'utif';
describe('precision et retouches locales',()=>{
 it('conserve des nuances 16 bits qui seraient perdues en 8 bits',()=>{const d=new Uint16Array([30000,30001,30002,65535]);transform(d,1,1,DEFAULT);expect([...d]).toEqual([30000,30001,30002,65535]);const encoded=encodeTiff16(d,1,1),ifd=UTIF.decode(encoded)[0];UTIF.decodeImage(encoded,ifd);expect(ifd.t258).toEqual([16,16,16]);const view=new DataView(ifd.data.buffer,ifd.data.byteOffset);expect([0,2,4].map(i=>view.getUint16(i,true))).toEqual([30000,30001,30002]);});
 it('un pinceau corrige sa zone et préserve les pixels hors masque',()=>{const d=new Uint16Array(20*20*4).fill(16000);const e:LocalEdit={id:'x',name:'Lumière',tool:'exposure',points:[{x:.5,y:.5},{x:.5,y:.5}],radius:.2,amount:1,opacity:1,visible:true};applyLocalEdits(d,20,20,[e]);expect(d[0]).toBe(16000);expect(d[(10*20+10)*4]).toBe(32000);expect(d[(10*20+10)*4+3]).toBe(16000);});
 it('un masque IA ne change aucun pixel',()=>{const d=new Uint8ClampedArray(400).fill(80),original=d.slice();applyLocalEdits(d,10,10,[{id:'m',name:'Zone',tool:'mask',points:[{x:.5,y:.5}],radius:.3,amount:1,opacity:1,visible:true}]);expect(d).toEqual(original)});
 it('inverse correctement la rotation et le cadrage pour peindre sur l’original',()=>{const p=displayToSource({x:.2,y:.4},{...DEFAULT,rotation:90,cropRect:{x:.1,y:.2,w:.5,h:.5}},6000,4000);expect(p.x).toBeCloseTo(.3);expect(p.y).toBeCloseTo(.6)});
});
describe('propositions de tri réversibles',()=>{
 const base={brightness:.5,sharpness:200,clipped:0,dhash:'0'.repeat(64),advice:'normal' as const,reasons:[]};
 it('préfère les yeux ouverts dans un groupe sans modifier les choix existants',()=>{const p=[{id:'a',projectId:'p',capturedAt:1000,width:100,height:100,status:'pending',analysis:withFaces(base,{count:1,closedEyes:1,blink:.9})},{id:'b',projectId:'p',capturedAt:1100,width:100,height:100,status:'pending',analysis:withFaces(base,{count:1,closedEyes:0,blink:0})}] as Photo[];const out=groupSuggestions(p);expect(out[1].analysis?.suggested).toBe(true);expect(out[0].analysis?.suggested).toBe(false);expect(out.map(p=>p.status)).toEqual(['pending','pending']);expect(p[1].analysis?.suggested).toBeUndefined()});
 it('ne propose jamais une image déjà écartée',()=>{const p=[{id:'a',width:100,height:100,status:'reject',analysis:base}] as Photo[];expect(groupSuggestions(p)[0].analysis?.suggested).toBe(false)});
});
import {readFileSync} from 'node:fs';
it('le TIFF exporté contient le profil sRGB sans modifier les nuances 16 bits',()=>{const profile=new Uint8Array(readFileSync(new URL('../public/color/sRGB.icc',import.meta.url))),d=new Uint16Array([30000,30001,30002,65535]);const encoded=encodeTiff16(d,1,1,profile),ifd=UTIF.decode(encoded)[0];expect(new Uint8Array(ifd.t34675)).toEqual(profile);UTIF.decodeImage(encoded,ifd);expect(new DataView(ifd.data.buffer,ifd.data.byteOffset).getUint16(0,true)).toBe(30000)});
it('ne mélange pas des photos semblables prises à des moments différents',()=>{const a={id:'a',projectId:'p',width:100,height:100,status:'pending',capturedAt:100000,analysis:{brightness:.5,sharpness:100,clipped:0,dhash:'0'.repeat(64),advice:'normal',reasons:[]}},b={...a,id:'b',capturedAt:200000};const out=groupSuggestions([a,b] as Photo[]);expect(out[0].analysis?.groupId).not.toBe(out[1].analysis?.groupId)});
import { thumbnailBlob } from "../src/modules/thumbnail-bitmap";
it("une vignette en data: est décodée sans passer par fetch", () => {
  // La politique de sécurité de l'application interdit à fetch de charger une
  // URL data: ; l'oublier donne un « Fetch API cannot load » peu parlant.
  const jpeg = "data:image/jpeg;base64," + btoa("bonjour");
  const blob = thumbnailBlob(jpeg)!;
  expect(blob).toBeInstanceOf(Blob);
  expect(blob.type).toBe("image/jpeg");
  expect(blob.size).toBe(7);
  expect(thumbnailBlob("data:image/png;base64," + btoa("x"))!.type).toBe(
    "image/png",
  );
  // Une URL ordinaire n'est pas décodée : elle repart vers fetch.
  expect(thumbnailBlob("https://exemple.fr/v.jpg")).toBeUndefined();
  expect(thumbnailBlob("")).toBeUndefined();
  expect(thumbnailBlob("data:image/jpeg")).toBeUndefined();
});
