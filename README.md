# CaseRoom

CaseRoom is a local-first medical simulation room for high-stakes OSCE-style training. This repository currently ships a renderer-first MVP scaffold with modular simulation, case-pack, and QVAC adapter layers. Patient text turns can go through a local QVAC bridge in development, while the app keeps a deterministic fallback path for demo reliability.

## Current scope

- Medical vertical only
- Engine-shaped architecture for future room types
- Local seed cases and local rubric/guideline grounding
- Lobby, doorway brief, consultation room, and debrief flows
- Local QVAC text-completion bridge with automatic fallback if the bridge is unavailable
- Voice loop for live demo use: mic input via local QVAC Whisper ASR when the bridge is running, spoken patient replies via local QVAC TTS, and browser voice fallbacks
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
```

## Environment notes

- Node `24.x` was used for local scaffolding.
- The desktop package now includes a real Electron `main`/`preload` shell and can open the built renderer with `npm run start --workspace @caseroom/desktop`.
- Completed encounters are stored in a local SQLite database under the app's Electron user-data directory. The browser `localStorage` path remains only as a fallback when the renderer is opened outside Electron.
- The `packages/qvac-runtime` package now contains both the browser-safe adapter and a Node-side QVAC bridge process. The bridge uses `@qvac/sdk` for patient text completion.
- When the bridge is reachable but the patient model is still cold, the app now requests a background warmup so the first encounter turn is less likely to stall.
- The bridge also provisions a persistent local RAG workspace using QVAC embeddings and workspace storage. Debrief citations fall back to bundled static citations if the local RAG workspace is unavailable.
- Voice output now tries QVAC Supertonic TTS through the local bridge first. If the bridge is unavailable, TTS model loading fails, or browser audio playback is blocked, the app falls back to the best available local English browser/OS voice.
- Voice input now records local microphone audio with `MediaRecorder` and sends it to the local bridge `POST /asr`, backed by `WHISPER_EN_TINY_Q8_0` and Silero VAD. If local recording is unavailable, the app falls back to browser Web Speech configured for English.
- No cloud services are required for the current demo path.

## Voice quality notes

CaseRoom currently tries local QVAC Supertonic TTS first. The bridge endpoint is `POST /tts` and returns WAV audio generated on-device through `TTS_EN_SUPERTONIC_Q8_0`.

If QVAC TTS is unavailable, CaseRoom falls back to the best available local English browser/OS voice. For better free fallback quality on macOS, install higher-quality English voices in `System Settings > Accessibility > Spoken Content > System Voice > Manage Voices...`, then restart the browser or Electron app. Recommended local voices to try first are `Samantha`, `Ava`, `Allison`, or any English `Premium` / `Enhanced` voice available on the machine.

Speech-to-text is QVAC-backed when the local bridge has been restarted with the latest code. The first ASR use can take longer while Whisper and Silero VAD are loaded or downloaded into the local QVAC cache.

## QVAC bridge configuration

Optional environment variables:

```bash
CASE_ROOM_QVAC_PORT=4545
CASE_ROOM_QVAC_MODEL=LLAMA_3_2_1B_INST_Q4_0
VITE_CASE_ROOM_QVAC_URL=http://127.0.0.1:4545
```

Supported built-in model constants currently wired in the bridge:

- `LLAMA_3_2_1B_INST_Q4_0`
- `QWEN3_600M_INST_Q4`
- `QWEN3_1_7B_INST_Q4`

## Repo structure

- `apps/desktop`: Vite + React MVP renderer app
- `packages/simulation-core`: domain model, session engine, rubric/debrief logic
- `packages/qvac-runtime`: mockable local AI adapter
- `packages/case-packs/medical-osce`: seed medical scenarios and local guideline snippets
- `.docs`: resumable product, architecture, delivery, and decision records

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
