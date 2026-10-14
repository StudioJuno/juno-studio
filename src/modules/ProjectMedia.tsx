import {useEffect,useState} from 'react';
import {Clapperboard,ArrowRight} from 'lucide-react';
export default function ProjectMedia({projectId,onOpen}:{projectId:string;onOpen?:()=>void}){
 const [info,setInfo]=useState<{id:string;count:number;active:number;errors:number}|null>(null);
 useEffect(()=>{let live=true;const read=async()=>{try{const d=await window.juno?.video.list();if(!live||!d)return;const p=d.projects.find(p=>p.photoProjectId===projectId);if(!p){setInfo(null);return;}const jobs=d.jobs.filter(j=>j.projectId===p.id);setInfo({id:p.id,count:p.count,active:jobs.filter(j=>['running','queued'].includes(j.state)).length,errors:jobs.reduce((n,j)=>n+(j.unresolvedErrors??j.errors?.length??0),0)});}catch{}};void read();const t=setInterval(()=>void read(),1200);return()=>{live=false;clearInterval(t)};},[projectId]);
 if(!info)return null;
 return <button className="project-media-link" onClick={()=>{localStorage.setItem('juno-video-project',info.id);onOpen?.()}}><Clapperboard size={18}/><span><b>Vidéos et sons du projet</b><small>{info.count} média(s){info.active?' · Import en cours':''}{info.errors?` · ${info.errors} fichier(s) à vérifier`:''}</small></span><ArrowRight size={17}/></button>;
}
