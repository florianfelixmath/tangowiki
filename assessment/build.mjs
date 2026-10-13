import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFile(path.join(root, name), 'utf8');
const [template, css, core, app, rawData] = await Promise.all(['app.html', 'style.css', 'core.js', 'app.js', 'data.json'].map(read));
const data = JSON.parse(rawData);
assert.equal(data.questions.length, 20);
assert.equal(new Set(data.recordings.map(r => r.id)).size, data.recordings.length);
assert.equal(new Set(data.questions.map(q => q.id)).size, 20);
for (const r of data.recordings) assert(Number.isInteger(r.id) && r.id > 0 && /^[\w-]{11}$/.test(r.youtube_id));
const safeJson = JSON.stringify(data).replaceAll('<', '\\u003c');
const demo = `window.assessmentDemo = (() => {
  const data = ${safeJson}, rows = [], assignments = new Map(), saved = new Set();
  return {
    async nextAssessment(experience) {
      const result = AssessmentCore.select(data.recordings, data.questions, AssessmentCore.coverage(rows, data.questions));
      const id = crypto.randomUUID();
      assignments.set(id, {id, experience, recording_id: result.recording.id, question_ids: result.questions.map(q => q.id), issued: Date.now()});
      return {...result, id, token: id};
    },
    async submitAssessment(payload) {
      const assignment = assignments.get(payload.token);
      AssessmentCore.validateSubmission(payload, assignment);
      if (!saved.has(assignment.id)) {rows.push({...payload.answers, recording_id: assignment.recording_id, playback_seconds: payload.playback_seconds, recording_duration_seconds: payload.recording_duration_seconds}); saved.add(assignment.id);}
      return {saved: true, id: assignment.id};
    }
  };
})();`;
const compile = demoCode => template.replace('/*ASSESSMENT_STYLE*/', () => css)
  .replace('/*ASSESSMENT_CORE*/', () => core).replace('/*ASSESSMENT_APP*/', () => app)
  .replace('/*ASSESSMENT_DEMO*/', () => demoCode);
const staticDir = path.join(root, '../quartz/static/assessment');
await fs.mkdir(staticDir, {recursive: true});
await fs.writeFile(path.join(root, 'apps-script/App.html'), compile(''));
await fs.writeFile(path.join(root, 'apps-script/Core.gs'), core);
await fs.writeFile(path.join(staticDir, 'preview.html'), compile(demo));
console.log(`Built assessment app: ${data.recordings.length} recordings, ${data.questions.length} questions.`);
