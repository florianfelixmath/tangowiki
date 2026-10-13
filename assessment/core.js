/* Shared by the browser, Apps Script, and the tests. No browser storage. */
const AssessmentCore = (() => {
  const priority = new Set(['disarli', 'darienzo', 'troilo', 'pugliese', 'canaro', 'fresedo']);
  const experiences = ['under_1', '1_to_5', 'over_5'];
  const questionVersion = '2026-10-13-v1';
  function weight(seconds, duration) {
    return Number.isFinite(seconds) && Number.isFinite(duration) && duration > 0
      ? Math.max(0, Math.min(1, seconds / duration)) : 0;
  }
  function applicable(recording, questions) {
    return questions.filter(q => !((q.exclude_instrumental === undefined ? q.id === 'q019' : q.exclude_instrumental) && recording.singer.toLowerCase() === 'instrumental'));
  }
  function coverageKey(recordingId, questionId) { return `${recordingId}:${questionId}`; }
  function coverage(rows, questions) {
    const totals = {};
    for (const row of rows) {
      const w = weight(Number(row.playback_seconds), Number(row.recording_duration_seconds));
      const snapshot = row.question_snapshot_json ? JSON.parse(row.question_snapshot_json) : null;
      for (const q of questions) {
        if (snapshot) {
          const prior = snapshot.find(item => item.id === q.id);
          if (!prior || prior.text !== q.text || JSON.stringify(prior.labels) !== JSON.stringify(q.labels)) continue;
        }
        const answer = row[q.id];
        if (answer !== '' && answer != null && Number.isInteger(Number(answer)) && Number(answer) >= 1 && Number(answer) <= 5) {
          const key = coverageKey(row.recording_id, q.id);
          totals[key] = (totals[key] || 0) + w;
        }
      }
    }
    return totals;
  }
  function chooseWeighted(items, getWeight, random = Math.random) {
    if (!items.length) throw new Error('No recordings are available.');
    const weights = items.map(getWeight);
    let target = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < items.length; i++) {
      target -= weights[i];
      if (target < 0) return items[i];
    }
    return items[items.length - 1];
  }
  function select(recordings, questions, totals = {}, random = Math.random, priorities = null) {
    const groups = {};
    const mean = r => {
      const qs = applicable(r, questions);
      return qs.reduce((sum, q) => sum + (totals[coverageKey(r.id, q.id)] || 0), 0) / qs.length;
    };
    for (const r of recordings) {
      if (!groups[r.orchestra_id]) groups[r.orchestra_id] = [];
      groups[r.orchestra_id].push(r);
    }
    const orchestra = chooseWeighted(Object.keys(groups), id => {
      const average = groups[id].reduce((sum, r) => sum + mean(r), 0) / groups[id].length;
      return (priorities ? priorities[id] : (priority.has(id) ? 2 : 1)) / (1 + average);
    }, random);
    const recording = chooseWeighted(groups[orchestra], r => 1 / (1 + mean(r)), random);
    const ranked = applicable(recording, questions).map(q => ({q, score: totals[coverageKey(recording.id, q.id)] || 0, tie: random()}));
    ranked.sort((a, b) => a.score - b.score || a.tie - b.tie);
    if (ranked.length < 10) throw new Error('At least ten applicable questions are required.');
    return {recording, questions: ranked.slice(0, 10).map(x => x.q)};
  }
  function validateSubmission(payload, assignment, now = Date.now()) {
    if (!payload || !assignment || !experiences.includes(assignment.experience)) throw new Error('Invalid assessment.');
    if (!Number.isFinite(assignment.issued) || now < assignment.issued || now - assignment.issued > 24 * 60 * 60 * 1000) throw new Error('This assessment has expired. Reload to start again.');
    const {answers, playback_seconds: seconds, recording_duration_seconds: duration} = payload;
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('Please answer every question.');
    const ids = Object.keys(answers);
    if (ids.length !== 10 || assignment.question_ids.length !== 10 || new Set(assignment.question_ids).size !== 10 || ids.some(id => !assignment.question_ids.includes(id))) throw new Error('The questions do not match this assessment.');
    for (const answer of Object.values(answers)) if (answer !== null && (!Number.isInteger(answer) || answer < 1 || answer > 5)) throw new Error('Ratings must be 1–5 or “I can’t judge”.');
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(duration) || duration < 0 || duration > 86400 || seconds > (now - assignment.issued) / 1000 + 5) throw new Error('Invalid playback timing.');
    return weight(seconds, duration);
  }
  // Estimate wall-clock playback, excluding pauses, buffering and seek jumps.
  class PlaybackClock {
    constructor() { this.seconds = 0; this.previous = null; }
    sample(now, position, playing, rate = 1) {
      const previous = this.previous;
      if (previous && previous.playing && playing && rate > 0) {
        const elapsed = (now - previous.now) / 1000;
        const advance = position - previous.position;
        if (elapsed > 0 && elapsed <= 2.5 && advance > 0 && advance <= elapsed * rate + 0.75) {
          this.seconds += Math.min(elapsed, advance / rate);
        }
      }
      this.previous = {now, position, playing};
      return this.seconds;
    }
  }
  return {priority, experiences, questionVersion, weight, applicable, coverageKey, coverage, chooseWeighted, select, validateSubmission, PlaybackClock};
})();
