import {nativePhoto} from './raster';
import {useEffect,useState} from 'react';
import type {Photo} from '../model';
export default function OriginalStatus({photo}:{photo:Photo}) {
 const [status,setStatus]=useState('');
 useEffect(()=>{let live=true;setStatus('');
  if(photo.source==='idb')setStatus('Original conservé dans Juno');
  else if(photo.source.startsWith('juno://')&&window.juno?.importSourceInfo){
   const id=new URL(photo.source).pathname.slice(1);
   void window.juno.importSourceInfo(id).then(s=>{if(live)setStatus(s.exists?(s.managed?'Original conservé dans Juno':'Original externe · conservez son dossier'):'Original introuvable · seul l’aperçu reste disponible')}).catch(()=>{if(live)setStatus('Original à vérifier');});
  }
  return()=>{live=false};
 },[photo.id,photo.source]);
 return status?<><p className="original-status" role={status.includes('introuvable')?'status':undefined}>{status}</p>{nativePhoto(photo.name)&&<p className="original-status">Image composite pour la retouche · profil couleur à vérifier. Les calques éventuels restent dans l’original.</p>}</>:null;
}
