const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {registerExports}=require('../electron/export.cjs');
test('export reprend après redémarrage sans remplacer un fichier différent',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juno-export-test-'));
 const open=async()=>{const handlers={};await registerExports({handle:(name,fn)=>handlers[name]=fn,app:{getPath:()=>root},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[root]})},getWindow:()=>null});return handlers};
 try{let h=await open();const token=await h['begin-export']();const bytes=new TextEncoder().encode('image bytes').buffer;await h['write-export'](token,'photo.jpg',bytes);h=await open();await h['write-export'](token,'photo.jpg',bytes);await assert.rejects(()=>h['write-export'](token,'photo.jpg',new TextEncoder().encode('different').buffer));await assert.rejects(()=>h['write-export'](token,'../escape',bytes));await h['finish-export'](token);h=await open();await h['write-export'](token,'photo.jpg',bytes);const registry=JSON.parse(await fs.readFile(path.join(root,'export-folders.json'),'utf8'));assert.equal(await fs.readFile(path.join(registry[0].folder,'photo.jpg'),'utf8'),'image bytes');}finally{await fs.rm(root,{recursive:true,force:true})}
});
