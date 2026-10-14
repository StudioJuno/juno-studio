import test from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,statSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createLocalService} from '../server/local-service.mjs';

test('installation locale : compte protégé, activation unique et persistance au redémarrage',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'juno-local-test-'));
 let service;
 const start=async()=>{service=createLocalService({dataDir:dir});await new Promise(r=>service.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+service.server.address().port;};
 try{
  let base=await start();
  const token=readFileSync(path.join(dir,'setup-token'),'utf8');
  const health=()=>fetch(base+'/health').then(r=>r.json());
  const setup=(body,auth=token,extra={})=>fetch(base+'/setup',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth,...extra},body:JSON.stringify(body)});
  const input={email:'admin@juno.test',password:'  a-long-private-password  '};
  assert.equal((await health()).setupRequired,true);
  assert.equal((await fetch(base+'/projects')).status,503);
  assert.equal((await setup(input,'x'.repeat(43))).status,403);
  assert.equal((await setup(input,token,{Origin:'https://evil.test'})).status,403);
  assert.equal(await new Promise((resolve,reject)=>{const req=http.request(base+'/setup',{method:'POST',headers:{Host:'evil.test',Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode)});req.on('error',reject);req.end(JSON.stringify(input))}),403);
  assert.equal((await setup({...input,password:'short'})).status,400);
  assert.equal(existsSync(path.join(dir,'juno-team.sqlite')),false);
  assert.equal((await setup(input)).status,201);
  assert.equal((await health()).setupRequired,false);
  assert.equal(existsSync(path.join(dir,'setup-token')),false);
  assert.equal((await setup({...input,password:'replacement-password'})).status,409);
  if(process.platform!=='win32')assert.equal(statSync(path.join(dir,'juno-team.sqlite')).mode&0o777,0o600);
  const login=()=>fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
  let res=await login();assert.equal(res.status,200);let session=await res.json();
  assert.equal(session.user.role,'admin');
  assert.deepEqual(await(await fetch(base+'/projects',{headers:{Authorization:'Bearer '+session.token}})).json(),[]);
  await service.close();service=undefined;base=await start();
  assert.equal((await health()).setupRequired,false);
  assert.equal(existsSync(path.join(dir,'setup-token')),false);
  res=await login();assert.equal(res.status,200);
 }finally{if(service)await service.close();rmSync(dir,{recursive:true,force:true});}
});
