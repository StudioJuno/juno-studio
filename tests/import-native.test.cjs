const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {registerImports}=require('../electron/imports.cjs');
test('managed imports preserve the exact original after source removal and survive registry write failure',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'juno-import-native-')),api={},assets={},input=path.join(root,'input');await fs.mkdir(input);let picked=[],fail=false;
 registerImports({handle:(n,f)=>api[n]=f,app:{getPath:()=>root},dialog:{showOpenDialog:async()=>({canceled:false,filePaths:picked})},shell:{showItemInFolder(){}},getWindow:()=>null,assets,persistAssets:async()=>{if(fail)throw Error('registry write failed')}});
 try{
 const source=path.join(input,'photo.CR3'),bytes=Buffer.alloc(1024*1024,43);await fs.writeFile(source,bytes);assets.a=source;const hash=createHash('sha256').update(bytes).digest('hex');
 const [a,b]=await Promise.all([api['secure-import-source']({id:'a'}),api['secure-import-source']({id:'a'})]);assert.equal(a.hash,hash);assert.equal(b.hash,hash);await fs.unlink(source);assert.deepEqual(await fs.readFile(assets.a),bytes);assert.equal((await api['import-source-info']('a')).managed,true);
 assert.equal((await api['secure-import-source']({id:'a',hash})).hash,hash);await assert.rejects(api['secure-import-source']({id:'a',hash:'0'.repeat(64)}),/changé/);
 assets.b=path.join(input,'missing.CR3');await assert.rejects(api['secure-import-source']({id:'b'}),/indisponible/);assert.equal((await api['import-source-info']('b')).exists,false);
 const restored=path.join(input,'restored.CR3');await fs.writeFile(restored,bytes);picked=[restored];await assert.rejects(api['locate-import-source']({id:'b',name:'missing.CR3',size:bytes.length}),/nom d’origine/);await api['locate-import-source']({id:'b',name:'missing.CR3',size:bytes.length,hash});assert.equal(assets.b,restored);
 fail=true;await assert.rejects(api['secure-import-source']({id:'b'}),/registry/);assert.equal(assets.b,restored);fail=false;await api['secure-import-source']({id:'b'});assert.equal((await api['import-source-info']('b')).managed,true);
 await assert.rejects(api['secure-import-source']({id:'../escape'}),/inconnu/);assert(!(await fs.readdir(path.join(root,'Originals'))).some(x=>x.includes('.part')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
