import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
const root = new URL('../', import.meta.url);
const coreText = await fs.readFile(new URL('core.js', root), 'utf8');
const serverText = await fs.readFile(new URL('apps-script/Code.gs', root), 'utf8');
const data = JSON.parse(await fs.readFile(new URL('data.json', root), 'utf8'));
const core = vm.runInNewContext(coreText + '\nAssessmentCore');
const ids = data.questions.slice(0, 10).map(q => q.id);
const baseAssignment = {id:'test-id', recording_id:1, question_ids:ids, experience:'1_to_5', issued:0};
const payload = {answers:Object.fromEntries(ids.map(id=>[id,3])),playback_seconds:60,recording_duration_seconds:180};

test('recording identities and question catalogue are complete',()=>{
  assert.equal(data.recordings.length,235); assert.equal(data.questions.length,20);
  assert.equal(new Set(data.recordings.map(r=>r.id)).size,235);
  assert.equal(data.recordings.find(r=>r.orchestra_id==='disarli').youtube_id,'mPpm6gl_fh4');
  assert.deepEqual(data.questions.map(q=>q.id),Array.from({length:20},(_,i)=>`q${String(i+1).padStart(3,'0')}`));
});
test('equal-coverage orchestra odds are 2:1 independently of catalogue size',()=>{
  const recordings=[{...data.recordings[0],id:1,orchestra_id:'disarli'},...Array.from({length:10},(_,i)=>({...data.recordings[0],id:i+2,orchestra_id:'biagi'}))];
  assert.equal(core.select(recordings,data.questions,{},()=>0.66).recording.orchestra_id,'disarli');
  assert.equal(core.select(recordings,data.questions,{},()=>0.67).recording.orchestra_id,'biagi');
  const totals=Object.fromEntries(data.questions.map(q=>[core.coverageKey(1,q.id),100]));
  assert.equal(core.select(recordings,data.questions,totals,()=>0.1).recording.orchestra_id,'biagi');
});
test('question selection chooses the least weighted coverage, excluding singer for instrumentals',()=>{
  const recording={...data.recordings[0],singer:'Instrumental'};
  const totals=Object.fromEntries(data.questions.slice(0,10).map(q=>[core.coverageKey(recording.id,q.id),10]));
  const selected=core.select([recording],data.questions,totals,()=>0.5).questions;
  assert.equal(selected.length,10); assert(!selected.some(q=>q.id==='q019'));
  assert.equal(selected.filter(q=>Number(q.id.slice(1))>10).length,9);
});
test('coverage ignores unknown and unasked answers, and uses playback weight',()=>{
  const totals=core.coverage([{recording_id:1,playback_seconds:30,recording_duration_seconds:120,q001:4,q002:'',q003:null}],data.questions);
  assert.equal(totals['1:q001'],0.25); assert.equal(Object.keys(totals).length,1);
  assert.equal(core.weight(400,180),1); assert.equal(core.weight(5,0),0);
});
test('submission validates exact assigned questions, values, elapsed time and expiry',()=>{
  assert.equal(core.validateSubmission(payload,baseAssignment,60000),1/3);
  assert.doesNotThrow(()=>core.validateSubmission({...payload,answers:{...payload.answers,q001:null}},baseAssignment,60000));
  assert.throws(()=>core.validateSubmission({...payload,answers:{...payload.answers,q001:6}},baseAssignment,60000));
  assert.throws(()=>core.validateSubmission({...payload,answers:{...payload.answers,q020:1}},baseAssignment,60000));
  assert.throws(()=>core.validateSubmission({...payload,playback_seconds:1000},baseAssignment,60000));
  assert.throws(()=>core.validateSubmission(payload,baseAssignment,86400001));
});
test('playback excludes seeks, buffering, pauses, and long timer gaps; replays count',()=>{
  const clock=new core.PlaybackClock();
  clock.sample(0,0,true); clock.sample(1000,1,true); assert.equal(clock.seconds,1);
  clock.sample(2000,100,true); assert.equal(clock.seconds,1);
  clock.sample(3000,101,false); clock.sample(4000,101,false); assert.equal(clock.seconds,1);
  clock.sample(5000,0,true); clock.sample(6000,1,true); assert.equal(clock.seconds,2);
  clock.sample(10000,5,true); assert.equal(clock.seconds,2);
  clock.sample(11000,5,true); assert.equal(clock.seconds,2);
});

function serverHarness(){
  const rows=[]; let locked=false; const props=new Map();
  const tables = {
    'Tango Assessments': rows,
    Recordings: [['recording_id','orchestra_id','link','title','singer','year','active'],...data.recordings.map(r=>[r.id,r.orchestra_id,r.link,r.title,r.singer,r.year,true])],
    Questions: [['question_id','text','label_1','label_2','label_3','label_4','label_5','active','exclude_instrumental'],...data.questions.map(q=>[q.id,q.text,...q.labels,true,q.id==='q019'])],
    Orchestras: [['orchestra_id','name','priority'],...Array.from(new Map(data.recordings.map(r=>[r.orchestra_id,r.orchestra]))).map(([id,name])=>[id,name,core.priority.has(id)?2:1])]
  };
  const makeSheet = rows => ({getLastRow:()=>rows.length,getLastColumn:()=>Math.max(0,...rows.map(r=>r.length)),getMaxColumns:()=>40,setFrozenRows:()=>{},insertColumnsAfter:()=>{},
    getDataRange:()=>({getValues:()=>rows.map(r=>r.slice())}),
    appendRow:row=>rows.push(row),getRange:(start,col,count,width)=>({
      getValues:()=>rows.slice(start-1,start-1+count).map(r=>Array.from({length:width},(_,i)=>r[col-1+i]??'')),
      setValues:values=>{values.forEach((row,i)=>{if(!rows[start-1+i])rows[start-1+i]=[];row.forEach((v,j)=>rows[start-1+i][col-1+j]=v);});return {setFontWeight:()=>{}};},
      createTextFinder:value=>({matchEntireCell:()=>({findNext:()=>rows.slice(start-1,start-1+count).some(r=>r[col-1]===value) ? {} : null})})
    })});
  const book={getSheetByName:name=>tables[name]?makeSheet(tables[name]):null,insertSheet:name=>{tables[name]=[];return makeSheet(tables[name]);}};
  const context=vm.createContext({console,
    SpreadsheetApp:{openById:()=>book,flush:()=>{}},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key),setProperty:(key,value)=>props.set(key,value)})},
    LockService:{getScriptLock:()=>({waitLock:()=>{assert(!locked);locked=true;},releaseLock:()=>{locked=false;}})},
    Utilities:{getUuid:()=>crypto.randomUUID(),Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},
      computeDigest:(algorithm,value)=>crypto.createHash(algorithm).update(value).digest(),
      base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),
      base64DecodeWebSafe:value=>Buffer.from(value,'base64url'),
      computeHmacSha256Signature:(value,key)=>crypto.createHmac('sha256',key).update(value).digest(),
      newBlob:value=>({getDataAsString:()=>Buffer.from(value).toString('utf8')})}
  });
  vm.runInContext(coreText+'\n'+serverText,context);context.setup();
  return {context,rows,tables};
}
test('Apps Script saves once across retries and writes blanks for unknown answers',()=>{
  const {context,rows}=serverHarness();
  const selected=context.nextAssessment('under_1');
  const answers=Object.fromEntries(selected.questions.map((q,i)=>[q.id,i===0?null:4]));
  const request={token:selected.token,answers,playback_seconds:0,recording_duration_seconds:180};
  assert.equal(context.submitAssessment(request).saved,true);
  assert.equal(context.submitAssessment(request).saved,true);
  assert.equal(rows.length,2);
  assert.equal(rows[1][rows[0].indexOf(selected.questions[0].id)],'');
  assert.equal(rows[1][rows[0].indexOf('cant_judge_question_ids')],selected.questions[0].id);
  assert.equal(rows[1][rows[0].indexOf('experience')],'under_1');
  context.setup(); assert.equal(rows.length,2);
  assert.throws(()=>context.submitAssessment({...request,token:request.token+'tampered'}));
});
test('Apps Script rejects altered answer IDs and leaves storage unchanged',()=>{
  const {context,rows}=serverHarness(); const selected=context.nextAssessment('over_5');
  const answers=Object.fromEntries(selected.questions.map(q=>[q.id,2])); answers.extra=2;
  assert.throws(()=>context.submitAssessment({token:selected.token,answers,playback_seconds:0,recording_duration_seconds:0}));
  assert.equal(rows.length,1);
});

test('sheet edits are read live: appended recordings, priorities and active questions',()=>{
  const {context,tables}=serverHarness();
  tables.Orchestras.push(['new-orchestra','New Orchestra',9]);
  tables.Recordings.push([236,'new-orchestra','https://youtu.be/abcdefghijk','New song','Instrumental',1945,true]);
  tables.Questions[1][7]=false;
  const catalog=vm.runInContext('catalog_(SpreadsheetApp.openById(SPREADSHEET_ID))',context);
  assert.equal(catalog.recordings.length,236);assert.equal(catalog.priorities['new-orchestra'],9);
  assert(!catalog.questions.some(q=>q.id==='q001'));
  const firstVersion=catalog.version;tables.Questions[2][1]='Changed wording';
  assert.notEqual(vm.runInContext('catalog_(SpreadsheetApp.openById(SPREADSHEET_ID)).version',context),firstVersion);
});
test('edits mid-listen retain assigned snapshots; new response columns append safely',()=>{
  const {context,tables,rows}=serverHarness();
  const selected=context.nextAssessment('1_to_5');
  const oldText=selected.questions[0].text;
  tables.Questions.find(r=>r[0]===selected.questions[0].id)[1]='Edited after assignment';
  tables.Questions.push(['q021','New question?','1','2','3','4','5',true,false]);
  context.setup();
  const request={token:selected.token,answers:Object.fromEntries(selected.questions.map(q=>[q.id,4])),playback_seconds:0,recording_duration_seconds:180};
  context.submitAssessment(request);
  const snapshot=JSON.parse(rows[1][rows[0].indexOf('question_snapshot_json')]);
  assert.equal(snapshot[0].text,oldText);assert(rows[0].includes('q021'));
  const savedRow=JSON.stringify(rows[1]);context.setup();assert.equal(JSON.stringify(rows[1]),savedRow);
});
test('old response schema migrates by appending columns without moving answers',()=>{
  const {context,rows}=serverHarness();
  rows[0].splice(31);rows.push(rows[0].map((h,i)=>i===11?5:''));
  const previous=JSON.stringify(rows[1]);context.setup();
  assert.equal(JSON.stringify(rows[1]),previous);assert.equal(rows[0][11],'q001');assert(rows[0].includes('question_snapshot_json'));
});
test('duplicate catalogue IDs and invalid priorities fail visibly',()=>{
  const {context,tables}=serverHarness();tables.Recordings.push(tables.Recordings[1].slice());
  assert.throws(()=>context.nextAssessment('under_1'),/Duplicate/);tables.Recordings.pop();tables.Orchestras[1][2]=0;
  assert.throws(()=>context.nextAssessment('under_1'),/priority/);
});
test('coverage does not mix changed question wording with earlier snapshots',()=>{
  const q=data.questions[0];
  const row={recording_id:1,playback_seconds:180,recording_duration_seconds:180,q001:5,question_snapshot_json:JSON.stringify([q])};
  assert.equal(core.coverage([row],[q])['1:q001'],1);
  assert.equal(Object.keys(core.coverage([row],[{...q,text:'New wording'}])).length,0);
});
