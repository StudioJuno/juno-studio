import { PhotoError, photoFailure } from "./image-errors";

/** Own the decoder worker so its crashes and deadline retain their actual cause. */
export class RawSession {
  private worker: Worker;
  private slot?: { id:number; fn:string; start:number; resolve:(v:any)=>void; reject:(e:Error)=>void; timer:ReturnType<typeof setTimeout> };
  private sequence = 0;
  private closed = false;
  private lastError?: PhotoError;
  constructor(base: string, private timeoutMs = 120000) {
    this.worker = new Worker(new URL("./vendor/libraw/worker.js", base), { type:"module" });
    this.worker.onmessage = ({data}) => {
      const slot = this.slot;
      if (!slot || data?.id !== slot.id) return;
      clearTimeout(slot.timer); this.slot = undefined;
      if (data.error) slot.reject(new PhotoError({...photoFailure(Error(data.error),slot.fn),elapsedMs:Date.now()-slot.start}));
      else slot.resolve(data.out);
    };
    this.worker.onerror = event => {
      event.preventDefault();
      this.fail("RAW_WORKER_CRASH", "Le moteur RAW s’est arrêté pendant le décodage.", event.message || "Erreur du worker RAW");
    };
    this.worker.onmessageerror = () => this.fail("RAW_WORKER_MESSAGE", "Le résultat du moteur RAW n’a pas pu être lu.", "Erreur de transfert du worker RAW");
  }
  private fail(code:string,message:string,technical:string) {
    const slot=this.slot; this.slot=undefined;
    this.lastError=new PhotoError({code,stage:slot?.fn||"initialization",message,technical,retryable:true,elapsedMs:slot?Date.now()-slot.start:undefined});
    if(slot){clearTimeout(slot.timer);slot.reject(this.lastError);}
    this.worker.terminate();this.closed=true;
  }
  private call(fn:string,...args:any[]):Promise<any> {
    if(this.closed)return Promise.reject(this.lastError||Error("Session RAW fermée."));
    if(this.slot)return Promise.reject(Error("Une opération RAW est déjà en cours."));
    return new Promise((resolve,reject)=>{
      const id=++this.sequence,start=Date.now();
      const timer=setTimeout(()=>this.fail("RAW_TIMEOUT",`Le moteur RAW n’a pas terminé l’étape « ${fn} » après ${Math.round(this.timeoutMs/1000)} secondes.`,"Délai du décodeur RAW dépassé"),this.timeoutMs);
      this.slot={id,fn,start,resolve,reject,timer};
      try {this.worker.postMessage({id,fn,args},args.filter(a=>ArrayBuffer.isView(a)).map(a=>a.buffer));}
      catch(error){this.fail("RAW_WORKER_MESSAGE","Le fichier n’a pas pu être transmis au moteur RAW.",String(error));}
    });
  }
  open(bytes:Uint8Array,settings:Record<string,unknown>){return this.call("open",bytes,settings);}
  async metadata(){const m=await this.call("metadata",false);if(m?.timestamp)m.timestamp=new Date(m.timestamp*1000);return m;}
  imageData(){return this.call("imageData");}
  /** Embedded JPEG preview: present in modern RAW files, decoded in milliseconds. */
  thumbnailData(){return this.call("thumbnailData");}
  dispose(){if(this.closed)return;this.fail("RAW_CLOSED","Le moteur RAW a été arrêté.","Fin de session RAW");}
}
