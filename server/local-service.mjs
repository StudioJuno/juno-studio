/** Local installation entry point. Bootstrap is restricted to this OS account. */
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,chmodSync,existsSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createTeamServer} from './team-server.mjs';

export function createLocalService({dataDir}={}) {
 if(!dataDir||!path.isAbsolute(dataDir))throw Error('Un dossier local absolu est requis.');
 mkdirSync(dataDir,{recursive:true,mode:0o700});chmodSync(dataDir,0o700);
 const database=path.join(dataDir,'juno-team.sqlite'),tokenFile=path.join(dataDir,'setup-token');
 let team,token,initializing=false;
 if(existsSync(database)){
  const db=new DatabaseSync(database,{readOnly:true});
  try{if(db.prepare("SELECT name FROM sqlite_master WHERE name='users'").get()&&db.prepare('SELECT count(*) AS n FROM users').get().n>0)team=createTeamServer({database});}finally{db.close();}
 }
 if(team){if(existsSync(tokenFile))unlinkSync(tokenFile);}
 else{
  if(!existsSync(tokenFile))writeFileSync(tokenFile,randomBytes(32).toString('base64url'),{flag:'wx',mode:0o600});
  chmodSync(tokenFile,0o600);token=readFileSync(tokenFile,'utf8');
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('Jeton d’installation local invalide.');
 }
 const digest=value=>createHash('sha256').update(value).digest();
 const server=http.createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const expectedHost='127.0.0.1:'+server.address().port;
  // Native requests have no Origin. Refuse browser origins and DNS rebinding.
  if(req.headers.host!==expectedHost||req.headers.origin){reply(403,{error:'Accès réservé à l’application locale.'});return;}
  if(req.url==='/health'&&req.method==='GET'){reply(200,{ok:true,service:'juno-team',version:1,setupRequired:!team});return;}
  if(req.url==='/setup'&&req.method==='POST'){
   if(team){reply(409,{error:'Le compte administrateur est déjà configuré.'});return;}
   const supplied=req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
   if(!supplied||!timingSafeEqual(digest(supplied),digest(token))){reply(403,{error:'Initialisation non autorisée.'});return;}
   if(initializing){reply(409,{error:'Une initialisation est déjà en cours.'});return;}
   if(req.headers['content-type']!=='application/json'){reply(415,{error:'Format JSON requis.'});return;}
   initializing=true;
   try{
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>8192){reply(413,{error:'Requête trop volumineuse.'});return;}chunks.push(chunk);}
    const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!input||typeof input.email!=='string'||input.email.length>250||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())||typeof input.password!=='string'||input.password.length<12||input.password.length>300||!input.password.trim()){
     reply(400,{error:'Indiquez un email valide et un mot de passe d’au moins 12 caractères.'});return;
    }
    team=createTeamServer({database,adminEmail:input.email.trim(),adminPassword:input.password});
    chmodSync(database,0o600);unlinkSync(tokenFile);token=undefined;
    reply(201,{ok:true});
   }catch(e){reply(e instanceof SyntaxError?400:500,{error:e instanceof SyntaxError?'Requête invalide.':'Impossible d’initialiser le service local.'});}
   finally{initializing=false;}
   return;
  }
  if(!team){reply(503,{error:'Créez votre compte administrateur dans Équipe Juno.'});return;}
  team.server.emit('request',req,res);
 });
 server.requestTimeout=120000;server.headersTimeout=60000;
 return {server,close:async()=>{await new Promise(resolve=>server.close(resolve));if(team)await team.close();}};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.umask(0o077);
 const service=createLocalService({dataDir:process.env.JUNO_DATA_DIR});
 service.server.listen(8787,'127.0.0.1',()=>console.log('Juno Team local prêt sur 127.0.0.1:8787.'));
 process.on('SIGTERM',()=>service.close().then(()=>process.exit(0)));
}
