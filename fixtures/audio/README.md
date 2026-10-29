# Recorded callers

Short clips the live checks can play instead of typed turns, so the agent hears a voice the way it would from a microphone. Turn them on with `LIVE_AUDIO=1`:

```sh
make live 02 LIVE_AUDIO=1
make live 04 LIVE_AUDIO=1
```

| File | Mission | What it says |
|---|---|---|
| `02-annoyed-1.wav` | 02 | "Ugh. Where do I pick up my badge? I have been walking around for twenty minutes." |
| `02-annoyed-2.wav` | 02 | "No! I was just there, and they sent me back here. This is ridiculous." |
| `02-annoyed-3.wav` | 02 | "Seriously? Listen to me. I have asked three times now. This is so frustrating!" |
| `04-spanish.wav` | 04 | "Hola. ¿Me puede ayudar con el horario de mañana, por favor?" |
| `04-english.wav` | 04 | "Sorry, English is easier for me. When does Thursday start?" |

All are mono 16-bit PCM at 16 kHz, the `audio.input` the missions send. They are synthetic voices made with the macOS `say` command, so they sound flat: the words are annoyed, the tone isn't. To remake one:

```sh
say -v Samantha -r 215 -o 02-annoyed-2.wav --file-format=WAVE --data-format=LEI16@16000 "No! I was just there, and they sent me back here. This is ridiculous."
```

Spanish uses the `Paulina` voice, English uses `Samantha`. A live script plays a clip with `{ "after": "...", "send_audio": "fixtures/audio/<file>.wav" }` (see CONTRIBUTING.md).
