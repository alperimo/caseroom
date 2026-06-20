# CaseRoom

CaseRoom is a local-first, voice-first clinical simulation room for high-stakes medical training. Learners enter a 2.5D consultation room and speak with a synthetic patient grounded in local case data, then use in-room exam, tests, impression, plan, and safety-net tools to complete the encounter. Each session ends with a rubric-based debrief and source-backed local citations.

## Current scope

- Medical vertical only
- Engine-shaped architecture for future room types
- Local seed cases and local rubric/guideline grounding
- Lobby, doorway brief, consultation room, and debrief flows
- Local QVAC text-completion bridge with optional strict mode for audited local-inference runs
- Voice-first interaction: mic input via local QVAC Whisper ASR when the bridge is running, spoken patient replies via local QVAC TTS, and browser voice fallbacks
- Persistent local embeddings workspace for bundled medical guidance and citation retrieval
- Local SQLite session persistence for completed encounters inside the Electron shell

## Run locally

```bash
npm install
npm run dev
```

`npm run dev` starts:

- the local QVAC bridge on `http://127.0.0.1:4545`
- the renderer on `http://127.0.0.1:5173`
- the Electron desktop shell pointed at that renderer

The app should open in its desktop window automatically.

## Available scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test
npm run verify
npm run evidence:bundle
```

## Environment notes

- Node `24.x` was used for local scaffolding.
- The desktop package now includes a real Electron `main`/`preload` shell and can open the built renderer with `npm run start --workspace @caseroom/desktop`.
- Completed encounters are stored in a local SQLite database under the app's Electron user-data directory. The browser `localStorage` path remains only as a fallback when the renderer is opened outside Electron.
- The `packages/qvac-runtime` package now contains both the browser-safe adapter and a Node-side QVAC bridge process. The bridge uses `@qvac/sdk` for patient text completion.
- When the bridge is reachable but the patient model is still cold, the app now requests a background warmup so the first encounter turn is less likely to stall.
- The bridge also provisions a persistent local RAG workspace using QVAC embeddings and workspace storage. Debrief citations fall back to bundled static citations if the local RAG workspace is unavailable.
- Voice output now tries QVAC Supertonic TTS through the local bridge first, selecting authored patient voice IDs such as `F1`, `F2`, or `M1` from the case data. If the bridge is unavailable, TTS model loading fails, or browser audio playback is blocked, the app falls back to the best available local English browser/OS voice.
- Voice input now records local microphone audio with `MediaRecorder` and sends it to the local bridge `POST /asr`, backed by `WHISPER_EN_BASE_Q8_0` and Silero VAD by default. If local recording is unavailable, the app falls back to browser Web Speech configured for English.
- No cloud services are required for the current demo path.

## Voice quality notes

CaseRoom currently tries local QVAC Supertonic TTS first. The bridge endpoint is `POST /tts` and returns WAV audio generated on-device through `TTS_EN_SUPERTONIC_Q8_0`. Cases can request a specific Supertonic voice ID (`F1`, `F2`, `M1`, or `M2`) so patient audio matches the authored persona.

If QVAC TTS is unavailable, CaseRoom falls back to the best available local English browser/OS voice. For better free fallback quality on macOS, install higher-quality English voices in `System Settings > Accessibility > Spoken Content > System Voice > Manage Voices...`, then restart the browser or Electron app. Recommended local voices to try first are `Samantha`, `Ava`, `Allison`, or any English `Premium` / `Enhanced` voice available on the machine.

Speech-to-text is QVAC-backed when the local bridge has been restarted with the latest code. The first ASR use can take longer while Whisper and Silero VAD are loaded or downloaded into the local QVAC cache.

## QVAC Bridge Configuration

Optional environment variables:

```bash
CASE_ROOM_QVAC_PORT=4545
CASE_ROOM_QVAC_MODEL=LLAMA_3_2_1B_INST_Q4_0
CASE_ROOM_QVAC_MODEL_PATH=/absolute/path/to/local-model.gguf
CASE_ROOM_QVAC_ASR_MODEL=WHISPER_EN_BASE_Q8_0
CASE_ROOM_STRICT_QVAC=1
VITE_CASE_ROOM_QVAC_URL=http://127.0.0.1:4545
VITE_CASE_ROOM_STRICT_QVAC=1
VITE_CASE_ROOM_ENABLE_EVALUATOR=1
VITE_CASE_ROOM_EVALUATOR_TIMEOUT_MS=3500
```

Supported built-in model constants currently wired in the bridge:

- `LLAMA_3_2_1B_INST_Q4_0`
- `MEDGEMMA_4B_IT_Q4_1`
- `MEDGEMMA_4B_IT_Q8_0`
- `QWEN3_600M_INST_Q4`
- `QWEN3_1_7B_INST_Q4`

Model selection notes:

- The installed `@qvac/sdk` exposes `MEDGEMMA_4B_IT_Q4_1`, `MEDGEMMA_4B_IT_Q8_0`, and multiple Whisper/TTS/GTE constants.
- Use `MEDGEMMA_4B_IT_Q4_1` for the most reliable medical run path on typical Apple Silicon development machines. Try `MEDGEMMA_4B_IT_Q8_0` only if latency and memory headroom are acceptable.
- MedPsy GGUF models can be tested by downloading the GGUF locally and launching with `CASE_ROOM_QVAC_MODEL_PATH=/absolute/path/to/MedPsy-model.gguf npm run dev`. This keeps the bridge local-only and auditable without relying on a remote inference API.
- Recommended MedPsy file for larger local development machines: `medpsy-4b-q4_k_m-imat.gguf`. It is the best first balance of quality and memory. If it is too slow, try `medpsy-4b-iq4_xs-imat.gguf` or the 1.7B variant; if quality is too weak and latency is acceptable, try `medpsy-4b-q5_k_m-imat.gguf`.
- ASR defaults to `WHISPER_EN_BASE_Q8_0` for better medical speech recognition. Use `CASE_ROOM_QVAC_ASR_MODEL=WHISPER_EN_TINY_Q8_0` only if startup time matters more than transcription quality.
- Debriefs open with deterministic rubric scoring plus local RAG citations by default. Set `VITE_CASE_ROOM_ENABLE_EVALUATOR=1` to also ask the QVAC completion model for evaluator wording; this can add noticeable latency with larger local models.
- `CASE_ROOM_STRICT_QVAC=1` and `VITE_CASE_ROOM_STRICT_QVAC=1` disable silent AI/RAG fallbacks for audited runs. If completion, RAG, ASR, TTS, or evaluator calls fail in strict mode, the app surfaces the failure instead of pretending the local model path worked.

Example MedPsy setup:

```bash
mkdir -p models
python3 -m pip install -U "huggingface_hub[cli]"
hf auth login
hf download qvac/MedPsy-4B-GGUF medpsy-4b-q4_k_m-imat.gguf --local-dir ./models
CASE_ROOM_STRICT_QVAC=1 VITE_CASE_ROOM_STRICT_QVAC=1 CASE_ROOM_QVAC_MODEL_PATH="$PWD/models/medpsy-4b-q4_k_m-imat.gguf" npm run dev
```

Do not install an npm package named `hf`; the `hf` command comes from Hugging Face's Python CLI.

Verify the active bridge model:

```bash
curl -s http://127.0.0.1:4545/health | python3 -m json.tool
```

For a local MedPsy run, `modelName` should include `local:medpsy-4b-q4_k_m-imat.gguf`.

## Reproducibility And Evidence

The reproducible path assumes a desktop machine with local QVAC model cache, Electron, Node, and microphone access. Exact hardware claims for external review belong in the generated artifacts and project runbook, not in the general product setup.

Reproducible run:

```bash
npm install
CASE_ROOM_QVAC_MODEL=MEDGEMMA_4B_IT_Q4_1 npm run dev
```

Strict local-inference run:

```bash
CASE_ROOM_STRICT_QVAC=1 VITE_CASE_ROOM_STRICT_QVAC=1 CASE_ROOM_QVAC_MODEL=MEDGEMMA_4B_IT_Q4_1 npm run dev
```

Verification and artifact collection:

```bash
npm run verify
npm run qvac:shutdown
npm run evidence:bundle
```

Run `npm run qvac:shutdown` before stopping the dev terminal for the final evidence pass. It asks the local QVAC bridge to unload tracked models through the SDK and writes real `model.unload` events with timestamps and durations into `.artifacts/performance/inference-events.jsonl`. After it returns, stop the dev process and collect the bundle.

`npm run evidence:bundle` writes `.artifacts/submission/` with:

- hardware proof JSON
- QVAC health snapshot when the bridge is running
- typecheck, lint, test, build logs
- git status and diff-stat logs
- structured performance logs under `performance/` after at least one standard encounter
- remote API transparency metadata
- a manifest listing manual artifacts still needed for external review

Manual evidence artifacts still required:

- short demo video showing a full local encounter
- hardware proof screenshot/video showing the local machine running the app
- exported debrief markdown from `Save report`
- QVAC bridge logs and `.artifacts/submission/performance/inference-events.jsonl` showing model load, inference timing, ASR/TTS, and RAG events

## Repo structure

- `apps/desktop`: Vite + React MVP renderer app
- `packages/simulation-core`: domain model, session engine, rubric/debrief logic
- `packages/qvac-runtime`: mockable local AI adapter
- `packages/case-packs/medical-osce`: seed medical scenarios and local guideline snippets

## Demo path

1. Pick one of the seeded cases.
2. Review the doorway brief.
3. Enter the consultation room.
4. Ask questions with the text/voice-console input.
5. Use action buttons for exam, test, diagnosis, and plan.
6. End the encounter and review the debrief with citations.
7. Save the markdown report from the debrief screen as an evidence artifact.

## Evidence export

- The debrief screen includes `Save report`.
- In Electron, the app opens a native save dialog and writes a markdown report to disk.
- Outside Electron, the same action falls back to a browser download.
- Exported reports include summary, score, strengths, gaps, local citations, and the encounter transcript.

## Known limitations

- Patient speech output is QVAC-backed when the local bridge has been restarted with the latest code. Existing dev bridge processes may need to be stopped/restarted before `/tts` is available.
- Voice input is QVAC-backed ASR when the local bridge is running. Browser Web Speech and typed input remain fallbacks when microphone permission, local recording, or model loading is unavailable.
- Session persistence is SQLite-backed in Electron, and debriefs can be exported as markdown evidence reports.
- The room remains a renderer-driven 2.5D experience inside Electron rather than a game-style 3D environment.
- If the QVAC bridge fails to start, the app falls back to deterministic local replies and surfaces that state in the UI.
