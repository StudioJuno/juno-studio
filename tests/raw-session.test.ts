import {it,expect,vi,afterEach} from 'vitest';
import {RawSession} from '../src/modules/raw-session';
import {photoFailure} from '../src/modules/image-errors';
class FakeWorker {
 static latest:FakeWorker; onmessage:any;onerror:any;onmessageerror:any;postMessage=vi.fn();terminate=vi.fn();
 constructor(){FakeWorker.latest=this;}
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('rapporte immédiatement la panne du décodeur, avec étape et cause',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const raw=new RawSession('file:///app/');const p=raw.open(new Uint8Array([1]),{}).catch(e=>e);
 FakeWorker.latest.onerror({preventDefault(){},message:'WebAssembly memory allocation failed'});
 const e=await p;expect(e.detail.code).toBe('RAW_WORKER_CRASH');expect(e.detail.stage).toBe('open');expect(e.detail.technical).toContain('memory');expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
});
it('conserve le vrai diagnostic si le worker échoue avant le premier appel',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const raw=new RawSession('file:///app/');FakeWorker.latest.onerror({preventDefault(){},message:'WASM startup failed'});
 await expect(raw.open(new Uint8Array([1]),{})).rejects.toMatchObject({detail:{code:'RAW_WORKER_CRASH',stage:'initialization',technical:'WASM startup failed'}});
});
it('distingue un délai dépassé de la corruption du fichier',async()=>{
 vi.useFakeTimers();vi.stubGlobal('Worker',FakeWorker);const raw=new RawSession('file:///app/',2000);const p=raw.imageData().catch(e=>e);await vi.advanceTimersByTimeAsync(2000);
 const e=await p;expect(e.detail).toMatchObject({code:'RAW_TIMEOUT',stage:'imageData',elapsedMs:2000,retryable:true});expect(e.message).not.toContain('disposed');
});
it('ignore une réponse périmée et normalise les métadonnées',async()=>{
 vi.stubGlobal('Worker',FakeWorker);const raw=new RawSession('file:///app/');const p=raw.metadata();FakeWorker.latest.onmessage({data:{id:99,out:{timestamp:0}}});FakeWorker.latest.onmessage({data:{id:1,out:{timestamp:1700000000}}});expect((await p).timestamp.getTime()).toBe(1700000000000);raw.dispose();
});
it('interprète les anciens journaux sans inventer une corruption',()=>{
 expect(photoFailure(Error('Développement RAW impossible : LibRaw disposed'))).toMatchObject({code:'RAW_TIMEOUT',retryable:true});expect(photoFailure(Error('Original indisponible'))).toMatchObject({code:'SOURCE_MISSING',retryable:false});
});
