const SPREADSHEET_ID = '1RwHUoVQ9KvGawtMMlXdx159EMoCT4saj349NtdrUKE4';
const RESPONSE_TAB = 'Tango Assessments';
const BASE_HEADERS = ['assessment_id', 'recording_id', 'orchestra_id', 'submitted_at', 'experience',
  'playback_seconds', 'recording_duration_seconds', 'listening_weight',
  'question_ids', 'cant_judge_question_ids', 'question_set_version'];

function table_(book, name, required) {
  const sheet = book.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('Missing or empty configuration tab: ' + name);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift().map(v => String(v).trim());
  if (new Set(headers).size !== headers.length || required.some(h => !headers.includes(h))) throw new Error('Check column headers in ' + name);
  return values.filter(row => row.some(v => v !== '')).map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}
function boolean_(value, label) {
  if (value === true || String(value).toLowerCase() === 'true') return true;
  if (value === false || String(value).toLowerCase() === 'false') return false;
  throw new Error(label + ' must be TRUE or FALSE.');
}
function unique_(rows, key, label) {
  if (new Set(rows.map(r => String(r[key]))).size !== rows.length) throw new Error('Duplicate IDs in ' + label);
}
function videoId_(link) {
  const match = String(link).trim().match(/^https:\/\/(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})(?:[?&#/]|$)/);
  if (!match) throw new Error('Invalid YouTube link: ' + link);
  return match[1];
}
function catalog_(book) {
  const orchestras = table_(book, 'Orchestras', ['orchestra_id','name','priority']);
  unique_(orchestras, 'orchestra_id', 'Orchestras');
  const byId = {}, priorities = {};
  for (const o of orchestras) {
    if (!/^[a-z][a-z0-9-]*$/.test(o.orchestra_id) || !String(o.name).trim() || !Number.isFinite(Number(o.priority)) || Number(o.priority) <= 0) throw new Error('Invalid orchestra or priority.');
    byId[o.orchestra_id] = o; priorities[o.orchestra_id] = Number(o.priority);
  }
  const rawQuestions = table_(book, 'Questions', ['question_id','text','label_1','label_2','label_3','label_4','label_5','active','exclude_instrumental']);
  unique_(rawQuestions, 'question_id', 'Questions');
  const allQuestions = rawQuestions.map(q => {
    if (!/^q\d{3,}$/.test(q.question_id) || !String(q.text).trim()) throw new Error('Invalid question ID or text.');
    const labels = [1,2,3,4,5].map(i => String(q['label_' + i]).trim());
    if (labels.some(v => !v)) throw new Error('All five labels are required for ' + q.question_id);
    return {id:q.question_id, text:String(q.text), labels,
      active:boolean_(q.active, q.question_id + ' active'), exclude_instrumental:boolean_(q.exclude_instrumental, q.question_id + ' exclude_instrumental')};
  });
  const questions = allQuestions.filter(q => q.active);
  const rawRecordings = table_(book, 'Recordings', ['recording_id','orchestra_id','link','title','singer','year','active']);
  unique_(rawRecordings.map(r => ({id:Number(r.recording_id)})), 'id', 'Recordings');
  const recordings = rawRecordings.filter(r => boolean_(r.active, 'Recording active')).map(r => {
    if (!Number.isInteger(Number(r.recording_id)) || Number(r.recording_id) <= 0 || !byId[r.orchestra_id] || !String(r.title).trim() || !Number.isInteger(Number(r.year)) || Number(r.year) < 1900 || Number(r.year) > 2100) throw new Error('Invalid recording: ' + r.recording_id);
    return {id:Number(r.recording_id), orchestra_id:r.orchestra_id, orchestra:String(byId[r.orchestra_id].name),
      title:String(r.title), singer:String(r.singer || 'Unknown'), year:Number(r.year), link:String(r.link), youtube_id:videoId_(r.link)};
  });
  if (!recordings.length || recordings.some(r => AssessmentCore.applicable(r, questions).length < 10)) throw new Error('Every active recording needs at least ten applicable active questions.');
  const definitions = questions.slice().sort((a,b) => a.id.localeCompare(b.id));
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(definitions), Utilities.Charset.UTF_8);
  return {recordings,questions,allQuestions,priorities,version:Utilities.base64EncodeWebSafe(digest)};
}
// Under the script lock, append columns only. Never reorder or clear old responses.
function responseSheet_(book, questionIds) {
  let sheet = book.getSheetByName(RESPONSE_TAB);
  if (!sheet) sheet = book.insertSheet(RESPONSE_TAB);
  let headers = sheet.getLastRow() ? sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0] : [];
  if (headers.length && (new Set(headers).size !== headers.length || BASE_HEADERS.some((h,i) => headers[i] !== h))) throw new Error('Unexpected assessment headers. Existing responses have not been changed.');
  const needed = BASE_HEADERS.concat(questionIds, ['question_snapshot_json','recording_snapshot_json']);
  const additions = needed.filter(h => !headers.includes(h));
  if (additions.length) {
    const total = headers.length + additions.length;
    if (sheet.getMaxColumns() < total) sheet.insertColumnsAfter(sheet.getMaxColumns(), total - sheet.getMaxColumns());
    sheet.getRange(1,headers.length + 1,1,additions.length).setValues([additions]).setFontWeight('bold');
    headers = headers.concat(additions); sheet.setFrozenRows(1);
  }
  return {sheet,headers};
}
function setup() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const book = SpreadsheetApp.openById(SPREADSHEET_ID), data = catalog_(book);
    responseSheet_(book, data.allQuestions.map(q => q.id));
    const props = PropertiesService.getScriptProperties();
    if (!props.getProperty('SIGNING_SECRET')) props.setProperty('SIGNING_SECRET', Utilities.getUuid() + Utilities.getUuid());
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
}
function secret_() {
  const secret = PropertiesService.getScriptProperties().getProperty('SIGNING_SECRET');
  if (!secret) throw new Error('Run setup before collecting assessments.'); return secret;
}
function signature_(text) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(text, secret_())); }
function token_(assignment) {
  const body = Utilities.base64EncodeWebSafe(JSON.stringify(assignment), Utilities.Charset.UTF_8);
  return body + '.' + signature_(body);
}
function assignment_(token) {
  if (typeof token !== 'string' || token.length > 60000) throw new Error('Invalid assessment token.');
  const parts = token.split('.');
  if (parts.length !== 2 || signature_(parts[0]) !== parts[1]) throw new Error('Invalid assessment token.');
  return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
}
function doGet() {
  return HtmlService.createHtmlOutputFromFile('App').setTitle('Tango listening assessments')
    .addMetaTag('viewport','width=device-width, initial-scale=1').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function nextAssessment(experience) {
  if (!AssessmentCore.experiences.includes(experience)) throw new Error('Please select your tango experience.');
  // No catalogue cache: edits are visible on the next assignment.
  const book = SpreadsheetApp.openById(SPREADSHEET_ID), data = catalog_(book);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  let rows;
  try {
    const response = responseSheet_(book, data.allQuestions.map(q => q.id));
    const values = response.sheet.getLastRow() > 1 ? response.sheet.getRange(2,1,response.sheet.getLastRow()-1,response.headers.length).getValues() : [];
    rows = values.map(row => Object.fromEntries(response.headers.map((h,i) => [h,row[i]])));
  } finally { lock.releaseLock(); }
  const selection = AssessmentCore.select(data.recordings,data.questions,AssessmentCore.coverage(rows,data.questions),Math.random,data.priorities);
  const assignment = {id:Utilities.getUuid(),recording_id:selection.recording.id,recording:selection.recording,
    questions:selection.questions,question_ids:selection.questions.map(q => q.id),experience,issued:Date.now(),version:data.version};
  return {...selection,token:token_(assignment),id:assignment.id};
}
function submitAssessment(payload) {
  if (!payload || JSON.stringify(payload).length > 70000) throw new Error('Invalid submission.');
  const assignment = assignment_(payload.token);
  if (!assignment.recording || !assignment.questions) throw new Error('This form uses an old assignment. Reload to start again.');
  const weight = AssessmentCore.validateSubmission(payload, assignment);
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    // Save the signed snapshot, even if the owner edited the catalogue mid-listen.
    const response = responseSheet_(SpreadsheetApp.openById(SPREADSHEET_ID), assignment.question_ids), sheet = response.sheet;
    if (sheet.getLastRow() > 1 && sheet.getRange(2,1,sheet.getLastRow()-1,1).createTextFinder(assignment.id).matchEntireCell(true).findNext()) return {saved:true,id:assignment.id};
    const row = {assessment_id:assignment.id,recording_id:assignment.recording_id,orchestra_id:assignment.recording.orchestra_id,
      submitted_at:new Date().toISOString(),experience:assignment.experience,playback_seconds:payload.playback_seconds,
      recording_duration_seconds:payload.recording_duration_seconds,listening_weight:weight,question_ids:assignment.question_ids.join(','),
      cant_judge_question_ids:assignment.question_ids.filter(id => payload.answers[id] === null).join(','),question_set_version:assignment.version,
      question_snapshot_json:JSON.stringify(assignment.questions),recording_snapshot_json:JSON.stringify(assignment.recording),...payload.answers};
    sheet.appendRow(response.headers.map(h => row[h] == null ? '' : row[h]));
    SpreadsheetApp.flush(); return {saved:true,id:assignment.id};
  } finally { lock.releaseLock(); }
}
