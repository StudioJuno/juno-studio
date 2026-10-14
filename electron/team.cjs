const fs=require('node:fs/promises');const path=require('node:path');
function registerTeam({handle,app,safeStorage}){
 const file=path.join(app.getPath('userData'),'team-session.enc');
 const localRoot=path.join(app.getPath('appData'),'Juno Studio Team'),localUrl='http://127.0.0.1:8787';
 const read=async()=>{try{return JSON.parse(safeStorage.decryptString(await fs.readFile(file)))}catch{return null}};
 const write=async v=>{if(!safeStorage.isEncryptionAvailable())throw Error('Stockage sécurisé indisponible.');const temp=file+'.tmp';await fs.writeFile(temp,safeStorage.encryptString(JSON.stringify(v)),{mode:0o600});await fs.rename(temp,file)};
 function endpoint(value){if(typeof value!=='string'||value.length>1000)throw Error('Adresse du service invalide.');const u=new URL(value);if(u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Utilisez une adresse de service sans chemin ni identifiants.');if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw Error('HTTPS est requis pour un service distant.');return u.origin;}
 async function request(session,route,method='GET',body,revision){
  const query=typeof route==='string'?route.split('?')[1]:undefined;const pathname=typeof route==='string'?route.split('?')[0]:'';if(query&&!/^offset=\d{1,6}$/.test(query))throw Error('Pagination invalide.');
  if(typeof route!=='string'||!/^\/(?:me|users(?:\/[a-zA-Z0-9_-]+)?|projects(?:\/[a-zA-Z0-9_-]+(?:\/(?:members|comments|previews)(?:\/[a-zA-Z0-9_-]+)?)?)?|auth\/(?:login|logout|password)|audit)$/.test(pathname)||!['GET','POST','PUT','PATCH','DELETE'].includes(method))throw Error('Requête équipe invalide.');
  const headers={};if(session.token)headers.Authorization='Bearer '+session.token;if(body!==undefined)headers['Content-Type']='application/json';if(revision)headers['If-Match']=String(revision);const serialized=body!==undefined?JSON.stringify(body):undefined;if(serialized&&Buffer.byteLength(serialized)>8*1024*1024)throw Error('Catalogue trop volumineux pour cette synchronisation.');
  const res=await fetch(endpoint(session.url)+route,{method,headers,body:serialized,redirect:'error',signal:AbortSignal.timeout(30000)});const length=Number(res.headers.get('content-length')||0);if(length>16*1024*1024)throw Error('Réponse du service trop volumineuse.');const reader=res.body.getReader(),chunks=[];let size=0;while(true){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>16*1024*1024){await reader.cancel();throw Error('Réponse du service trop volumineuse.')}chunks.push(Buffer.from(r.value))}const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!res.ok)throw Error((res.status===409?'CONFLIT · ':'')+(result.error||'Service indisponible.'));return result;
 }
 async function login({url,email,password}={}){url=endpoint(url);if(typeof email!=='string'||typeof password!=='string'||email.length>250||password.length>300)throw Error('Identifiants invalides.');const result=await request({url},'/auth/login','POST',{email,password});await write({url,...result});return{url,user:result.user,expires:result.expires};}
 handle('team-status',async()=>{const s=await read();return s&&s.expires>Date.now()?{url:s.url,user:s.user,expires:s.expires}:null});
 handle('team-login',login);
 handle('team-local-status',async()=>{
  try{await fs.access(path.join(localRoot,'local-service.mjs'));}catch{return{installed:false,available:false,setupRequired:false,url:localUrl};}
  try{const res=await fetch(localUrl+'/health',{redirect:'error',signal:AbortSignal.timeout(3000)});const info=await res.json();if(!res.ok||info.service!=='juno-team')throw Error();return{installed:true,available:true,setupRequired:info.setupRequired===true,url:localUrl};}catch{return{installed:true,available:false,setupRequired:false,url:localUrl};}
 });
 handle('team-local-setup',async({email,password}={})=>{
  if(typeof email!=='string'||email.length>250||typeof password!=='string'||password.length<12||password.length>300)throw Error('Indiquez un email et un mot de passe d’au moins 12 caractères.');
  if(!safeStorage.isEncryptionAvailable())throw Error('Le stockage sécurisé du système est indisponible.');
  let token;try{token=await fs.readFile(path.join(localRoot,'data','setup-token'),'utf8');}catch{throw Error('Le service est déjà configuré ou indisponible. Essayez de vous connecter.');}
  const res=await fetch(localUrl+'/setup',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({email,password}),redirect:'error',signal:AbortSignal.timeout(30000)});
  const result=await res.json();if(!res.ok)throw Error(result.error||'Initialisation impossible.');
  return login({url:localUrl,email,password});
 });
 handle('team-logout',async()=>{const s=await read();if(s)await request(s,'/auth/logout','POST').catch(()=>{});await fs.unlink(file).catch(()=>{});});
 handle('team-request',async({route,method,body,revision}={})=>{const s=await read();if(!s||s.expires<Date.now())throw Error('Reconnectez-vous au service d’équipe.');return request(s,route,method,body,revision)});
}
module.exports={registerTeam};
