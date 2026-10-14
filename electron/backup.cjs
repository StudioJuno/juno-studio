const fs=require('node:fs/promises');const {createReadStream}=require('node:fs');const path=require('node:path');const {randomUUID,createHash}=require('node:crypto');
const {PLAFOND_EXPORT}=require('./export.cjs');
const hashFile=async file=>{const hash=createHash('sha256');for await(const c of createReadStream(file))hash.update(c);return hash.digest('hex')};
const basename=name=>typeof name==='string'&&name.length<=240&&name===path.basename(name)&&name!=='.'&&name!=='..'&&!/[\\/\x00]/.test(name);
/*
 * Le miroir des refus de src/modules/catalog-validation.ts (validateCatalog),
 * joué AVANT de copier le moindre original. La fenêtre valide le catalogue
 * après la copie : une sauvegarde qu'elle refusait laissait toutes ses copies
 * dans restored-originals et leurs entrées dans assets.json, et chaque nouvel
 * essai en ajoutait une série. Seuls les refus sont repris ici, la fenêtre
 * revalide et nettoie ensuite ; tests/catalogue-corrections.test.ts vérifie
 * que les deux jugent pareil.
 */
const refus=()=>{throw Error('Le catalogue contient des réglages invalides.')};
const nombre=(v,min,max)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)refus();return v};
const point=p=>{if(!p||typeof p!=='object')refus();return{x:Math.min(1,Math.max(0,nombre(p.x,-1e-6,1+1e-6))),y:Math.min(1,Math.max(0,nombre(p.y,-1e-6,1+1e-6)))}};
const BORNES={exposure:[-4,4],contrast:[-100,100],highlights:[-100,100],shadows:[-100,100],warmth:[-100,100],tint:[-100,100],saturation:[-100,100],fade:[-100,100],vignette:[-100,100],grain:[-100,100],rotation:[0,270],crop:[0,40],intensity:[0,100],whites:[-100,100],blacks:[-100,100],vibrance:[-100,100],clarity:[-100,100],sharpening:[0,100],noiseReduction:[0,100],straighten:[-45,45]};
const BANDES=['red','orange','yellow','green','aqua','blue','purple','magenta'],OUTILS=['exposure','warmth','soften','clone','mask','subject'];
function verifierReglages(a){
 if(!a||typeof a!=='object')refus();
 for(const [cle,[min,max]] of Object.entries(BORNES))if(a[cle]!==undefined)nombre(a[cle],min,max);
 if(a.rotation!==undefined&&![0,90,180,270].includes(a.rotation))refus();
 if(a.curves!==undefined){if(!a.curves||typeof a.curves!=='object')refus();for(const canal of ['rgb','red','green','blue']){const pts=a.curves[canal];if(pts===undefined)continue;if(!Array.isArray(pts)||pts.length<2||pts.length>16)refus();const q=pts.map(point);if(q[0].x!==0||q[q.length-1].x!==1||q.some((p,i)=>i>0&&p.x<=q[i-1].x))refus()}}
 if(a.colorMix!==undefined){if(!a.colorMix||typeof a.colorMix!=='object')refus();for(const b of BANDES){const m=a.colorMix[b];if(m!==undefined){nombre(m.hue,-100,100);nombre(m.saturation,-100,100);nombre(m.luminance,-100,100)}}}
 if(a.cropRect){const c=a.cropRect;nombre(c.x,0,1);nombre(c.y,0,1);nombre(c.w,.001,1);nombre(c.h,.001,1);if(c.x+c.w>1.000001||c.y+c.h>1.000001)refus()}
 if(a.localEdits){if(!Array.isArray(a.localEdits)||a.localEdits.length>100)refus();for(const e of a.localEdits){if(!e||typeof e.id!=='string'||typeof e.name!=='string'||!OUTILS.includes(e.tool)||!Array.isArray(e.points)||e.points.length>2000||(!e.points.length&&e.tool!=='subject'))refus();e.points.forEach(point);nombre(e.radius,e.tool==='subject'?0:.001,.5);nombre(e.amount,-Infinity,Infinity);nombre(e.opacity,0,1);if(e.source)point(e.source)}}
}
function verifierAnalyse(a){
 if(typeof a!=='object'||!['normal','review'].includes(a.advice)||typeof a.dhash!=='string'||!/^[01]{64}$/.test(a.dhash)||!Array.isArray(a.reasons)||a.reasons.length>100||a.reasons.some(x=>typeof x!=='string'||x.length>500))throw Error('Analyse de photo invalide.');
 nombre(a.brightness,0,1);nombre(a.sharpness,0,1e12);nombre(a.clipped,0,1);
 if(a.level){if(typeof a.level!=='object'||!['auto','suggest','level','abstain'].includes(a.level.tier)||typeof a.level.reason!=='string'||a.level.reason.length>200||typeof a.level.version!=='string')throw Error('Mesure d’inclinaison invalide.');if(a.level.angle!==null)nombre(a.level.angle,-45,45)}
 if(a.nettetePointe!==undefined)nombre(a.nettetePointe,0,1e9);
 if(a.empreinte){const e=a.empreinte;if(typeof e!=='object'||typeof e.version!=='string'||e.version.length>40||!Number.isInteger(e.gw)||!Number.isInteger(e.gh)||e.gw<1||e.gh<1||e.gw>64||e.gh>64||typeof e.g!=='string'||e.g.length>8192||!/^[A-Za-z0-9+/]*={0,2}$/.test(e.g)||!Array.isArray(e.hist)||e.hist.length!==64||!Array.isArray(e.hog)||e.hog.length!==128)throw Error('Empreinte de rafale invalide.');for(const v of e.hist)nombre(v,0,1);for(const v of e.hog)nombre(v,0,1);if(e.instant!==undefined)nombre(e.instant,-8640000000000000,8640000000000000);if(e.boitier!==undefined&&(typeof e.boitier!=='string'||e.boitier.length>64))throw Error('Empreinte de rafale invalide.')}
 if(a.faces){const f=a.faces;nombre(f.count,0,100);if(Array.isArray(f.reads))for(const r of f.reads){if(r?.nettete!==undefined)nombre(r.nettete,0,1);if(r?.ecrete!==undefined)nombre(r.ecrete,0,1)}nombre(f.closedEyes,0,f.count);nombre(f.blink,0,1);if(f.regions){if(!Array.isArray(f.regions)||f.regions.length>20)throw Error('Visages invalides.');for(const r of f.regions){nombre(r.x,0,1);nombre(r.y,0,1);nombre(r.w,0,1);nombre(r.h,0,1);if(r.x+r.w>1.00001||r.y+r.h>1.00001)throw Error('Visage hors cadre.')}}}
}
function verifierCatalogue(project,photos){
 if(!project||typeof project.id!=='string'||typeof project.name!=='string'||project.name.length>250||!Array.isArray(photos)||photos.length>50000)throw Error('Catalogue invalide.');
 if(typeof project.date!=='string'||typeof project.location!=='string'||(project.kind!==undefined&&typeof project.kind!=='string'))throw Error('Informations de projet invalides.');
 nombre(project.created,0,Number.MAX_SAFE_INTEGER);
 const ids=new Set();
 for(const p of photos){
  if(!p||typeof p.id!=='string'||ids.has(p.id)||p.projectId!==project.id||typeof p.name!=='string'||p.name.length>1000||!['pending','keep','reject'].includes(p.status)||typeof p.source!=='string'||typeof p.thumbnail!=='string'||p.thumbnail.length>1000000||(!/^data:image\/(jpeg|png|webp);base64,/.test(p.thumbnail)&&p.thumbnail!==''))throw Error('Photo invalide dans le catalogue.');
  ids.add(p.id);
  if(p.capturedAt!==undefined)nombre(p.capturedAt,-8640000000000000,8640000000000000);
  if(p.color&&(!['raw','embedded','assumed'].includes(p.color.source)||p.color.space!=='sRGB'||typeof p.color.profile!=='string'||p.color.profile.length>200))throw Error('Profil couleur invalide.');
  nombre(p.created,0,Number.MAX_SAFE_INTEGER);nombre(p.size,0,1024**4);
  if(p.analysis)verifierAnalyse(p.analysis);
  nombre(p.width,1,100000);nombre(p.height,1,100000);nombre(p.stars,0,5);
  verifierReglages(p.adjustments);
  for(const pile of [p.history,p.future])(Array.isArray(pile)?pile:[]).slice(-40).forEach(verifierReglages);
  if(p.originalRecovery)verifierReglages(p.originalRecovery);
  if(p.versions!=null){if(!Array.isArray(p.versions))throw Error('Version invalide.');for(const v of p.versions.slice(-20)){nombre(v.created,0,Number.MAX_SAFE_INTEGER);if(typeof v.name!=='string'||typeof v.id!=='string')throw Error('Version invalide.');verifierReglages(v.adjustments)}}
 }
}
/*
 * Le miroir du nettoyage de validateCatalog, pour les fiches rendues à la
 * fenêtre. App.restoreBackup affiche ces fiches telles quelles juste après les
 * avoir enregistrées : un verdict qui n'était pas un texte (sauvegarde forgée)
 * faisait planter l'écran dès la restauration, même avec un catalogue enregistré
 * propre. Les champs descriptifs du mauvais type sont retirés, comme dans la
 * fenêtre ; tests/catalogue-corrections.test.ts compare les deux.
 */
const texte=max=>v=>typeof v==='string'?v.slice(0,max):undefined;
const fini=(min=-Number.MAX_VALUE,max=Number.MAX_VALUE)=>v=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:undefined;
const booleen=v=>typeof v==='boolean'?v:undefined;
const objet=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:undefined;
const mesures=(v,requis=[])=>{const o=objet(v);return !o||requis.some(k=>o[k]===undefined)||Object.values(o).some(x=>fini()(x)===undefined)?undefined:o};
const nombres=v=>Array.isArray(v)&&v.length<=4096&&v.every(x=>fini()(x)!==undefined)?v:undefined;
function recopie(source,regles){const out={...source};for(const [cle,regle] of Object.entries(regles)){if(out[cle]===undefined)continue;const v=regle(out[cle]);if(v===undefined)delete out[cle];else out[cle]=v}return out}
function lectureSaine(r){const o=objet(r);if(!o)return false;if(o.region!==undefined&&!mesures(o.region,['x','y','w','h']))return false;for(const k of ['weight','sharpness','nettete','ecrete','eyesClosed','smile','turned'])if(o[k]!==undefined&&fini()(o[k])===undefined)return false;for(const k of ['signature','descriptor'])if(o[k]!==undefined&&!nombres(o[k]))return false;return o.personId===undefined||typeof o.personId==='string'}
function visagesRecus(f){const lectures=Array.isArray(f.reads)?f.reads:undefined,saines=lectures?.filter(lectureSaine),intactes=f.reads===undefined||(!!lectures&&saines.length===lectures.length);const out=recopie(f,{version:intactes?texte(40):()=>undefined,subjectSharpness:fini(0)});if(saines)out.reads=saines;else delete out.reads;return out}
const analyseRecue=a=>recopie({...a,...(a.faces?{faces:visagesRecus(a.faces)}:{})},{verdict:texte(500),groupId:texte(200),suggested:booleen,sharpnessWidth:fini(0),cast:v=>mesures(v,['r','g','b']),look:v=>mesures(v)});
const REGLES_FICHE={hash:texte(128),chapter:texte(200),moment:texte(200),prompt:texte(4000),parentId:texte(200),remotePhotoId:texte(200),editGroup:texte(200),protected:v=>v===true,generated:booleen,previewOnly:booleen,proposalLearned:booleen,revision:fini(0,Number.MAX_SAFE_INTEGER),bitDepth:fini(1,64),
 camera:v=>{const o=objet(v);return o?recopie(o,{make:texte(100),model:texte(100),iso:fini(0),aperture:fini(0),shutter:fini(0)}):undefined},
 proposal:v=>{const o=objet(v);return o?Object.fromEntries(Object.entries(o).filter(([,x])=>fini()(x)!==undefined)):undefined}};
const ficheRecue=p=>({...recopie(p,REGLES_FICHE),...(p.analysis?{analysis:analyseRecue(p.analysis)}:{})});
/**
 * Le résumé de sens arrive du JSON en objet {"0": …, "767": …}. Le repasser en
 * Float32Array avant de l'envoyer à la fenêtre divise par sept ce que la
 * restauration d'un gros album fait transiter ; la fenêtre le revalide.
 */
function resumeCompact(v){if(!v||typeof v!=='object'||Array.isArray(v))return v;const valeurs=Object.values(v);if(!valeurs.length||valeurs.length>4096||!Object.keys(v).every((c,i)=>c===String(i))||!valeurs.every(x=>typeof x==='number'&&Number.isFinite(x)))return v;return Float32Array.from(valeurs)}
function registerBackup({handle,app,dialog,getWindow,assets,persistAssets,exportDirs,origins={},persistOrigins=async()=>{}}){
 // Les copies que Juno garde lui-même : jamais remplacées par un fichier externe.
 const geres=()=>[path.join(app.getPath('userData'),'Originals'),path.join(app.getPath('userData'),'restored-originals')];
 const gere=file=>typeof file==='string'&&geres().some(d=>{const r=path.relative(d,file);return !!r&&!r.startsWith('..')&&!path.isAbsolute(r)});
 handle('copy-original',async(token,name,source,bytes)=>{const dir=exportDirs.get(token);if(!dir||!basename(name))throw Error('Destination de sauvegarde invalide.');const dest=path.join(dir,name);let file;
 if(typeof source==='string'&&source.startsWith('juno://image/'))file=assets[source.slice('juno://image/'.length)];
 if(file)await fs.copyFile(file,dest,require('node:fs').constants.COPYFILE_EXCL);else{if(!(bytes instanceof ArrayBuffer)||bytes.byteLength>1024*1024*1024)throw Error('Original invalide.');await fs.writeFile(dest,Buffer.from(bytes),{flag:'wx'})}
 return{sha256:await hashFile(dest),size:(await fs.stat(dest)).size};
 });
 handle('restore-backup',async()=>{
  const choice=await dialog.showOpenDialog(getWindow(),{title:'Restaurer une sauvegarde Juno',properties:['openFile'],filters:[{name:'Catalogue de sauvegarde',extensions:['json']}]});if(choice.canceled)return null;
  // Le plafond est celui de l'écriture (write-export) : ce que la sauvegarde
  // écrit se restaure. À 128 Mo, un album analysé de plus d'environ 1 800
  // photos était annoncé « complet » puis refusé à la restauration.
  const manifestPath=choice.filePaths[0];if((await fs.stat(manifestPath)).size>PLAFOND_EXPORT)throw Error('Catalogue de sauvegarde trop volumineux.');const data=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  if(data.schema!==2||!data.project||typeof data.project.name!=='string'||!Array.isArray(data.photos)||data.photos.length>50000)throw Error('Ce fichier n’est pas une sauvegarde Juno complète.');
  const ids=new Set(),newIds=new Map();for(const p of data.photos){if(typeof p.id!=='string'||ids.has(p.id)||!basename(p.originalFile)||!/^[a-f0-9]{64}$/.test(p.hash)||typeof p.name!=='string'||typeof p.thumbnail!=='string'||!p.thumbnail.startsWith('data:image/')||!p.adjustments||!Array.isArray(p.history)||!Number.isFinite(p.width)||!Number.isFinite(p.height))throw Error('Une photo de la sauvegarde est invalide.');ids.add(p.id);newIds.set(p.id,randomUUID())}
  const projectId=randomUUID(),project={...data.project,id:projectId,name:data.project.name+' · restauré',demo:false,created:Date.now(),sharedRevision:undefined,remoteId:undefined,remoteServer:undefined};
  const photos=data.photos.map(p=>{const id=newIds.get(p.id),{originalFile,...photo}=p;return{...photo,semantic:resumeCompact(photo.semantic),id,projectId,source:'juno://image/'+id,previewOnly:false,parentId:p.parentId?newIds.get(p.parentId):undefined}});
  verifierCatalogue(project,photos);const fiches=photos.map(ficheRecue);
  const folder=path.join(app.getPath('userData'),'restored-originals',projectId),additions={};await fs.mkdir(folder,{recursive:true});
  try{for(const [i,p] of data.photos.entries()){const origin=path.join(path.dirname(manifestPath),p.originalFile);const info=await fs.lstat(origin);if(!info.isFile()||info.isSymbolicLink())throw Error('Original absent ou lien interdit : '+p.name);const id=photos[i].id,dest=path.join(folder,id+path.extname(p.originalFile));await fs.copyFile(origin,dest,require('node:fs').constants.COPYFILE_EXCL);if(await hashFile(dest)!==p.hash)throw Error('Intégrité incorrecte : '+p.name);additions[id]=dest;}
   Object.assign(assets,additions);await persistAssets();return{project,photos:fiches};
  }catch(e){for(const id of Object.keys(additions))delete assets[id];await fs.rm(folder,{recursive:true,force:true});throw e}
 });
 handle('relink-originals',async records=>{if(!Array.isArray(records)||records.length>50000)throw Error('Catalogue invalide.');const choice=await dialog.showOpenDialog(getWindow(),{title:'Relier les originaux du projet',properties:['openFile','multiSelections']});if(choice.canceled)return[];const byHash=new Map(records.filter(p=>typeof p.id==='string'&&/^[a-f0-9]{64}$/.test(p.hash)).map(p=>[p.hash,p.id]));const found=[];
  for(const f of choice.filePaths){const hash=await hashFile(f),id=byHash.get(hash);if(!id)continue;
   // La copie vérifiée que Juno garde déjà reste la source : le fichier choisi
   // (une carte, un disque externe) peut disparaître demain, et Juno aurait
   // déclaré l'original introuvable alors que sa copie était intacte. Seul son
   // emplacement est retenu, pour Lightroom.
   const actuel=assets[id];if(!(gere(actuel)&&await hashFile(actuel).catch(()=>'')===hash))assets[id]=f;
   origins[id]=f;found.push({id,source:'juno://image/'+id})}
  await persistAssets();await persistOrigins().catch(()=>{});return found;});
}
module.exports={registerBackup,hashFile,verifierCatalogue};
