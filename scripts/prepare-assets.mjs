import {mkdir,copyFile,readdir} from 'node:fs/promises';
import path from 'node:path';
async function copy(from,to,allow=()=>true){await mkdir(to,{recursive:true});for(const f of await readdir(from,{withFileTypes:true})){if(f.isDirectory())await copy(path.join(from,f.name),path.join(to,f.name),allow);else if(allow(f.name))await copyFile(path.join(from,f.name),path.join(to,f.name));}}
await copy('node_modules/libraw-wasm/dist','public/vendor/libraw',n=>!n.endsWith('.map')&&!n.endsWith('.ts'));
await copy('node_modules/@mediapipe/tasks-vision/wasm','public/vendor/vision/wasm');
await copyFile('node_modules/@mediapipe/tasks-vision/vision_bundle.cjs','public/vendor/vision/vision_bundle.js');
await copy('node_modules/lcms-wasm/dist','public/vendor/lcms',n=>n==='lcms.min.js'||n==='lcms.wasm');
