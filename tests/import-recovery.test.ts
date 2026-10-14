import 'fake-indexeddb/auto';
import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({fail:true,calls:[] as string[]}));
vi.stubGlobal('window',{dispatchEvent(){}});
vi.mock('../src/image',()=>({
 inspect:vi.fn(async(_blob:Blob,name:string)=>{state.calls.push(name);if(state.fail&&name.startsWith('bad'))throw Error('Développement RAW impossible : LibRaw disposed');return {width:100,height:150,thumbnail:'',analysis:{brightness:.5,sharpness:100,clipped:0,dhash:'0'.repeat(64),advice:'normal',reasons:[]}}}),
 inspectionSource:async(_item:any,blob:Blob)=>blob,
 fingerprint:async(b:Blob)=>'hash-'+await b.text(),sourceBlob:vi.fn(),exportPhoto:vi.fn(),download:vi.fn()
}));
import {database,putProject,putOriginal,getPhotos} from '../src/db';
import {enqueueJob,subscribeJobs,retryJobFailures,jobIssues,clearFinishedJobs,remainingErrors} from '../src/modules/jobs';
const wait=async(id:string)=>{const until=Date.now()+10000;while(Date.now()<until){const j=await(await database).get('jobs',id);if(['done','failed','paused'].includes(j?.state))return j;await new Promise(r=>setTimeout(r,5))}throw Error('Timeout')};
it('retries only failed imports, preserves the successful photo and resolves the original report',async()=>{
 const project={id:'import-recovery',name:'Test',date:'',location:'',demo:false,created:Date.now()};await putProject(project);
 const items=[];for(let i=0;i<8;i++){const id='recovery-'+i;await putOriginal(id,new Blob(['bytes-'+i]));items.push({id,name:(i?'bad':'good')+i+'.CR3',source:'idb',size:7});}
 const id=await enqueueJob('import',project,items);let j=await wait(id);expect(j.errorCount).toBe(7);expect((await getPhotos(project.id)).length).toBe(1);expect(state.calls.length).toBe(15);
 await clearFinishedJobs();expect(await(await database).get('jobs',id)).toBeDefined();expect((await jobIssues(id)).every(e=>e.failure.code==='RAW_TIMEOUT')).toBe(true);
 const preserved=(await getPhotos(project.id))[0];preserved.stars=5;await(await database).put('photos',preserved);
 state.fail=false;state.calls=[];const retry=await retryJobFailures(id);await wait(retry!);
 expect(state.calls.length).toBe(7);expect(state.calls.every(x=>x.startsWith('bad'))).toBe(true);expect((await getPhotos(project.id)).length).toBe(8);expect((await getPhotos(project.id)).find(x=>x.id===preserved.id)?.stars).toBe(5);
 j=await(await database).get('jobs',id);expect(j.resolvedCount).toBe(7);expect(remainingErrors(j)).toBe(0);expect((await jobIssues(id)).every(e=>e.resolvedBy===retry)).toBe(true);
 await expect(retryJobFailures(id)).rejects.toThrow('Aucun fichier');
});
