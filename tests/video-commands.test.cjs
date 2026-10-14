const {test}=require("node:test"),assert=require("node:assert/strict");
const {recordSequence,restoreSequence}=require("../electron/video/commands.cjs");
const M=require("../electron/video/model.cjs");
test("video command undo survives serialization and preserves independent edits",()=>{
  const p=M.project("Commands"),s=p.sequences[0];
  const next={...s,name:"New title",masterGain:.5};
  recordSequence(p,s,next,{id:"cmd",source:"text"});p.sequences[0]=next;
  const persisted=JSON.parse(JSON.stringify(p));persisted.sequences[0].width=1080;
  const restored=restoreSequence(persisted,"cmd",false,s=>M.validateSequence(s,new Map()));
  assert.equal(restored.sequence.name,s.name);assert.equal(restored.sequence.width,1080);
  assert.equal(restoreSequence(persisted,"cmd",true,s=>M.validateSequence(s,new Map())).sequence.masterGain,.5);
});
test("new generated sequence can undo and redo without losing identity",()=>{
  const p=M.project("Commands"),s=M.sequence("New cut");s.titles.push({id:"title",text:"Hello",start:0,duration:25,size:64,y:.8,color:"#ffffff"});
  recordSequence(p,undefined,s,{id:"new"});p.sequences.push(s);
  const validate=s=>M.validateSequence(s,new Map());
  assert.equal(restoreSequence(p,"new",false,validate).sequence.titles.length,0);
  assert.equal(restoreSequence(p,"new",true,validate).sequence.titles.length,1);
});
test("conflicts reject whole undo before changing the project",()=>{
  const p=M.project("Commands"),s=p.sequences[0],next={...s,masterGain:.5,name:"edited"};
  recordSequence(p,s,next,{id:"cmd"});p.sequences[0]={...next,masterGain:.6};
  const before=JSON.stringify(p);assert.throws(()=>restoreSequence(p,"cmd",false,()=>{}),/repris/);assert.equal(JSON.stringify(p),before);
});
