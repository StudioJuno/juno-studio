/** Install a built app and a private, login-started local team service. No credentials. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

if(process.platform!=='darwin'||Number(process.versions.node.split('.')[0])<24)throw Error('Lancez cet installateur avec Node.js 24 sur Mac.');
process.umask(0o077);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {version}=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
const source=path.resolve(process.argv[2]||path.join(root,'release','v'+version,'Juno Studio-darwin-'+process.arch,'Juno Studio.app'));
const runtime=path.resolve(process.argv[3]||process.execPath);
const destination='/Applications/Juno Studio.app';
const support=path.join(os.homedir(),'Library','Application Support');
const service=path.join(support,'Juno Studio Team'),logs=path.join(os.homedir(),'Library','Logs','Juno Studio Team');
const plist=path.join(os.homedir(),'Library','LaunchAgents','fr.juno.studio.team.plist');
const label='fr.juno.studio.team',domain='gui/'+process.getuid();
const exists=async p=>fs.access(p).then(()=>true,()=>false);
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'pipe',encoding:'utf8'});
const hash=async p=>createHash('sha256').update(await fs.readFile(p)).digest('hex');
const suffix=new Date().toISOString().replace(/[:.]/g,'-');
await fs.access(path.join(source,'Contents','Resources','app.asar'));
const running=run('/bin/ps',['-axo','command']);
if(running.split('\n').some(line=>/^\/.*\/Juno Studio\.app\/Contents\/MacOS\/Juno Studio(?:\s|$)/.test(line.trim())))throw Error('Fermez Juno Studio avant son installation. Le catalogue sera conservé.');

// Back up the existing catalog while it is closed; never rewrite its contents.
const catalog=path.join(support,'Juno Studio');
if(await exists(catalog)){
 const backups=path.join(support,'Juno Studio Backups');await fs.mkdir(backups,{recursive:true,mode:0o700});
 run('/usr/bin/ditto',[catalog,path.join(backups,'before-install-'+version+'-'+suffix)]);
}
const stage='/Applications/.Juno Studio.install-'+randomUUID()+'.app';
run('/usr/bin/ditto',[source,stage]);
if(await hash(path.join(source,'Contents','Resources','app.asar'))!==await hash(path.join(stage,'Contents','Resources','app.asar')))throw Error('La vérification de copie de l’application a échoué.');
for(const attribute of ['com.apple.FinderInfo','com.apple.ResourceFork']){try{run('/usr/bin/xattr',['-dr',attribute,stage]);}catch{}}
// Une signature Developer ID ne se remplace pas par une signature ad hoc :
// elle est ce qui permettra la notarisation, et la refaire la détruirait.
// L'ad hoc reste le repli quand aucun certificat n'a servi au paquetage.
// codesign écrit son rapport sur la sortie d'erreur, même quand il réussit :
// ne lire que la sortie standard rend une chaîne vide, et fait conclure à tort
// que le paquet n'est pas signé.
const authority=(()=>{const r=spawnSync('/usr/bin/codesign',['-dv','--verbose=2',stage],{encoding:'utf8'});return String(r.stdout||'')+String(r.stderr||'');})();
const signedForRelease=authority.includes('Developer ID Application');
if(!signedForRelease)run('/usr/bin/codesign',['--force','--deep','--sign','-',stage]);
run('/usr/bin/codesign',['--verify','--deep','--strict',stage]);
console.log(signedForRelease?'Signature Developer ID conservée.':'Signature ad hoc posée : utilisable sur ce Mac seulement.');
if(await exists(destination)){
 const apps=path.join(support,'Juno Studio Backups','Applications');await fs.mkdir(apps,{recursive:true});
 await fs.rename(destination,path.join(apps,'Juno Studio-before-'+suffix+'.app'));
}
await fs.rename(stage,destination);

const owned=await exists(plist);
if(owned){try{run('/bin/launchctl',['bootout',domain,plist]);}catch{}}
try{
 const response=await fetch('http://127.0.0.1:8787/health',{signal:AbortSignal.timeout(1000)});
 if(response)throw Error('Le port 8787 est déjà occupé. L’application est installée ; libérez ce port pour installer son service local.');
}catch(e){if(e.message.startsWith('Le port'))throw e;}
await fs.mkdir(service,{recursive:true,mode:0o700});await fs.chmod(service,0o700);
await fs.mkdir(path.join(service,'runtime'),{recursive:true,mode:0o700});
await fs.mkdir(logs,{recursive:true,mode:0o700});await fs.chmod(logs,0o700);
const copy=async(from,to,mode)=>{const temp=to+'.install-'+randomUUID();await fs.copyFile(from,temp);await fs.chmod(temp,mode);await fs.rename(temp,to);};
await copy(runtime,path.join(service,'runtime','node'),0o755);
for(const name of ['team-server.mjs','local-service.mjs'])await copy(path.join(root,'server',name),path.join(service,name),0o600);
await copy(path.join(root,'INSTALLATION-MAC.md'),path.join(service,'INSTALLATION.md'),0o600);
await fs.mkdir(path.dirname(plist),{recursive:true});
const escape=v=>v.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const xml=`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${escape(path.join(service,'runtime','node'))}</string><string>${escape(path.join(service,'local-service.mjs'))}</string></array>
<key>WorkingDirectory</key><string>${escape(service)}</string>
<key>EnvironmentVariables</key><dict><key>JUNO_DATA_DIR</key><string>${escape(path.join(service,'data'))}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>30</integer><key>Umask</key><integer>63</integer><key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>${escape(path.join(logs,'service.log'))}</string>
<key>StandardErrorPath</key><string>${escape(path.join(logs,'service-error.log'))}</string>
</dict></plist>`;
await fs.writeFile(plist+'.tmp',xml,{mode:0o600});await fs.rename(plist+'.tmp',plist);
run('/usr/bin/plutil',['-lint',plist]);
run('/bin/launchctl',['bootstrap',domain,plist]);
let healthy=false;
for(let i=0;i<120;i++){
 try{const res=await fetch('http://127.0.0.1:8787/health',{signal:AbortSignal.timeout(1000)});const data=await res.json();if(res.ok&&data.service==='juno-team'){healthy=true;break;}}catch{}
 await delay(500);
}
if(!healthy)throw Error('L’application est installée, mais le service local ne répond pas. Consultez les journaux Juno Studio Team.');
await fs.writeFile(path.join(service,'installation.json'),JSON.stringify({version,application:destination,installedAt:new Date().toISOString(),service:'http://127.0.0.1:8787',node:process.versions.node},null,2)+'\n',{mode:0o600});
console.log(`Juno Studio ${version} installé dans ${destination}. Service local actif et configuré au démarrage de la session.`);
