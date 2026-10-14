import{describe,it,expect}from'vitest';
import{DEFAULT,autoSettings,hamming,chaptersFor,editPhoto,type Photo}from'../src/model';
import{transform,analyzePixels}from'../src/pixels';
describe('rendering preserves originals and neutral colors',()=>{
 it('neutral processing leaves all channels unchanged',()=>{const original=new Uint8ClampedArray([0,0,0,255,255,255,255,255,45,127,230,120]);const copy=new Uint8ClampedArray(original);transform(copy,3,1,DEFAULT);expect([...copy]).toEqual([...original]);});
 it('monochrome preserves alpha and produces equal color channels',()=>{const d=new Uint8ClampedArray([170,80,35,120]);transform(d,1,1,{...DEFAULT,style:'mono'});expect(d[0]).toBe(d[1]);expect(d[1]).toBe(d[2]);expect(d[3]).toBe(120)});
 it('extreme settings produce bounded pixels without alpha changes',()=>{const d=new Uint8ClampedArray([255,240,3,128]);transform(d,1,1,{...DEFAULT,exposure:2,contrast:100,warmth:100,saturation:100});expect([...d].every(n=>Number.isFinite(n)&&n>=0&&n<=255)).toBe(true);expect(d[3]).toBe(128)});
});
describe('local analysis is conservative',()=>{
 it('flags a dark featureless photo for human review',()=>{const d=new Uint8ClampedArray(16*16*4).fill(12);const a=analyzePixels(d,16,16);expect(a.advice).toBe('review');expect(a.reasons).toContain('Image très sombre');expect(a.dhash.length).toBe(64);expect(autoSettings(a).exposure).toBeLessThanOrEqual(1)});
 it('distinguishes identical and dissimilar hashes',()=>{expect(hamming('1010','1010')).toBe(0);expect(hamming('1010','0101')).toBe(4);expect(hamming('1','00')).toBe(999)});
});
describe('generic projects and non destructive history',()=>{
 it('supports product and unrestricted photo projects',()=>{expect(chaptersFor('Produit')).toContain('Packshots');expect(chaptersFor('Projet libre')).not.toContain('Cérémonie');expect(chaptersFor('Portrait')[0]).toBe('Tout le projet')});
 it('edits a copy and retains previous settings',()=>{const p={adjustments:{...DEFAULT},history:[]}as unknown as Photo;const q=editPhoto(p,{exposure:.5});expect(p.adjustments.exposure).toBe(0);expect(q.adjustments.exposure).toBe(.5);expect(q.history[0].exposure).toBe(0);expect(q.history).not.toBe(p.history)});
});
