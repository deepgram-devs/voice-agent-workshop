#!/usr/bin/env bash
# Prints a note when a DEEPGRAM_API_KEY Codespaces secret is set: missions run on that key
# until you paste a workshop token into .env, and then the token is used instead. Reads
# whether the variable is set, never its value. post-create.sh runs it; it never fails the setup.
# post-create.sh prints the language line after this note, as its last line.

if [ -n "${DEEPGRAM_API_KEY:-}" ]; then
  echo "Your DEEPGRAM_API_KEY Codespaces secret is set, so missions run on your own key."
  echo "Paste the two workshop token lines from the workshop's /code page into .env to run on"
  echo "the token instead: with WORKSHOP_URL and WORKSHOP_TOKEN set, the token is used."
  echo "Then pick your language with the line below, and run make check 00."
else
  echo "Put DEEPGRAM_API_KEY in .env (or add it as a Codespaces secret), or paste the two"
  echo "workshop token lines from the workshop's /code page into .env."
  echo "Then pick your language with the line below, and run make check 00."
fi
