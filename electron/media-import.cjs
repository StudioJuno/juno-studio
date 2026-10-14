const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const formats=require('./media-formats.json');
const ext=name=>path.extname(name).slice(1).toLowerCase();
const kind=name=>[...formats.raw,...formats.photo,...formats.nativePhoto].includes(ext(name))?'photo':formats.audio.includes(ext(name))?'audio':formats.video.includes(ext(name))?'video':'unknown';
const filters=[{name:'Tous les fichiers',extensions:['*']},{name:'Photos et images',extensions:[...formats.raw,...formats.photo,...formats.nativePhoto]},{name:'Vidéos',extensions:formats.video},{name:'Sons et musique',extensions:formats.audio}];
// `origins` garde où le photographe range chaque fichier : `assets` finit par
// pointer vers la copie de Juno, et l'envoi à Lightroom a besoin de l'original.
function registerMediaImport({handle,dialog,getWindow,assets,persistAssets,origins={},persistOrigins=async()=>{}}){
 async function register(files){
  if(!Array.isArray(files)||files.length>20000||files.some(f=>typeof f!=='string'||!path.isAbsolute(f)))throw Error('Sélection de fichiers invalide.');
  const output=[];
  for(const file of files){const id=randomUUID(),s=await fs.stat(file).catch(()=>null);assets[id]=file;origins[id]=file;output.push({id,name:path.basename(file),size:s?.size||0,source:'juno://image/'+id,kind:kind(file)});}
  if(output.length){await persistAssets();await persistOrigins().catch(()=>{});}return output;
 }
 handle('pick-images',async()=>{const r=await dialog.showOpenDialog(getWindow(),{title:'Importer photos, vidéos et sons',properties:['openFile','multiSelections'],filters});return r.canceled?[]:register(r.filePaths);});
 handle('register-dropped-media',register);
 return {register};
}
module.exports={registerMediaImport,formats,kind,filters};
