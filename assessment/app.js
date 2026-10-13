(() => {
  const $ = id => document.getElementById(id);
  const labels = {under_1: 'Less than a year', '1_to_5': '1–5 years', over_5: 'More than five years'};
  let experience, current, player, clock, interval, pending, busy = false, saved = 0, generation = 0;
  let youtubePromise;
  const preview = typeof window.assessmentDemo !== 'undefined';
  $('demo-notice').hidden = !preview;
  function rpc(method, value) {
    if (preview) return window.assessmentDemo[method](value);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The connection timed out. Please try again.')), 35000);
      if (!window.google?.script?.run) { clearTimeout(timer); reject(new Error('The assessment service is unavailable. Please open this form from Tango Wiki.')); return; }
      window.google.script.run.withSuccessHandler(result => {clearTimeout(timer); resolve(result);})
        .withFailureHandler(() => {clearTimeout(timer); reject(new Error('We could not reach the assessment service. Your answers are still here; please try again.'));})[method](value);
    });
  }
  function youtube() {
    if (window.YT?.Player) return Promise.resolve();
    if (!youtubePromise) youtubePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('YouTube did not load. You can skip this recording.')), 20000);
      window.onYouTubeIframeAPIReady = () => {clearTimeout(timer); resolve();};
      const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api';
      script.onerror = () => {clearTimeout(timer); reject(new Error('YouTube could not load. You can skip this recording.'));};
      document.head.append(script);
    }).catch(error => {youtubePromise = null; throw error;});
    return youtubePromise;
  }
  function timing() {
    const duration = Number(player?.getDuration?.()) || 0;
    return {playback_seconds: Math.round((clock?.seconds || 0) * 1000) / 1000, recording_duration_seconds: duration};
  }
  function sample() {
    if (!player?.getCurrentTime || !clock) return;
    clock.sample(performance.now(), player.getCurrentTime(), player.getPlayerState() === 1, player.getPlaybackRate());
    const t = timing(), fraction = AssessmentCore.weight(t.playback_seconds, t.recording_duration_seconds);
    $('watch-label').textContent = `${Math.floor(t.playback_seconds)} seconds played`;
    $('watch-percent').textContent = `${Math.round(fraction * 100)}%`;
    $('watch-progress').value = fraction;
  }
  function stopPlayer() {
    clearInterval(interval); generation++;
    if (player) {player.destroy(); player = null;}
    const box = document.querySelector('.video-wrap');
    box.replaceChildren(Object.assign(document.createElement('div'), {id: 'player'}));
  }
  async function loadPlayer(recording) {
    const version = generation;
    try {
      await youtube();
      if (version !== generation) return;
      player = new YT.Player('player', {host: 'https://www.youtube-nocookie.com', videoId: recording.youtube_id,
        width: '100%', height: '100%', playerVars: {playsinline: 1, origin: location.origin},
        events: {
          onReady: () => {if (version === generation) interval = setInterval(sample, 250);},
          onStateChange: event => {if (version !== generation) return; sample(); if (event.data === 1) $('player-notice').textContent = 'Listening time is being counted.'; else if (event.data === 2) $('player-notice').textContent = 'Paused — the listening timer is paused too.';},
          onError: () => {if (version === generation) $('player-notice').textContent = 'This video cannot be played here. Please skip to another recording.';}
        }});
    } catch (error) {if (version === generation) $('player-notice').textContent = error.message;}
  }
  function answers() {
    const result = {};
    for (const question of current.questions) {
      const chosen = document.querySelector(`input[name="${question.id}"]:checked`);
      if (chosen) result[question.id] = chosen.value === 'unknown' ? null : Number(chosen.value);
    }
    return result;
  }
  function questionElement(question, index) {
    const fieldset = document.createElement('fieldset'); fieldset.className = 'question';
    const legend = document.createElement('legend');
    const number = document.createElement('span'); number.className = 'question-number'; number.textContent = String(index + 1).padStart(2, '0');
    legend.append(number, document.createTextNode(question.text)); fieldset.append(legend);
    const choices = document.createElement('div'); choices.className = 'choices';
    for (let value = 1; value <= 5; value++) {
      const label = document.createElement('label'); label.className = 'rating'; label.title = question.labels[value - 1];
      const input = document.createElement('input'); input.type = 'radio'; input.name = question.id; input.value = String(value); input.required = true;
      input.setAttribute('aria-label', `${value} — ${question.labels[value - 1]}`);
      label.append(input, document.createTextNode(String(value))); choices.append(label);
    }
    const ends = document.createElement('div'); ends.className = 'scale-ends';
    for (const text of [question.labels[0], question.labels[4]]) {const span = document.createElement('span'); span.textContent = text; ends.append(span);}
    const unknown = document.createElement('label'); unknown.className = 'cant-judge';
    const input = document.createElement('input'); input.type = 'radio'; input.name = question.id; input.value = 'unknown';
    unknown.append(input, document.createTextNode('I can’t judge')); fieldset.append(choices, ends, unknown);
    return fieldset;
  }
  function render() {
    $('orchestra').textContent = current.recording.orchestra;
    $('recording-title').textContent = current.recording.title;
    $('recording-meta').textContent = `${current.recording.singer} · ${current.recording.year} · Recording ${current.recording.id}`;
    $('experience-label').textContent = `Dancing tango: ${labels[experience]}`;
    $('saved-count').textContent = `${saved} assessment${saved === 1 ? '' : 's'} ${preview ? 'completed in preview' : 'saved'}`;
    $('questions').replaceChildren(...current.questions.map(questionElement));
    $('answered-count').textContent = '0 / 10 answered'; $('form-message').textContent = '';
    $('watch-label').textContent = '0 seconds played'; $('watch-percent').textContent = '0%'; $('watch-progress').value = 0;
    $('player-notice').textContent = 'Press play when you’re ready.';
    $('submit').textContent = 'Submit & next recording →'; $('submit').disabled = false; $('skip').disabled = false;
    $('assessment').hidden = false; $('loading').hidden = true; $('welcome').hidden = true;
    clock = new AssessmentCore.PlaybackClock(); pending = null; loadPlayer(current.recording);
  }
  async function next() {
    if (busy) return;
    busy = true; stopPlayer(); $('assessment').hidden = true; $('welcome').hidden = true; $('loading').hidden = false;
    $('loading-copy').textContent = saved ? 'Your last assessment is saved. Choosing the next recording…' : 'Choosing a recording and ten questions…';
    $('retry-next').hidden = true;
    try {current = await rpc('nextAssessment', experience); render();}
    catch (error) {$('loading-copy').textContent = error.message; $('retry-next').hidden = false;}
    finally {busy = false;}
  }
  $('experience-form').addEventListener('submit', event => {
    event.preventDefault(); experience = new FormData(event.currentTarget).get('experience'); next();
  });
  $('rating-form').addEventListener('change', () => {$('answered-count').textContent = `${Object.keys(answers()).length} / 10 answered`;});
  $('rating-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy || !current) return;
    if (!pending) {
      const ratings = answers(); if (Object.keys(ratings).length !== 10) return;
      sample(); pending = {token: current.token, answers: ratings, ...timing()};
      player?.pauseVideo?.(); clearInterval(interval);
    }
    busy = true; $('submit').disabled = true; $('skip').disabled = true;
    document.querySelectorAll('#questions input').forEach(input => input.disabled = true);
    $('form-message').textContent = 'Saving your answers…';
    let success = false;
    try {
      const result = await rpc('submitAssessment', pending);
      if (!result.saved || result.id !== current.id) throw new Error('Saving was not confirmed. Please retry.');
      saved++; pending = null; success = true;
    } catch (error) {$('form-message').textContent = `${error.message} Retry sends the same answers once.`; $('submit').textContent = 'Retry saving'; $('submit').disabled = false;}
    finally {busy = false;}
    if (success) {await next(); window.scrollTo({top: 0, behavior: 'smooth'});}
  });
  $('skip').addEventListener('click', () => {if (!pending) next();});
  $('retry-next').addEventListener('click', next);
  window.addEventListener('pagehide', () => {clearInterval(interval); player?.pauseVideo?.();});
})();
