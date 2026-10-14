const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {registerMediaImport}=require('../electron/media-import.cjs'),{registerImports}=require('../electron/imports.cjs'),{registerVideo}=require('../electron/video/index.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function done(api,id){for(let i=0;i<1200;i++){const j=api['video-list']().jobs.find(j=>j.id===id);if(['done','failed'].includes(j.state)){assert.equal(j.state,'done',j.error);return j;}await wait(50);}throw Error('Import timeout');}
test('mixed media are registered, copied, decoded and failed files remain diagnosable and retryable',{timeout:180000},async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juno-media-')),api={},assets={},events={};let selected=[],saveTo='';
 const app={getPath:()=>root,getVersion:()=>'0.0.0-test',on:(name,fn)=>events[name]=fn},dialog={showOpenDialog:async()=>({canceled:false,filePaths:selected}),showSaveDialog:async()=>({canceled:false,filePath:saveTo})},handle=(n,f)=>api[n]=f,persistAssets=async()=>{};
 const imports=registerImports({handle,app,dialog,shell:{},getWindow:()=>undefined,assets,persistAssets});
 const media=registerMediaImport({handle,dialog,getWindow:()=>undefined,assets,persistAssets});
 const video=await registerVideo({handle,app,dialog,protocol:{handle(){}},getWindow:()=>undefined,nativeRoot:path.join(__dirname,'../native',process.platform+'-'+process.arch),colorRoot:path.join(__dirname,'../public/video-color'),registerMediaFiles:media.register,secureMedia:async id=>{await imports['secure-import-source']({id});return assets[id]},locateMedia:input=>imports['locate-import-source'](input),resolveMedia:id=>assets[id]});
 try{
  const src=path.join(root,'source');await fs.mkdir(src);
  const wav=path.join(src,'interview.wav'),opus=path.join(src,'musique.opus'),movie=path.join(src,'camera.mkv'),unknown=path.join(src,'sans-extension'),bad=path.join(src,'a-reprendre.wav'),doc=path.join(src,'notes.txt'),png=path.join(src,'image.png');
  await video.engine.ff(['-y','-f','lavfi','-i','sine=frequency=440:duration=0.3',wav]);
  await video.engine.ff(['-y','-i',wav,'-c:a','opus','-strict','-2','-ar','48000',opus]);
  await video.engine.ff(['-y','-f','lavfi','-i','color=c=blue:s=128x96:r=25:d=0.3',...video.engine.encode(),movie]);await fs.copyFile(movie,unknown);
  await video.engine.ff(['-y','-f','lavfi','-i','color=c=red:s=80x120','-frames:v','1',png]);await fs.writeFile(doc,'Document non média.');
  selected=[png,wav,opus,movie,unknown,bad,doc];const picked=await api['pick-images']();assert.equal(picked.length,7);assert.equal(picked[0].kind,'photo');assert.equal(picked[1].kind,'audio');assert.equal(picked[3].kind,'video');assert.equal(picked[4].kind,'unknown');
  const result=await api['video-import-registered']({ids:picked.slice(1).map(x=>x.id),photoProjectId:'photo-project',name:'Tous les médias'});const finished=await done(api,result.job.id);assert.equal(finished.failures.length,2,JSON.stringify(finished));assert.equal(finished.unresolvedErrors,2);assert(finished.failures.some(f=>f.name==='a-reprendre.wav'));assert(finished.failures.some(f=>f.name==='notes.txt'));
  let project=api['video-project'](result.projectId);assert.equal(project.assets.length,4);assert.equal(project.assets.filter(a=>a.kind==='audio').length,2);assert.equal(project.assets.filter(a=>a.kind==='video').length,2);for(const a of project.assets)assert.equal(path.basename(path.dirname(video.store.data.media[a.id].source)),'Originals');
  await fs.unlink(wav);assert((await fs.stat(video.store.data.media[project.assets.find(a=>a.name==='interview.wav').id].source)).isFile());
  const originalIds=project.assets.map(a=>a.id);await fs.copyFile(opus,bad);const retry=await api['video-import-retry'](finished.id);await done(api,retry.id);project=api['video-project'](result.projectId);assert.equal(project.assets.length,5);assert(originalIds.every(id=>project.assets.some(a=>a.id===id)));assert.equal(api['video-list']().jobs.find(j=>j.id===finished.id).unresolvedErrors,1);await assert.rejects(api['video-job']({id:finished.id,action:'remove'}),/diagnostic/);
  saveTo=path.join(root,'diagnostic.json');await api['video-import-report'](finished.id);const report=JSON.parse(await fs.readFile(saveTo));assert(report.files.some(f=>f.name==='a-reprendre.wav'&&f.recovered));assert(report.files.some(f=>f.name==='notes.txt'&&!f.recovered));
  const lost=path.join(src,'deplace.wav'),[lostItem]=await media.register([lost]);const lostJob=await api['video-import-registered']({ids:[lostItem.id],projectId:project.id});await done(api,lostJob.job.id);const movedDir=path.join(root,'moved');await fs.mkdir(movedDir);const moved=path.join(movedDir,'deplace.wav');await fs.copyFile(opus,moved);selected=[moved];const located=await api['video-import-locate']({id:lostJob.job.id,index:0});await done(api,located.id);assert.equal(api['video-list']().jobs.find(j=>j.id===lostJob.job.id).unresolvedErrors,0);
  saveTo=path.join(root,'mixed.junofilm');await api['video-backup'](project.id);selected=[saveTo];const restored=await api['video-restore']();const restoreJob=api['video-list']().jobs.find(j=>j.projectId===restored.id&&j.kind==='restore');assert.equal((await done(api,restoreJob.id)).errors.length,0,'restore supports extensionless managed originals');
  await assert.rejects(api['video-import-registered']({ids:['unregistered'],projectId:project.id}),/inconnu/);
  console.log('PASS media picker, linked project, WAV/Opus/video/unknown suffix, verified copies, named errors, report and targeted retry');
 }finally{events['will-quit']?.();await wait(200);await fs.rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
});
