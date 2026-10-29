# syntax=docker/dockerfile:1
# Optional: the workshop's tools in one container, for running the missions in Docker without
# VS Code or Codespaces. compose.yaml next to this file uses it; docs/<language>.md "Run it in Docker" has
# the commands. Node.js 22 (the check harness, TypeScript), uv with Python 3.12, pnpm and make,
# on Debian 12 (bookworm), as root with no sudo. JDK=17 (compose's workshop-java service) adds
# openjdk-17-jdk-headless from Debian's packages; the plain workshop service leaves it out.
# Nothing from the repo is copied in (.dockerignore sends none of it): compose mounts the repo,
# so your edits, .env and out/last-call.wav stay on your machine.
FROM node:22-bookworm

COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /uvx /usr/local/bin/

# The Python environment lives outside the mounted repo, so a container's Linux packages never
# land in python/.venv on your machine (compose keeps it in a volume); the pnpm store stays in
# the home volume, not in the repo.
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    npm_config_store_dir=/root/.local/share/pnpm/store

RUN uv python install 3.12 && npm install -g pnpm@10 && pnpm --version && uv --version

# Debian 12 ships openjdk-17 (no 21); JDK=17 installs it, empty leaves the image JDK-free. Last,
# so the plain image is the layers above plus one empty one and workshop-java shares them all.
ARG JDK=
RUN if [ -n "$JDK" ]; then apt-get update && apt-get install -y --no-install-recommends "openjdk-$JDK-jdk-headless" && rm -rf /var/lib/apt/lists/*; fi

WORKDIR /workspace
CMD ["bash"]
