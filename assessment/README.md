# Tango listening assessments

## Upgrade from the original Data.gs version

The live catalogue now comes directly from the **Recordings**, **Questions** and
**Orchestras** tabs in your Google Sheet. These tabs have been populated with the
235 finalized recordings, 20 questions and 26 orchestra priorities.

1. In Apps Script, replace **Code.gs**, **Core.gs** and **App.html** with the latest
   files in `assessment/apps-script/`.
2. Delete the old **Data.gs** file in the Apps Script editor. It is no longer used.
3. Run **setup** again. It checks the configuration and adds missing response
   columns without clearing, moving or replacing previous responses.
4. If already deployed, use **Deploy → Manage deployments → Edit → New version → Deploy**.
   Otherwise follow the initial deployment steps below. Keep the same public URL
   when updating an existing deployment.

This is a one-time code upgrade. Future catalogue edits need no code changes,
build, setup run, or redeployment.

## Editing the live data

- **Recordings:** append a row with a new permanent `recording_id` (next is 236),
  an existing `orchestra_id`, YouTube `link`, `title`, `singer`, `year`, and
  `active=TRUE`. Uncheck active to retire a recording. Never reuse an ID.
- **Questions:** edit text or the five scale labels, append new IDs such as q021,
  or uncheck `active`. `exclude_instrumental` excludes a question for instrumental
  recordings. Keep at least ten applicable active questions for every recording.
- **Orchestras:** edit the positive numeric `priority`; currently the six favored
  orchestras have 2 and the others 1. To add an orchestra, first append its unique
  lowercase/hyphen ID, display name, and priority here, then add its recordings.
- Edits take effect on the next assignment. An already-open assessment retains
  the exact questions and recording it was assigned and can still be submitted.
- A question-set fingerprint is generated automatically. Each new response also
  stores the question text/labels and recording metadata shown. For coverage,
  prior snapshot-backed answers with changed wording or labels are excluded;
  unchanged questions retain their coverage. Legacy rows without snapshots keep
  their original behavior (their old wording cannot be reconstructed).
- The application adds new answer columns at the right without moving old data.
  Do not manually rename response headers or reuse old question IDs for unrelated
  concepts. Configuration rows with duplicate IDs or invalid fields are rejected.
- `assessment/data.json` is only an initial fixture for offline preview and tests.
  The production app does not read it; the private Google Sheet is authoritative.

## Agreed behavior

- Ask each visit: less than one year / 1–5 years / more than five years dancing tango.
- Store that choice only in page memory. No cookie, localStorage, sessionStorage, sign-in, or persistent participant ID. Refreshing starts a new visit.
- Show title, orchestra, singer/instrumental and year, plus an embedded YouTube player.
- Ask ten active questions from the Questions tab, initially twenty. Original IDs q001–q012 are retained; additions use q013–q020. The frequency question q005 uses Never–Very often labels; other wording is unchanged. q019 starts with exclude_instrumental enabled.
- Require an explicit 1–5 or “I can’t judge” for each of the ten. Unknown answers are blank in the response sheet and do not add coverage.
- Submit, wait for confirmation, then show another recording. Skip discards the unfinished assessment. Repeats are allowed. There is no fixed session length.
- Count approximate elapsed playback while the player advances normally. Pauses, buffering and seek jumps do not add time; replay does. Long background timer gaps are conservatively excluded. Weight is min(1, playback seconds / duration), or 0 when duration is unavailable. All ten answers share the fraction frozen at submission.
- Each of Di Sarli, D’Arienzo, Troilo, Pugliese, Canaro and Fresedo has priority 2; every other orchestra has priority 1.
- Recording IDs 1–235 are frozen from the corrected combined CSV, including the user's big-four replacements. Add future recordings with new IDs; never regenerate IDs from a sorted list.

## Selection precisely defined

For each recording/question pair, coverage is the sum of listening weights of valid numeric answers. The orchestra's coverage is the average of its recordings' mean applicable-question coverage. Choose an orchestra randomly with weight `priority / (1 + coverage)`, then a recording with weight `1 / (1 + mean coverage)`. Choose the ten lowest-coverage applicable questions, breaking ties randomly. The 2:1 ratio holds at equal coverage, per orchestra, independent of catalogue size. Questions are not selected using their ratings or the listener's experience.

## Architecture

Quartz serves `content/assessments.md`, linked from the wiki welcome page, at `/tangowiki/assessments`. Its iframe opens the static launcher under `/tangowiki/static/assessment/`. The launcher embeds the deployed Apps Script form. The form uses Google's supported `google.script.run` bridge to save and select on the server, so there is no cross-origin `fetch` workaround, public spreadsheet, browser credential, or unconfirmed `no-cors` submission.

Apps Script runs as the owner and writes only to **Tango Assessments** in the supplied spreadsheet:
https://docs.google.com/spreadsheets/d/1RwHUoVQ9KvGawtMMlXdx159EMoCT4saj349NtdrUKE4/edit

The frontend and Sheets integration are fully coded, but live collection requires the owner to authorize and deploy Apps Script and configure its public `/exec` URL. Do not publish the response sheet to the web or share it with respondents. Existing tabs are preserved by setup.

## Enable collection (one-time owner setup)

1. Open the destination Google Sheet. Choose **Extensions → Apps Script**.
2. Copy the files from `assessment/apps-script/` into the editor. Create script files **Code** and **Core**, and an HTML file **App**. Replace the default Code content. No **Data.gs** is needed.
3. In Project Settings, enable showing `appsscript.json`. Replace it with the supplied manifest (Sheets scope only).
4. Select **setup** and click **Run**. Authorize access to your spreadsheet. This adds the header row in a new **Tango Assessments** tab and creates a private signing secret in Script Properties. It never clears existing responses. Re-running setup checks headers instead of replacing them.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as: Me** and **Who has access: Anyone**. If your account's administrator prohibits anonymous access, that restriction must be resolved before anonymous participation can work. Deploy and copy the URL ending in `/exec`.
6. Put that URL between the quotes in `quartz/static/assessment/config.js`. It is a public app address, not a credential. Do not put the signing secret or an OAuth token in the repository.
7. Publish the repository changes to the wiki's `v5` branch using your usual review process. Its existing GitHub Pages workflow builds the app, runs its tests and builds Quartz.
8. Open the assessment page in a signed-out browser. Submit one test assessment, verify exactly one row in **Tango Assessments**, check that a repeat click/retry does not duplicate it, and confirm the next recording loads. Delete only that known test row if you do not want it in analysis.

If the embedded form is blocked by browser third-party restrictions, try opening the Apps Script `/exec` URL directly to diagnose the deployment. The wiki also has a full-window launcher link for more space. The form does not itself store cookies, but Google/YouTube embedding may involve third-party cookies or technical data.

## Response schema and CSV export

One row per submitted recording assessment, with:

`assessment_id, recording_id, orchestra_id, submitted_at, experience, playback_seconds, recording_duration_seconds, listening_weight, question_ids, cant_judge_question_ids, question_set_version, q001 … q020, question_snapshot_json, recording_snapshot_json`

New question columns are appended, never inserted between old columns. Always
read the CSV by header name, not by fixed column position.

`question_ids` preserves the ten presented IDs and their order; `cant_judge_question_ids` distinguishes explicit unknown answers from questions not asked. Both use comma-separated IDs inside a single cell. Google Sheets' CSV export quotes them correctly. Timestamp is UTC ISO 8601. Experience values are `under_1`, `1_to_5`, `over_5`. No IP address, email or participant identity is collected by application code.

To export, select **Tango Assessments**, then **File → Download → Comma-separated values (.csv)**. Use a real CSV parser; do not split lines on commas manually. The configuration tabs provide the current lookup and the snapshot columns preserve what was shown at submission. Weight is recomputed from the raw timing fields for coverage.

## Development

Requires Node 22+ (the wiki's existing requirement). The assessment builder/tests themselves have no external dependencies:

```console
node assessment/build.mjs
node --test assessment/tests/*.test.mjs
```

The builder produces Apps Script **App.html**, **Core.gs** and a clearly labelled, non-persistent preview at `quartz/static/assessment/preview.html`. Serve the repository with a local HTTP server to preview it. The preview never writes to Google Sheets. Edit `app.html`, `app.js`, `style.css`, `core.js` for application changes; `data.json` is an offline fixture only. Rebuild after code edits. Upload updated generated files to Apps Script and update its existing deployment to a **new version**; rebuilding GitHub Pages alone does not update the Apps Script app. Live data edits require none of those steps.

`node assessment/configure.mjs https://script.google.com/macros/s/DEPLOYMENT_ID/exec` can set the launcher URL without manual editing. The launcher deliberately shows a not-ready message until a valid URL is configured, rather than collecting answers that cannot be saved.

## Reliability and limits

- A signed assignment binds a recording, ten questions, experience and issue time. Server-side validation rejects altered assignments, invalid ratings and implausible timing. Assignments expire after 24 hours.
- A script lock serializes writes; the signed assignment ID prevents duplicate rows after a lost response. Failed submissions stay in memory with the same ID and payload for retry. Once saving is confirmed, a next-recording failure offers a separate retry and cannot resubmit the previous answers.
- Timing is a browser estimate, not proof of listening or protection against a determined client forging plausible timings. Anonymous public endpoints can be abused; Apps Script and Sheets have quotas. No invasive identity tracking or CAPTCHA is added.
- Coverage is calculated from saved responses at assignment time. Concurrent listeners may receive the same gaps; repeats are intentional. The simple sheet scan is suitable for a small study, not an unlimited high-traffic service. Revisit aggregation if latency or volume grows.
- The app does not ask visitors for Google authorization; the owner authorizes once. Live anonymous access, browser embedding, real YouTube playback, and real Google writes still need deployment verification.

References: [Apps Script web apps](https://developers.google.com/apps-script/guides/web), [client/server communication](https://developers.google.com/apps-script/guides/html/communication), [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference).
