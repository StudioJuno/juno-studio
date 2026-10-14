/** Juno team service. Node >= 22.13. SQLite and crypto use built-in modules only. */
import http from 'node:http';
import {isIP} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const sha=value=>createHash('sha256').update(value).digest('hex');
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(value);
const passwordHash=password=>{const salt=randomBytes(16).toString('hex');return salt+':'+scryptSync(password,salt,64).toString('hex')};
const matches=(password,stored)=>{const [salt,hex]=stored.split(':');const a=scryptSync(password,salt,64),b=Buffer.from(hex,'hex');return a.length===b.length&&timingSafeEqual(a,b)};
class ApiError extends Error{constructor(status,message){super(message);this.status=status}}
function passwordInput(value,min=1){if(typeof value!=='string'||value.length<min||value.length>300||!value.trim())throw new ApiError(400,'Mot de passe invalide.');return value}
/**
 * L'adresse du client. Derrière un reverse proxy TLS, toute connexion arrive
 * du proxy (127.0.0.1, ou la passerelle Docker) ; le proxy ajoute l'adresse
 * réelle en dernier dans X-Forwarded-For. L'en-tête n'est cru que si
 * l'exploitant le déclare (JUNO_TRUST_PROXY=1) : sinon un client derrière un
 * proxy qui le transmet tel quel choisirait son adresse (29/09/2026).
 */
function clientAddress(req,trustProxy){const direct=req.socket.remoteAddress||'local';if(!trustProxy)return direct;const forwarded=String(req.headers['x-forwarded-for']||'').split(',').pop().trim();return isIP(forwarded)?forwarded:direct}
function cleanText(value,max=200){if(typeof value!=='string'||value.trim().length<1||value.length>max)throw new ApiError(400,'Champ invalide.');return value.trim()}
export function createTeamServer({database=':memory:',adminEmail,adminPassword,allowedOrigins=['http://127.0.0.1:5173'],sessionHours=12,trustProxy=false}={}){
 const db=new DatabaseSync(database);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
 db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,role TEXT CHECK(role IN ('admin','photographer','reviewer')) NOT NULL,password TEXT NOT NULL,disabled INTEGER DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,payload TEXT NOT NULL,updated INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS members(project_id TEXT REFERENCES projects(id),user_id TEXT REFERENCES users(id),role TEXT CHECK(role IN ('editor','reviewer','viewer')),PRIMARY KEY(project_id,user_id));
 CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,project_id TEXT REFERENCES projects(id),photo_id TEXT,user_id TEXT REFERENCES users(id),body TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY,project_id TEXT REFERENCES projects(id),revision INTEGER,payload TEXT,created INTEGER);
 CREATE TABLE IF NOT EXISTS previews(project_id TEXT REFERENCES projects(id),photo_id TEXT,content BLOB,PRIMARY KEY(project_id,photo_id));
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,user_id TEXT,action TEXT,project_id TEXT,created INTEGER);`);
 if(db.prepare('SELECT count(*) AS n FROM users').get().n===0){if(!adminEmail||!adminPassword||adminPassword.length<12)throw Error('Initialisation : email administrateur et mot de passe d’au moins 12 caractères requis.');db.prepare('INSERT INTO users(id,email,name,role,password) VALUES(?,?,?,?,?)').run(randomUUID(),adminEmail.toLowerCase(),'Administration Juno','admin',passwordHash(adminPassword));}
 const attempts=new Map();const audit=(uid,action,pid='')=>db.prepare('INSERT INTO audit(user_id,action,project_id,created) VALUES(?,?,?,?)').run(uid,action,pid,Date.now());
 const userInfo=u=>({id:u.id,email:u.email,name:u.name,role:u.role,disabled:!!u.disabled});
 function access(user,id,edit=false,manage=false){const p=db.prepare('SELECT * FROM projects WHERE id=?').get(id);if(!p)throw new ApiError(404,'Projet introuvable.');if(user.role==='admin'||p.owner===user.id)return p;const m=db.prepare('SELECT role FROM members WHERE project_id=? AND user_id=?').get(id,user.id);if(!m||manage||edit&&m.role!=='editor')throw new ApiError(403,'Accès refusé.');return p;}
 function payload(value){if(!value||typeof value!=='object'||Array.isArray(value))throw new ApiError(400,'Projet invalide.');const p=JSON.stringify(value);if(Buffer.byteLength(p)>8*1024*1024)throw new ApiError(413,'Le catalogue partagé dépasse 8 Mo.');return p;}
 async function body(req,max=8*1024*1024){let n=0;const chunks=[];for await(const chunk of req){n+=chunk.length;if(n>max)throw new ApiError(413,'Requête trop volumineuse.');chunks.push(chunk)}return Buffer.concat(chunks)}
 const server=http.createServer(async(req,res)=>{
  const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
  try{
   const origin=req.headers.origin;if(origin&&!allowedOrigins.includes(origin))throw new ApiError(403,'Origine refusée.');if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin')};
   if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,If-Match'});res.end();return;}
   const u=new URL(req.url,'http://localhost'),parts=u.pathname.split('/').filter(Boolean),method=req.method;
   if(u.pathname==='/health'&&method==='GET'){reply(200,{ok:true,service:'juno-team',version:1});return}
   if(u.pathname==='/auth/login'&&method==='POST'){
    // Seuls les échecs comptent : 12 par minute pour un même email depuis une
    // adresse, 100 pour l'adresse tous emails confondus (chaque essai coûte
    // une dérivation scrypt). Compter chaque connexion par adresse limitait
    // toute l'équipe à 12 connexions par minute derrière le proxy TLS (une
    // seule adresse), et 12 essais anonymes bloquaient l'administrateur.
    const now=Date.now(),input=JSON.parse((await body(req,8192)).toString());const email=cleanText(input.email,250).toLowerCase(),password=passwordInput(input.password);
    const address=clientAddress(req,trustProxy),keys=[['a:'+address,100],['e:'+address+'\n'+email,12]];
    if(keys.some(([k,max])=>{const r=attempts.get(k);return r&&r.until>=now&&r.count>=max}))throw new ApiError(429,'Trop de tentatives. Réessayez dans une minute.');
    const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
    // Perform password derivation even for nonexistent users.
    const stored=user?.password||('0123456789abcdef:'+Buffer.alloc(64).toString('hex'));const ok=matches(password,stored);
    if(!user||user.disabled||!ok){for(const [k] of keys){const r=attempts.get(k),failure=r&&r.until>=now?r:{count:0,until:now+60000};failure.count++;attempts.set(k,failure)}if(attempts.size>10000)for(const[k,v]of attempts)if(v.until<now)attempts.delete(k);throw new ApiError(401,'Identifiants incorrects.');}
    attempts.delete(keys[1][0]);
    const token=randomBytes(32).toString('base64url'),expires=now+sessionHours*3600000;db.prepare('DELETE FROM sessions WHERE expires<?').run(now);db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token),user.id,expires);audit(user.id,'login');reply(200,{token,expires,user:userInfo(user)});return;
   }
   const token=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];if(!token)throw new ApiError(401,'Connexion requise.');const user=db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token=? AND sessions.expires>? AND users.disabled=0').get(sha(token),Date.now());if(!user)throw new ApiError(401,'Session expirée.');
   if(u.pathname==='/auth/password'&&method==='POST'){const v=JSON.parse((await body(req,4096)).toString());if(!matches(passwordInput(v.currentPassword),user.password))throw new ApiError(401,'Mot de passe actuel incorrect.');const next=passwordInput(v.newPassword,12);db.prepare('UPDATE users SET password=? WHERE id=?').run(passwordHash(next),user.id);db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(user.id,sha(token));audit(user.id,'change-password');reply(200,{ok:true});return}
   if(u.pathname==='/auth/logout'&&method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(sha(token));reply(200,{ok:true});return}
   if(u.pathname==='/me'&&method==='GET'){reply(200,userInfo(user));return}
   if(u.pathname==='/users'&&method==='GET'){if(user.role!=='admin')throw new ApiError(403,'Administration requise.');reply(200,db.prepare('SELECT * FROM users ORDER BY name').all().map(userInfo));return}
   if(u.pathname==='/users'&&method==='POST'){
    if(user.role!=='admin')throw new ApiError(403,'Administration requise.');const v=JSON.parse((await body(req,8192)).toString()),name=cleanText(v.name,120),email=cleanText(v.email,250).toLowerCase(),password=passwordInput(v.password,12);if(!email.includes('@')||password.length<12||!['admin','photographer','reviewer'].includes(v.role))throw new ApiError(400,'Email, rôle ou mot de passe invalide.');if(db.prepare('SELECT id FROM users WHERE email=?').get(email))throw new ApiError(409,'Cet email est déjà utilisé.');const id=randomUUID();db.prepare('INSERT INTO users(id,email,name,role,password) VALUES(?,?,?,?,?)').run(id,email,name,v.role,passwordHash(password));audit(user.id,'create-user');reply(201,{id,email,name,role:v.role});return;
   }
   if(parts[0]==='users'&&parts.length===2&&method==='PATCH'){
    if(user.role!=='admin')throw new ApiError(403,'Administration requise.');if(parts[1]===user.id)throw new ApiError(400,'Vous ne pouvez pas désactiver votre propre compte.');const v=JSON.parse((await body(req,2048)).toString());if(typeof v.disabled!=='boolean')throw new ApiError(400,'Valeur invalide.');db.prepare('UPDATE users SET disabled=? WHERE id=?').run(v.disabled?1:0,parts[1]);db.prepare('DELETE FROM sessions WHERE user_id=?').run(parts[1]);audit(user.id,'change-user-status');reply(200,{ok:true});return;
   }
   if(u.pathname==='/projects'&&method==='GET'){
    const rows=user.role==='admin'?db.prepare('SELECT * FROM projects ORDER BY updated DESC').all():db.prepare('SELECT p.* FROM projects p WHERE p.owner=? OR EXISTS(SELECT 1 FROM members m WHERE m.project_id=p.id AND m.user_id=?) ORDER BY updated DESC').all(user.id,user.id);
    reply(200,rows.map(p=>({id:p.id,name:p.name,kind:p.kind,owner:p.owner,revision:p.revision,updated:p.updated})));return;
   }
   if(u.pathname==='/projects'&&method==='POST'){
    const v=JSON.parse((await body(req)).toString());if(!validId(v.id))throw new ApiError(400,'Identifiant invalide.');if(db.prepare('SELECT id FROM projects WHERE id=?').get(v.id))throw new ApiError(409,'Le projet existe déjà.');const name=cleanText(v.name),kind=cleanText(v.kind),data=payload(v.payload);db.prepare('INSERT INTO projects(id,owner,name,kind,payload,updated) VALUES(?,?,?,?,?,?)').run(v.id,user.id,name,kind,data,Date.now());audit(user.id,'create-project',v.id);reply(201,{id:v.id,revision:1});return;
   }
   if(parts[0]==='projects'&&parts.length>=2){
    const id=parts[1];if(!validId(id))throw new ApiError(400,'Identifiant invalide.');
    if(parts.length===2&&method==='GET'){const p=access(user,id);const metadata=JSON.stringify({id:p.id,name:p.name,kind:p.kind,owner:p.owner,revision:p.revision,updated:p.updated});res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(metadata.slice(0,-1)+',\"payload\":'+p.payload+'}');return}
    if(parts.length===2&&method==='PUT'){
     const p=access(user,id,true),v=JSON.parse((await body(req)).toString()),revision=Number(req.headers['if-match']);if(!Number.isInteger(revision)||revision<1)throw new ApiError(428,'Version de départ requise.');if(p.revision!==revision)throw new ApiError(409,'Ce projet a changé sur un autre poste. Récupérez sa version avant de synchroniser.');const data=payload(v.payload),now=Date.now();db.exec('BEGIN IMMEDIATE');try{const r=db.prepare('UPDATE projects SET payload=?,revision=revision+1,updated=? WHERE id=? AND revision=?').run(data,now,id,revision);if(!r.changes)throw new ApiError(409,'Conflit de version.');db.prepare('INSERT INTO history(project_id,revision,payload,created) VALUES(?,?,?,?)').run(id,revision,p.payload,now);db.prepare('DELETE FROM history WHERE project_id=? AND revision < ?').run(id,revision-20);audit(user.id,'update-project',id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}reply(200,{id,revision:revision+1});return;
    }
    if(parts[2]==='members'&&parts.length===3&&method==='GET'){access(user,id,false,true);reply(200,db.prepare('SELECT u.id,u.name,u.email,m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=?').all(id));return}
    if(parts[2]==='members'&&parts.length===3&&method==='POST'){access(user,id,false,true);const v=JSON.parse((await body(req,8192)).toString());if(v.email&&!v.userId)v.userId=db.prepare('SELECT id FROM users WHERE email=? AND disabled=0').get(String(v.email).trim().toLowerCase())?.id;if(!['editor','reviewer','viewer'].includes(v.role)||!db.prepare('SELECT id FROM users WHERE id=? AND disabled=0').get(v.userId))throw new ApiError(400,'Membre ou rôle invalide.');db.prepare('INSERT INTO members VALUES(?,?,?) ON CONFLICT(project_id,user_id) DO UPDATE SET role=excluded.role').run(id,v.userId,v.role);audit(user.id,'share-project',id);reply(200,{ok:true});return}
    if(parts[2]==='members'&&parts.length===4&&method==='DELETE'){access(user,id,false,true);db.prepare('DELETE FROM members WHERE project_id=? AND user_id=?').run(id,parts[3]);audit(user.id,'unshare-project',id);reply(200,{ok:true});return}
    if(parts[2]==='comments'&&parts.length===3&&method==='GET'){access(user,id);reply(200,db.prepare('SELECT c.id,c.photo_id AS photoId,c.body,c.created,u.name AS author FROM comments c JOIN users u ON u.id=c.user_id WHERE project_id=? ORDER BY created').all(id));return}
    if(parts[2]==='comments'&&parts.length===3&&method==='POST'){const p=access(user,id);if(user.role!=='admin'&&p.owner!==user.id&&db.prepare('SELECT role FROM members WHERE project_id=? AND user_id=?').get(id,user.id)?.role==='viewer')throw new ApiError(403,'Les droits de lecture ne permettent pas de commenter.');const v=JSON.parse((await body(req,12000)).toString());if(v.photoId&&!validId(v.photoId))throw new ApiError(400,'Photo invalide.');const cid=randomUUID();db.prepare('INSERT INTO comments VALUES(?,?,?,?,?,?)').run(cid,id,v.photoId||null,user.id,cleanText(v.body,4000),Date.now());audit(user.id,'comment',id);reply(201,{id:cid});return}
    if(parts[2]==='previews'&&parts.length===3&&method==='POST'){access(user,id,true);const v=JSON.parse((await body(req)).toString());if(!Array.isArray(v.photos)||v.photos.length>100)throw new ApiError(400,'Lot invalide.');for(const p of v.photos){if(!validId(p.id)||typeof p.thumbnail!=='string'||!p.thumbnail.startsWith('data:image/jpeg;base64,')||p.thumbnail.length>700000)throw new ApiError(400,'Aperçu invalide.');const content=Buffer.from(p.thumbnail.split(',')[1],'base64');db.prepare('INSERT INTO previews VALUES(?,?,?) ON CONFLICT(project_id,photo_id) DO UPDATE SET content=excluded.content').run(id,p.id,content)}reply(200,{ok:true});return}
    if(parts[2]==='previews'&&parts.length===3&&method==='GET'){access(user,id);const offset=Number(u.searchParams.get('offset')||0);if(!Number.isInteger(offset)||offset<0||offset>50000)throw new ApiError(400,'Pagination invalide.');const rows=db.prepare('SELECT photo_id,content FROM previews WHERE project_id=? ORDER BY photo_id LIMIT 50 OFFSET ?').all(id,offset);reply(200,{photos:rows.map(p=>({id:p.photo_id,thumbnail:'data:image/jpeg;base64,'+Buffer.from(p.content).toString('base64')})),more:rows.length===50});return}
    if(parts[2]==='previews'&&parts.length===4&&method==='PUT'){access(user,id,true);if(!validId(parts[3]))throw new ApiError(400,'Photo invalide.');const data=await body(req,512*1024);if(data.length<3||data[0]!==255||data[1]!==216||data[2]!==255)throw new ApiError(400,'Aperçu JPEG requis.');db.prepare('INSERT INTO previews VALUES(?,?,?) ON CONFLICT(project_id,photo_id) DO UPDATE SET content=excluded.content').run(id,parts[3],data);reply(200,{ok:true});return}
    if(parts[2]==='previews'&&parts.length===4&&method==='GET'){access(user,id);const row=db.prepare('SELECT content FROM previews WHERE project_id=? AND photo_id=?').get(id,parts[3]);if(!row)throw new ApiError(404,'Aperçu absent.');res.writeHead(200,{'Content-Type':'image/jpeg','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'});res.end(Buffer.from(row.content));return}
   }
   if(u.pathname==='/audit'&&method==='GET'){if(user.role!=='admin')throw new ApiError(403,'Administration requise.');reply(200,db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 500').all());return}
   throw new ApiError(404,'Route introuvable.');
  }catch(e){if(!res.headersSent)reply(e.status|| (e instanceof SyntaxError?400:500),{error:e.status||e instanceof SyntaxError?e.message:'Erreur du service.'});else res.end();}
 });
 server.requestTimeout=120000;server.headersTimeout=60000;server.keepAliveTimeout=5000;return {server,db,close:()=>new Promise(resolve=>server.close(()=>{db.close();resolve()}))};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const data=process.env.JUNO_DATA_DIR;if(!data)throw Error('Définissez JUNO_DATA_DIR sur un dossier local persistant (hors iCloud).');mkdirSync(data,{recursive:true});const service=createTeamServer({database:path.join(data,'juno-team.sqlite'),adminEmail:process.env.JUNO_ADMIN_EMAIL,adminPassword:process.env.JUNO_ADMIN_PASSWORD,allowedOrigins:(process.env.JUNO_ORIGINS||'http://127.0.0.1:5173').split(','),trustProxy:process.env.JUNO_TRUST_PROXY==='1'});const port=Number(process.env.PORT||8787),host=process.env.HOST||'127.0.0.1';service.server.listen(port,host,()=>console.log(`Juno Team prêt sur ${host}:${port}. TLS requis devant le service pour un accès distant.`));process.on('SIGTERM',()=>service.close().then(()=>process.exit()));
}
