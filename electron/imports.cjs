const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');
const {createHash,randomUUID} = require('node:crypto');
const {Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');

function registerImports({handle,app,dialog,shell,getWindow,assets,persistAssets,origins={},persistOrigins=async()=>{}}) {
 const registered={};const register=(name,fn)=>{registered[name]=fn;handle(name,fn);};
 const directory=path.join(app.getPath('userData'),'Originals'),locks=new Map();
 const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,90}$/.test(id)&&Object.hasOwn(assets,id);
 const digest=async file=>{const h=createHash('sha256');for await(const b of fss.createReadStream(file))h.update(b);return h.digest('hex');};
 const stat=async file=>{try{return await fs.stat(file)}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 /*
  * Les copies déjà gardées dans Originals, rangées par taille, et leur empreinte
  * une fois lue. La fenêtre sécurise chaque fichier d'une carte AVANT de savoir
  * s'il est déjà dans le projet (jobs.ts) : réimporter une carte recopiait
  * chaque original une seconde fois, puis l'écartait comme doublon en laissant
  * la copie. Un contenu déjà gardé est désormais repris tel quel : la nouvelle
  * entrée pointe vers la copie existante, que rien ne modifie ni ne supprime.
  */
 let parTaille=null;const empreintes=new Map();
 const retenir=(taille,file)=>{if(!parTaille.has(taille))parTaille.set(taille,new Set());parTaille.get(taille).add(file);};
 async function copiesDeTaille(taille){
  if(!parTaille){parTaille=new Map();for(const file of new Set(Object.values(assets))){if(typeof file!=='string'||path.dirname(file)!==directory)continue;const s=await stat(file).catch(()=>null);if(s?.isFile())retenir(s.size,file);}}
  return [...(parTaille.get(taille)||[])];
 }
 /** La copie gardée qui a exactement ce contenu, relue avant d'être reprise. */
 async function copieIdentique(taille,hash){
  for(const file of await copiesDeTaille(taille)){
   let connue=empreintes.get(file),lue=false;
   if(!connue){connue=await digest(file).catch(()=>'');lue=!!connue;if(connue)empreintes.set(file,connue);}
   if(connue!==hash)continue;
   // Une empreinte gardée en mémoire peut dater : la copie est alors relue.
   if(lue||await digest(file).catch(()=>'')===hash)return file;
   empreintes.delete(file);
  }
  return null;
 }
 register('import-source-info',async id=>{
  if(!validId(id))throw Error('Fichier importé inconnu.');
  const file=assets[id],s=await stat(file);
  return {path:file,exists:!!s?.isFile(),size:s?.size,managed:path.dirname(file)===directory};
 });
 register('secure-import-source',async input=>{
  if(!validId(input?.id))throw Error('Fichier importé inconnu.');
  if(locks.has(input.id))return locks.get(input.id);
  const work=(async()=>{
   const source=assets[input.id],s=await stat(source);
   if(!s?.isFile())throw Error('Original indisponible. Retrouvez le fichier source pour reprendre.');
   if(!s.size)throw Error('Le fichier source est vide.');
   if(input.hash&&!/^[a-f0-9]{64}$/.test(input.hash))throw Error('Empreinte invalide.');
   if(path.dirname(source)===directory){const hash=await digest(source);if(input.hash&&input.hash!==hash)throw Error('Le fichier source a changé depuis la première tentative.');return {hash,size:s.size,managed:true};}
   if((await copiesDeTaille(s.size)).length){
    const hash=await digest(source),after=await stat(source);
    if(!after||after.size!==s.size||after.mtimeMs!==s.mtimeMs)throw Error('Le fichier a changé pendant sa lecture. Reprenez après la fin de son téléchargement.');
    if(input.hash&&input.hash!==hash)throw Error('Le fichier source ne correspond pas à la première tentative.');
    const copie=await copieIdentique(s.size,hash);
    if(copie){assets[input.id]=copie;try{await persistAssets()}catch(error){assets[input.id]=source;throw error;}return {hash,size:s.size,managed:true};}
   }
   await fs.mkdir(directory,{recursive:true,mode:0o700});
   const space=await fs.statfs(directory);if(space.bavail*space.bsize<s.size+256*1024*1024)throw Error('Espace insuffisant pour conserver une copie de cet original.');
   const suffix=path.extname(source).toLowerCase(),ext=/^\.[a-z0-9]{1,8}$/.test(suffix)?suffix:'.media';
   const target=path.join(directory,input.id+ext),temp=target+'.'+randomUUID()+'.part',hash=createHash('sha256');
   try {
    await pipeline(fss.createReadStream(source),new Transform({transform(chunk,_encoding,callback){hash.update(chunk);callback(null,chunk)}}),fss.createWriteStream(temp,{flags:'wx',mode:0o600}));
    const value=hash.digest('hex'),copied=await fs.stat(temp),after=await fs.stat(source);
    if(copied.size!==s.size||after.size!==s.size||after.mtimeMs!==s.mtimeMs)throw Error('Le fichier a changé pendant sa copie. Reprenez après la fin de son téléchargement.');
    if(input.hash&&input.hash!==value)throw Error('Le fichier source ne correspond pas à la première tentative.');
    if(await digest(temp)!==value)throw Error('La vérification de la copie a échoué.');
    const h=await fs.open(temp,'r+');try{await h.sync()}finally{await h.close()}
    const existing=await stat(target);
    if(existing){if(await digest(target)!==value)throw Error('Une copie différente de cet original existe déjà.');await fs.unlink(temp);}else await fs.rename(temp,target);
    assets[input.id]=target;
    try{await persistAssets()}catch(error){assets[input.id]=source;throw error;}
    empreintes.set(target,value);if(parTaille)retenir(s.size,target);
    return {hash:value,size:s.size,managed:true};
   }finally{await fs.unlink(temp).catch(()=>{});}
  })();
  locks.set(input.id,work);try{return await work}finally{locks.delete(input.id);}
 });
 register('locate-import-source',async input=>{
  if(!validId(input?.id)||typeof input.name!=='string'||!Number.isSafeInteger(input.size))throw Error('Référence du fichier invalide.');
  const choice=await dialog.showOpenDialog(getWindow(),{title:'Retrouver '+path.basename(input.name),properties:['openFile']});
  if(choice.canceled||!choice.filePaths?.[0])return false;
  const file=choice.filePaths[0],s=await fs.stat(file);
  if(!s.isFile()||(input.size>0&&s.size!==input.size))throw Error('La taille du fichier ne correspond pas à l’original attendu.');
  if(input.hash){if(!/^[a-f0-9]{64}$/.test(input.hash)||await digest(file)!==input.hash)throw Error('Ce fichier ne correspond pas à l’empreinte de l’original.');}
  else if(path.basename(file)!==path.basename(input.name))throw Error('Sélectionnez le fichier portant le nom d’origine.');
  const old=assets[input.id];assets[input.id]=file;try{await persistAssets()}catch(e){assets[input.id]=old;throw e;}
  origins[input.id]=file;await persistOrigins().catch(()=>{});return true;
 });
 register('reveal-import-source',async id=>{
  if(!validId(id))throw Error('Fichier importé inconnu.');
  if(!(await stat(assets[id]))?.isFile())throw Error('Original indisponible. Retrouvez le fichier source.');
  shell.showItemInFolder(assets[id]);return true;
 });
 return registered;
}
module.exports={registerImports};
