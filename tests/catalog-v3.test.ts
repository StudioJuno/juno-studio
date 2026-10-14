import 'fake-indexeddb/auto';
import {beforeAll,it,expect} from 'vitest';
import {DEFAULT,type Photo} from '../src/model';
let db:typeof import('../src/db');
const photo=(id:string,projectId='p'):Photo=>({id,projectId,name:id+'.jpg',source:'idb',thumbnail:'data:image/jpeg;base64,YWJj',width:100,height:100,size:10,hash:'a'.repeat(64),status:'pending',stars:0,protected:false,chapter:'Portraits',adjustments:{...DEFAULT},history:[],created:1});
beforeAll(async()=>{
 const old=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('juno-studio-v1',1);req.onupgradeneeded=()=>{req.result.createObjectStore('projects',{keyPath:'id'});req.result.createObjectStore('photos',{keyPath:'id'});req.result.createObjectStore('originals');req.result.createObjectStore('settings')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
 const tx=old.transaction(['photos','originals'],'readwrite');tx.objectStore('photos').put(photo('legacy'));tx.objectStore('originals').put(new Blob(['original']),'legacy');await new Promise<void>(r=>tx.oncomplete=()=>r());old.close();db=await import('../src/db');await db.database;
});
it('migre le catalogue v1 sans perdre vignette, original ou réglages',async()=>{const ps=await db.getPhotos('p');expect(ps[0].thumbnail).toBe('');expect(await db.getThumbnail('legacy')).toBe('data:image/jpeg;base64,YWJj');expect(await(await db.getOriginal('legacy')).text()).toBe('original');expect(ps[0].adjustments).toEqual(DEFAULT)});
it('les écritures de tâche et les choix du photographe se combinent',async()=>{await Promise.all([db.modifyPhoto('legacy',p=>({...p,stars:5})),db.modifyPhoto('legacy',p=>({...p,analysis:{brightness:.5,sharpness:100,clipped:0,dhash:'0'.repeat(64),advice:'normal',reasons:[]}}))]);const p=await db.getPhoto('legacy');expect(p?.stars).toBe(5);expect(p?.analysis?.sharpness).toBe(100);expect(await db.getThumbnail('legacy')).not.toBe('')});
it('charge uniquement les métadonnées du projet demandé',async()=>{await db.putPhotos(Array.from({length:5000},(_,i)=>photo('large-'+i,'large')));await db.putPhotos(Array.from({length:100},(_,i)=>photo('other-'+i,'other')));const ps=await db.getPhotos('large');expect(ps).toHaveLength(5000);expect(ps.every(p=>p.projectId==='large'&&p.thumbnail==='')).toBe(true);expect(JSON.stringify(ps).length).toBeLessThan(5_000_000)},20000);
