import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const {version}=JSON.parse(await fs.readFile('package.json','utf8'));
await fs.access('server/review/public/index.html');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'juno-review-package-'));
try{
 const root=path.join(temp,'juno-review');
 await fs.mkdir(path.join(root,'server'),{recursive:true});
 await fs.cp('server/review',path.join(root,'server/review'),{recursive:true,filter:source=>!/(?:\.sqlite(?:-wal|-shm)?|\.env|\.key|\.enc|\.p8)$/.test(source) && !source.split(path.sep).includes('data')});
 await fs.cp('deploy/review',path.join(root,'deploy/review'),{recursive:true,filter:source=>!source.endsWith('.env')});
 const output=path.resolve('release/v'+version);await fs.mkdir(output,{recursive:true});
 const archive=path.join(output,'Juno-Review-'+version+'.tar.gz');
 execFileSync('tar',['-czf',archive,'-C',temp,'juno-review']);
 const digest=createHash('sha256').update(await fs.readFile(archive)).digest('hex');
 await fs.writeFile(archive+'.sha256',digest+'  '+path.basename(archive)+'\n');
 console.log('Portail prêt à déployer : '+archive);
}finally{await fs.rm(temp,{recursive:true,force:true});}
