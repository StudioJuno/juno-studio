import test from 'node:test';
import assert from 'node:assert/strict';
import {createTeamServer} from '../server/team-server.mjs';

test('équipe : authentification, droits, conflits et révocation des sessions',async()=>{
 const s=createTeamServer({adminEmail:'admin@juno.test',adminPassword:'a-very-long-admin-password'});
 await new Promise(r=>s.server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+s.server.address().port;
 async function call(path,{token,body,method='GET',revision,origin}={}){const res=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...(revision?{'If-Match':String(revision)}:{}),...(origin?{Origin:origin}:{})},body:body?JSON.stringify(body):undefined});return{status:res.status,data:res.status===204?null:await res.json()}}
 try{
  assert.equal((await call('/projects')).status,401);
  assert.equal((await call('/health',{origin:'https://evil.test'})).status,403);
  const a=await call('/auth/login',{method:'POST',body:{email:'admin@juno.test',password:'a-very-long-admin-password'}});assert.equal(a.status,200);const admin=a.data.token;
  const make=async(email,role)=>{const r=await call('/users',{method:'POST',token:admin,body:{email,name:email,role,password:'long-password-for-testing'}});assert.equal(r.status,201);const login=await call('/auth/login',{method:'POST',body:{email,password:'long-password-for-testing'}});return{id:r.data.id,token:login.data.token}};
  const alice=await make('alice@juno.test','photographer'),bob=await make('bob@juno.test','photographer'),viewer=await make('review@juno.test','reviewer');
  assert.equal((await call('/users',{token:bob.token})).status,403);
  const create=await call('/projects',{method:'POST',token:alice.token,body:{id:'test-project',name:'Portrait',kind:'Portrait',payload:{photos:[]}}});assert.equal(create.status,201);
  assert.equal((await call('/projects/test-project',{token:bob.token})).status,403);
  assert.deepEqual((await call('/projects',{token:bob.token})).data,[]);
  for(const [u,role] of [[bob,'editor'],[viewer,'reviewer']])assert.equal((await call('/projects/test-project/members',{method:'POST',token:alice.token,body:{userId:u.id,role}})).status,200);
  assert.equal((await call('/projects/test-project',{method:'PUT',token:viewer.token,revision:1,body:{payload:{photos:[]}}})).status,403);
  assert.equal((await call('/projects/test-project',{method:'PUT',token:bob.token,body:{payload:{photos:[]}}})).status,428);
  const updates=await Promise.all([alice,bob].map(u=>call('/projects/test-project',{method:'PUT',token:u.token,revision:1,body:{payload:{changedBy:u.id}}})));assert.deepEqual(updates.map(r=>r.status).sort(),[200,409]);
  const current=await call('/projects/test-project',{token:alice.token});assert.equal(current.data.revision,2);
  assert.equal((await call('/projects/test-project/comments',{method:'POST',token:viewer.token,body:{photoId:'photo-1',body:'À garder'}})).status,201);
  assert.equal((await call('/projects/test-project/comments',{token:alice.token})).data[0].body,'À garder');
  assert.equal((await call('/users/'+bob.id,{method:'PATCH',token:admin,body:{disabled:true}})).status,200);
  assert.equal((await call('/me',{token:bob.token})).status,401);
  await call('/auth/logout',{method:'POST',token:alice.token});assert.equal((await call('/me',{token:alice.token})).status,401);
 }finally{await s.close()}
});

test('changement de mot de passe : espaces conservés et autres sessions révoquées',async()=>{
 const s=createTeamServer({adminEmail:'admin@juno.test',adminPassword:'password-initial-long'});await new Promise(r=>s.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+s.server.address().port;
 const login=async password=>fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'admin@juno.test',password})});
 try{const a=await(await login('password-initial-long')).json(),b=await(await login('password-initial-long')).json();const res=await fetch(base+'/auth/password',{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:JSON.stringify({currentPassword:'password-initial-long',newPassword:'  password-new-with-spaces  '})});assert.equal(res.status,200);assert.equal((await fetch(base+'/me',{headers:{Authorization:'Bearer '+b.token}})).status,401);assert.equal((await login('password-initial-long')).status,401);assert.equal((await login('  password-new-with-spaces  ')).status,200)}finally{await s.close()}
});

test('connexion : seuls les échecs comptent, par adresse et par email',async()=>{
 // Correction de l'audit du catalogue (29/09/2026) : 12 connexions par minute
 // pour toute l'équipe derrière le proxy TLS, et l'administrateur bloqué par
 // 12 essais anonymes.
 const s=createTeamServer({adminEmail:'admin@juno.test',adminPassword:'a-very-long-admin-password',trustProxy:true});await new Promise(r=>s.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+s.server.address().port;
 const login=(email,password,adresse)=>fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json',...(adresse?{'X-Forwarded-For':adresse}:{})},body:JSON.stringify({email,password})}).then(r=>r.status);
 const admin=adresse=>login('admin@juno.test','a-very-long-admin-password',adresse);
 try{
  // Toute l'équipe arrive par la même adresse : les connexions réussies ne comptent pas.
  for(let i=0;i<13;i++)assert.equal(await admin(),200);
  // Des essais anonymes sur un email inconnu ne bloquent pas l'administrateur.
  for(let i=0;i<12;i++)assert.equal(await login('inconnu@juno.test','mauvais-mot-de-passe'),401);
  assert.equal(await login('inconnu@juno.test','mauvais-mot-de-passe'),429);
  assert.equal(await admin(),200);
  // Visé depuis une autre adresse, le compte reste ouvert à la sienne.
  for(let i=0;i<12;i++)assert.equal(await login('admin@juno.test','mauvais-mot-de-passe','203.0.113.9'),401);
  assert.equal(await admin('203.0.113.9'),429);
  assert.equal(await admin('198.51.100.7'),200);
  // Une adresse qui essaie des emails à la chaîne est freinée à 100 échecs.
  for(let i=0;i<100;i++)assert.equal(await login('essai'+i+'@juno.test','mauvais-mot-de-passe','203.0.113.50'),401);
  assert.equal(await login('encore@juno.test','mauvais-mot-de-passe','203.0.113.50'),429);
  assert.equal(await admin('198.51.100.7'),200);
 }finally{await s.close()}
});
