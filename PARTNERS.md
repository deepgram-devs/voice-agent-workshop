# Using LiveKit, Pipecat, Vapi, Twilio or Telnyx? Here's what carries over

The missions build an agent on the Deepgram Voice Agent API: one WebSocket, one Settings message, and Deepgram runs hearing, thinking and voice for you. Many teams build on a voice platform, with Deepgram selected inside it. This page shows, platform by platform, where Deepgram is selected and which parts of your mission files you can take with you.

Two groups:

- **Phone bridges (Twilio, Telnyx media streaming).** Your server relays call audio to the Voice Agent API. Everything carries over: your Settings go in as they are, with the audio format set for the phone line, and your `on_event` handling keeps working.
- **Platforms with their own pipeline (LiveKit, Pipecat, Vapi, Telnyx AI Assistants).** The platform runs the conversation, and Deepgram does the hearing and the voice. Your prompt, your voice id and your listen model carry over. Each platform configures the rest its own way, so the Settings JSON stays behind.

## Layer by layer

| Layer | In this workshop | In your platform | Carries over? |
|---|---|---|---|
| Hearing | `agent.listen.provider`: `nova-3`, or `flux-general-en` with `version: v2` | The platform's Deepgram speech-to-text setting | Yes: the same model name. Flux brings its end-of-turn detection with it |
| Timing | The `timing` feature: `agent.think_live`, backchannels, presence checks, `FrustrationDetected` (missions 01 and 02) | The platform's own turn-taking | Only on a phone bridge. `timing` is part of the Voice Agent API |
| Thinking | `agent.think`: your LLM, `PROMPT` and functions; the optional `thinking` feature (mission 03) | The platform's LLM setting | Your prompt, yes. Functions are declared the platform's way. In this workshop the `thinking` feature is set in Settings; on a platform, pick the model in the platform's LLM setting |
| Voice | `agent.speak.provider`: a Flux voice (`flux-cliff-en`, `version: v2`) or an Aura-2 voice (`aura-2-thalia-en`) | The platform's Deepgram text-to-speech setting | Yes: the voice id. Vapi splits it into a model and a short name (below) |

In the Voice Agent API, Flux voices speak English, so mission 04 uses an Aura-2 voice for each other language. Through `/v2/speak` and in Pipecat, Flux TTS speaks many other languages too: [Flux TTS voices](https://developers.deepgram.com/docs/flux-tts/voices) lists them.

## Twilio: your Settings on a phone line

- **Where Deepgram is selected:** your own server. Twilio streams the call audio over a WebSocket (TwiML `<Connect><Stream>`), your server relays it to the Voice Agent API, and relays the agent's audio back to Twilio as `media` frames.
- **What carries over:** all of it. Take `build_settings()` / `buildSettings()` from any mission and change only the audio block, so it matches the phone line:

  ```json
  "audio": {
    "input":  { "encoding": "mulaw", "sample_rate": 8000 },
    "output": { "encoding": "mulaw", "sample_rate": 8000, "container": "none" }
  }
  ```

  The agent's audio then goes into Twilio `media` frames (base64) with no transcoding. `timing`, functions and your `on_event` handling work as they do in the missions, on a Deepgram project that has the features you use.
- **One addition:** when the caller talks over the agent, the Voice Agent API sends `UserStartedSpeaking`. Answer it by sending Twilio a `clear` event, so the audio Twilio has buffered stops playing.
- **Docs:** [Twilio and Deepgram Voice Agent](https://developers.deepgram.com/docs/twilio-and-deepgram-voice-agent) (Deepgram), with its companion repo [deepgram-devs/twilio-voice-agent](https://github.com/deepgram-devs/twilio-voice-agent), and Twilio [Media Streams](https://www.twilio.com/docs/voice/media-streams).

## Telnyx: two ways in

**Media streaming to the Voice Agent API.** The same bridge as Twilio, on a Telnyx call.

- **Where Deepgram is selected:** your own server, as with Twilio. Start the stream with `stream_url` (your WebSocket) on the Call Control dial or `answer` command, and set `stream_bidirectional_mode` to `rtp` so your server can send audio back into the call.
- **What carries over:** all of it. PCMU at 8000 Hz is the default codec on the stream, so your Settings use the same mulaw 8000 Hz audio block as the Twilio section. Telnyx delivers audio in `media` frames (base64 in `media.payload`) and takes a `clear` event to stop buffered audio.
- **Docs:** Telnyx [Media streaming](https://developers.telnyx.com/docs/voice/programmable-voice/media-streaming).

**Telnyx AI Assistants.** Telnyx runs the conversation; Deepgram does the hearing.

- **Where Deepgram is selected:** `transcription.model` set to `deepgram/flux` (or `deepgram/nova-3`). Flux's end-of-turn settings are under `transcription.settings`: `eot_threshold`, `eot_timeout_ms` and `eager_eot_threshold`.
- **What carries over:** your prompt, and Flux for hearing.
- **Docs:** Telnyx [Transcription settings](https://developers.telnyx.com/docs/inference/ai-assistants/transcription-settings).

## LiveKit: Deepgram in a LiveKit agent

- **Where Deepgram is selected:** the `stt` and `tts` arguments of `AgentSession`, with the Deepgram plugin (`uv add "livekit-agents[deepgram]~=1.8"`, then `from livekit.plugins import deepgram`) and your own `DEEPGRAM_API_KEY`.
  - Hearing: `deepgram.STTv2(model="flux-general-en")` for Flux, with `turn_detection` set to `"stt"` in the session's `turn_handling`, so Flux decides when your turn ends. `deepgram.STT(model="nova-3")` for Nova-3.
  - Voice: `deepgram.TTSv2(model="flux-cliff-en")` for a Flux voice, `deepgram.TTS(model="aura-2-thalia-en")` for an Aura-2 voice.
- **What carries over:** `PROMPT` goes into your agent's `instructions`; the voice id and the listen model go in as they are.
- **Docs:** [LiveKit and Deepgram](https://developers.deepgram.com/docs/livekit-integration) (Deepgram), and LiveKit's [Deepgram STT](https://docs.livekit.io/agents/models/stt/deepgram/) and [Deepgram TTS](https://docs.livekit.io/agents/models/tts/deepgram/) pages. Starter: [agent-starter-python](https://github.com/livekit-examples/agent-starter-python).

## Pipecat: Deepgram in the pipeline

- **Where Deepgram is selected:** the speech-to-text and text-to-speech services in your pipeline.
  - Hearing: `DeepgramFluxSTTService` (`pipecat.services.deepgram.flux.stt`), whose model defaults to `flux-general-en`; its `Settings` take `eot_threshold`, `eot_timeout_ms` and `eager_eot_threshold`. `DeepgramSTTService` (`pipecat.services.deepgram.stt`) for Nova.
  - Voice: `DeepgramFluxTTSService` (`pipecat.services.deepgram.flux.tts`) with `settings=DeepgramFluxTTSService.Settings(voice="flux-cliff-en")`, or `DeepgramTTSService` with an Aura-2 voice.
- **What carries over:** `PROMPT` goes into your LLM service's `system_instruction`; the voice id and the listen model go in as they are.
- **Docs:** [Pipecat and Deepgram](https://developers.deepgram.com/docs/pipecat-integration) (Deepgram), and Pipecat's [Deepgram STT](https://docs.pipecat.ai/api-reference/server/services/stt/deepgram) and [Deepgram TTS](https://docs.pipecat.ai/api-reference/server/services/tts/deepgram) pages. Starter: [pipecat-quickstart](https://github.com/pipecat-ai/pipecat-quickstart).

## Vapi: Deepgram in an assistant

- **Where Deepgram is selected:** two blocks of the assistant.
  - Hearing: `transcriber.provider` set to `deepgram` and `transcriber.model` to `flux-general-en` (or `flux-general-multi`, with language hints in `transcriber.languages`, as in mission 04). Flux's end-of-turn settings are `eotThreshold` and `eotTimeoutMs`.
  - Voice: `voice.provider` set to `deepgram`. Vapi names a voice by model and short name: for `flux-cliff-en`, set `voice.model` to `flux` and `voice.voiceId` to `cliff`; for `aura-2-thalia-en`, `aura-2` and `thalia`.
- **What carries over:** `PROMPT` becomes the system message in `model.messages`, and `GREETING` becomes `firstMessage`. Mostly configuration: no code unless you use Vapi's server SDK.
- **Docs:** Vapi's [Deepgram transcriber](https://docs.vapi.ai/providers/transcriber/deepgram) and [Deepgram voice](https://docs.vapi.ai/providers/voice/deepgram) pages, and the `DeepgramTranscriber` and `DeepgramVoice` fields in [Create Assistant](https://docs.vapi.ai/api-reference/assistants/create). Starter: [Vapi phone quickstart](https://docs.vapi.ai/quickstart/phone).

## Your coding agent

For everything Deepgram, start from the docs index at https://developers.deepgram.com/llms.txt, and give your coding agent the docs MCP server, https://developers.deepgram.com/_mcp/server.
