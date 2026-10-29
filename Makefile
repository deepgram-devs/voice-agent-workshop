# Voice agent workshop. Run `make help`: it prints every comment line below, to the first blank line.
#
#   make setup              install the check harness and the languages you have tools for (SDK=py, SDK=ts or SDK=java: that one language); creates .env
#   make use py             pick your language once: py (Python), ts (TypeScript) or java (Java)
#   make check 00           offline check of your start file: no key, no network
#   make run 00             talk to your mission 00 agent: type lines, Ctrl-D (or Ctrl-C) hangs up. Needs DEEPGRAM_API_KEY or a workshop token in .env (MIC=1 for your mic, Python)
#   make live 00            live check against the real API with your DEEPGRAM_API_KEY or your workshop token
#
# make use saves your language in .workshop-lang; check, run and live use it and
# name the start file they work on. Add SDK=py, SDK=ts or SDK=java to run one command in that language.
# MISSION_TARGET=solution checks the reference answer instead of your start file.
# In Docker, put "docker compose run --rm workshop" in front of each command (workshop-java for Java).

# --- Native Windows ---
# OS=Windows_NT is set in cmd, PowerShell and Git Bash, and never inside WSL, a
# container or Codespaces. There every goal, bare `make` included, prints one line
# and stops, before any $(shell) call, so make with cmd.exe as its shell prints
# nothing else. MSG_WINDOWS is echoed bare (cmd.exe prints quotes): no quotes,
# apostrophes or $ in it. ALLOW_WINDOWS=1 runs the Makefile anyway, for testers.
ifneq ($(and $(filter Windows_NT,$(OS)),$(if $(ALLOW_WINDOWS),,x)),)
MSG_WINDOWS := On Windows, this project runs in GitHub Codespaces or in WSL: see the On Windows section of README.md.
.DEFAULT_GOAL := windows
.PHONY: windows $(MAKECMDGOALS)
windows $(MAKECMDGOALS):
	@echo $(MSG_WINDOWS)
	@exit 2
else

export MISSION_TARGET
# Set by compose.yaml in the workshop container: the hint after a pass gives the docker
# compose form of the next command, MIC=1 stops before anything installs (no microphone
# there), and Java's lines say the image has no JDK. WORKSHOP_DOCKER_SERVICE names the
# service the printed docker compose forms use (workshop, or workshop-java).
IN_DOCKER := $(WORKSHOP_IN_DOCKER)
DOCKER_SERVICE := $(or $(WORKSHOP_DOCKER_SERVICE),workshop)
DOCKER_PREFIX = $(if $(IN_DOCKER),docker compose run --rm $(DOCKER_SERVICE) ,)
MISSION ?= $(word 2,$(MAKECMDGOALS))
MDIR := $(notdir $(firstword $(wildcard missions/$(MISSION)-*) $(wildcard missions/$(MISSION))))
CHECKED := $(notdir $(patsubst %/check.mjs,%,$(wildcard missions/*/check.mjs)))
TARGET = $(or $(MISSION_TARGET),start)
TYPECHECK ?= 1

# --- Languages ---
# One block per language. A new language adds a block, its id in LANGS and a
# setup-<id> target; it goes in AUTO_LANGS only if make may set it up and run it
# without being asked for it by name (`make use <id>` or SDK=<id>), and in
# LISTED_LANGS once attendees should see it: the lines that list every language
# (the pick line, make use's, SDK's) name only those. A language that has only
# some missions so far sets MISSIONS_<id> to them; the others stop with one line
# and the CI loops skip them. Outside these blocks, a language is named only by the
# setup-<id> targets, typecheck (the whole TypeScript project) and the help text at
# the top of this file. tools/make/make.test.mjs reads LANGS, AUTO_LANGS,
# LISTED_LANGS and NAME_<id> from here, so its tests follow a new block.
# READY_<id>: whether make setup has installed the language's packages here; `:` when the
# tool installs on demand. need-sdk stops with MSG_NOT_SETUP otherwise.
# HARNESS_READY: the check harness (tools/replay-server) counts as installed when its one
# dependency is there. An empty node_modules is not an install: it is the mount point compose
# leaves after `down -v` (compose.yaml's harness_modules volume), and the testing helpers'
# own "node_modules exists" check passes on it, so this probe runs first and says so.
HARNESS_READY := test -f tools/replay-server/node_modules/ws/package.json
LANGS        := py ts java
AUTO_LANGS   := py ts
LISTED_LANGS := py ts java

NAME_py    := Python
ALIASES_py := py python Python
DETECT_py  := command -v uv
READY_py   := :
TOOL_py    := uv
HOW_py     := https://docs.astral.sh/uv/
MIC_py     := yes
FILE_py     = python/missions/$(MDIR)/$(TARGET).py
# A file Python can't parse gets one line (agent/syntax.py) before pytest or the program
# would print a traceback; AGAIN is the command that line says to run again. A file that
# parses but fails at import (SURPRISE_ME = true, say) gets the same line from pytest's
# collection (agent/testing.py cant_load), which reads the command from WORKSHOP_AGAIN.
SYNTAX_py   = uv run python -m agent.syntax missions/$(MDIR)/$(TARGET).py "$(AGAIN)"
CHECK_py    = cd python && $(SYNTAX_py) && WORKSHOP_AGAIN="$(AGAIN)" uv run pytest -q missions/$(MDIR)
LIVE_py     = cd python && $(SYNTAX_py) && WORKSHOP_AGAIN="$(AGAIN)" uv run pytest -q -m live missions/$(MDIR)
RUN_py      = cd python && $(SYNTAX_py) && uv run $(if $(MIC),--extra mic) python missions/$(MDIR)/$(TARGET).py $(if $(MIC),--mic)
UNIT_py     = cd python && uv run pytest -q agent
UNITDIR_py := python/agent

NAME_ts    := TypeScript
ALIASES_ts := ts typescript TypeScript
DETECT_ts  := command -v pnpm
READY_ts   := test -x typescript/node_modules/.bin/vitest
TOOL_ts    := pnpm
HOW_ts     := npm install -g pnpm@10
FILE_ts     = typescript/missions/$(MDIR)/$(TARGET).ts
CHECK_ts    = cd typescript && pnpm -s vitest run missions/$(MDIR)
LIVE_ts     = cd typescript && LIVE=1 pnpm -s vitest run missions/$(MDIR) -t live
RUN_ts      = cd typescript && pnpm -s tsx missions/$(MDIR)/$(TARGET).ts
UNIT_ts     = cd typescript && pnpm -s vitest run src
UNITDIR_ts := typescript/src
# Java is opt-in: listed, but never set up, run or probed unless picked (`make use java` or
# SDK=java), so never in SDK=all or a repo gate without SDK=java. macOS ships a /usr/bin/java
# that offers to install a JDK, so on macOS it runs only when java_home finds a JDK 17+ or
# `java` is another one on the PATH. java/mission.sh checks for javac and the version.
# MISSIONS_java: every mission with a java/missions/mNN_name/Start.java (all of them;
# MissionsLayoutTest fails on a missing one).
# In Codespaces and the dev container (Debian 13: openjdk-21, no 17) a JDK comes from apt.
# CODESPACES is GitHub's; .devcontainer/devcontainer.json sets DEVCONTAINER. java/mission.sh
# and java/pom.xml give the same line (make.test.mjs test j holds the three together).
NAME_java    := Java
ALIASES_java := java Java
DETECT_java   = { if [ "$$(uname)" = Darwin ]; then /usr/libexec/java_home -v 17+ || [ "$$(command -v java)" != /usr/bin/java ]; fi && java -version; }
READY_java   := :
TOOL_java    := a JDK 17 or newer
JDK_APT      := sudo apt-get update && sudo apt-get install -y openjdk-21-jdk-headless
HOW_java      = $(if $(or $(CODESPACES),$(DEVCONTAINER)),$(JDK_APT),https://adoptium.net)
JPKG          = m$(subst -,_,$(MDIR))
FILE_java     = java/missions/$(JPKG)/$(if $(filter solution,$(TARGET)),Solution,Start).java
# WORKSHOP_HINT_SDK: the SDK= the compile-error line adds to its "run again" command,
# only when SDK= mattered for this command (HINT_SDK); empty when Java is the saved language.
CHECK_java    = cd java && WORKSHOP_HINT_SDK="$(HINT_SDK)" sh mission.sh check $(MDIR)
LIVE_java     = cd java && WORKSHOP_HINT_SDK="$(HINT_SDK)" sh mission.sh live $(MDIR)
RUN_java      = cd java && WORKSHOP_HINT_SDK="$(HINT_SDK)" sh mission.sh run $(MDIR)
UNIT_java     = cd java && sh mission.sh unit
UNITDIR_java := java/src
MISSIONS_java = $(foreach d,$(CHECKED),$(if $(wildcard java/missions/m$(subst -,_,$(d))/Start.java),$(d)))

# After the TypeScript check, tsc typechecks your file, which names a field the SDK
# doesn't have; `make ci` typechecks the whole project once instead (TYPECHECK=0).
# One line before tsc's says what kind of error it is and what to do: a syntax error is a
# four-digit TS1xxx code (TS1002, TS1005, TS1160: the file doesn't parse); every other code
# (TS2xxx, and five-digit ones such as TS18046) is a type error: fix the value, with no cast.
TSFILE = missions/$(MDIR)/$(TARGET).ts
MSG_TS_TYPE  = Your file has a TypeScript type error (line and column below). Fix the value's type; a cast is not the fix, unless the mission's brief shows one.
MSG_TS_PARSE = Your file has a TypeScript syntax error (line and column below). Fix it, then run $(AGAIN) again.
# tsc reads the whole project (tsconfig: src, missions, examples) and reports no type error
# while any file has a syntax error, so an empty list for your file is a pass only when no
# other file has a TS1xxx line; otherwise one FAIL line per broken file. For a mission's
# start file the line names the make check that shows the line and column.
MSG_TS_OTHER = FAIL  TypeScript (tsc): typescript/$$f has a syntax error, and tsc checks no file while any file has one. Fix that file first$$hint, then run $(AGAIN) again.
POSTCHECK_ts = all=$$(cd typescript && pnpm -s tsc --noEmit -p . 2>&1); \
  errs=$$(printf '%s\n' "$$all" | awk -v f="$(TSFILE)(" 'index($$0, f) == 1 { on = 1; print; next } /^[^ ]/ { on = 0 } on { print }'); \
  if [ -n "$$errs" ]; then echo; echo "FAIL  TypeScript (tsc) found type errors in typescript/$(TSFILE):"; \
    if printf '%s\n' "$$errs" | grep -qE 'error TS1[0-9]{3}:'; then echo "$(MSG_TS_PARSE)"; else echo "$(MSG_TS_TYPE)"; fi; \
    printf '%s\n' "$$errs" | head -20; status=1; \
  else broken=$$(printf '%s\n' "$$all" | grep -E '^[^ (]+\([0-9]+,[0-9]+\): error TS1[0-9]{3}:' | sed -E 's/\(.*//' | sort -u); \
    if [ -n "$$broken" ]; then echo; for f in $$broken; do \
      case "$$f" in missions/*/start.ts) n=$${f\#missions/}; hint=" ($(DOCKER_PREFIX)make check $${n%%-*}$(if $(HINT_SDK), $(HINT_SDK)) names the line)";; *) hint="";; esac; \
      echo "$(MSG_TS_OTHER)"; done; status=1; \
    else echo "PASS  TypeScript (tsc): typescript/$(TSFILE) typechecks"; fi; fi

# --- Which language a command uses ---
# The first of these that applies:
#   1. SDK on the command line or in the environment (py, ts, "py ts", or all:
#      every AUTO_LANGS language whose tool is installed). CI sets it.
#   2. A repo gate (REPO_GOALS): every AUTO_LANGS language whose tool is installed,
#      whatever .workshop-lang says, so a saved choice never narrows `make ci`.
#   3. The language saved in .workshop-lang by `make use`.
#   4. None: need-sdk stops with the pick line. A tool on the PATH is not a choice.
# Every stop happens in need-sdk's recipe, never while make reads this file, so
# `make help` and `make use` work whatever the state.
empty :=
space := $(empty) $(empty)
canon = $(strip $(foreach l,$(LANGS),$(if $(filter $(ALIASES_$(l)),$(1)),$(l))))
have  = $(if $(shell $(DETECT_$(1)) >/dev/null 2>&1 && echo y),$(1))
what  = $(if $(filter solution,$(MISSION_TARGET)),the $(NAME_$(1)) reference answer,your $(NAME_$(1)) file)
need  = $(TOOL_$(1)) ($(HOW_$(1)))
INSTALLED := $(strip $(foreach l,$(AUTO_LANGS),$(call have,$(l))))

# The missions a language has: MISSIONS_<id> when its block sets it, else every
# mission with checks. `has` is the language when it has this command's mission.
# has_mission goes first in a recipe's `for l`/`for m` loop body: it skips (continue)
# a mission language $$l doesn't have yet.
missions_of   = $(if $(filter undefined,$(origin MISSIONS_$(1))),$(CHECKED),$(MISSIONS_$(1)))
has           = $(if $(filter $(MDIR),$(call missions_of,$(1))),$(1))
LANG_MISSIONS = $(foreach l,$(SEL),$(addprefix $(l):,$(call missions_of,$(l))))
has_mission   = case " $(LANG_MISSIONS) " in *" $$l:$$m "*) ;; *) continue;; esac;

# The first non-blank line of .workshop-lang, with CRs and anything but letters,
# digits, _ . - and spaces dropped; one word that names a language is a choice.
LANG_FILE  := .workshop-lang
SAVED_THERE := $(wildcard $(LANG_FILE))
SAVED_SHOW := $(if $(SAVED_THERE),$(strip $(shell LC_ALL=C tr -d '\r' < $(LANG_FILE) 2>/dev/null | grep -v '^[[:space:]]*$$' | head -n 1 | LC_ALL=C tr -cd 'A-Za-z0-9_. \t-' | cut -c1-20)))
SAVED      := $(if $(filter 1,$(words $(SAVED_SHOW))),$(call canon,$(SAVED_SHOW)))

SDK_GIVEN := $(strip $(if $(filter command line environment%,$(origin SDK)),$(SDK)))
SDK_BAD   := $(strip $(foreach w,$(filter-out all,$(SDK_GIVEN)),$(if $(call canon,$(w)),,$(w))))
safe      = $(subst ",,$(subst `,,$(subst \,,$(subst $$,,$(1)))))
SDK_SAFE   = $(call safe,$(SDK_GIVEN))
SDK_SHOW   = $(call safe,$(SDK_BAD))
SDK_ALL   := $(if $(filter all,$(SDK_GIVEN)),$(INSTALLED))
REPO_GOALS := ci ci-solutions ci-starts typecheck unit

ifneq ($(SDK_GIVEN),)
  SEL  := $(strip $(SDK_ALL) $(filter-out $(SDK_ALL),$(call canon,$(filter-out all,$(SDK_GIVEN)))))
  FROM := sdk
else ifneq ($(filter $(REPO_GOALS),$(MAKECMDGOALS)),)
  SEL  := $(INSTALLED)
  FROM := repo
else ifneq ($(SAVED_THERE),)
  SEL  := $(SAVED)
  FROM := saved
else
  SEL  :=
  FROM := none
endif

# `make use <language>`: the word after `use`.
USE_ARG  := $(if $(filter use,$(firstword $(MAKECMDGOALS))),$(word 2,$(MAKECMDGOALS)))
USE_LANG := $(call canon,$(USE_ARG))
USE_SHOW  = $(call safe,$(USE_ARG))
# The next command a pass suggests names SDK= only when it matters: more than
# one language checked, or SDK picked a language other than the saved one.
HINT_SDK = $(if $(or $(word 2,$(SEL)),$(and $(filter sdk,$(FROM)),$(filter-out $(SAVED),$(SEL)))),SDK=$(firstword $(SEL)))
# The command a "fix it, then run ... again" line names: this goal and mission, SDK= when it
# mattered, and in Docker the docker compose prefix every other printed command carries.
AGAIN    = $(DOCKER_PREFIX)make $(firstword $(MAKECMDGOALS)) $(MNUM)$(if $(HINT_SDK), $(HINT_SDK))
MIC_LANG = $(firstword $(foreach l,$(LANGS),$(if $(MIC_$(l)),$(l))))

# --- What make says (each line in one place) ---
# Shown inside double quotes in the recipes: write a quote as \".
comma := ,
# say_list: "A", "A or B", "A, B or C". $(1) names a function that turns one word into an
# item, $(2) is the words. drop_last is $(2) without its last word (wordlist, 3.81-safe).
drop_last  = $(wordlist 2,$(words $(1)),x $(1))
say_list   = $(call $(1),$(firstword $(2)))$(subst $(space)$(comma),$(comma),$(foreach w,$(wordlist 2,99,$(call drop_last,$(2))),$(comma) $(call $(1),$(w))))$(if $(word 2,$(2)), or $(call $(1),$(lastword $(2))))
as_is      = $(1)
use_item   = make use $(1)
or_list    = $(call say_list,as_is,$(1))
use_list   = $(call say_list,use_item,$(1))
pick_item  = make use $(1) ($(NAME_$(1)))
pick_list  = $(call say_list,pick_item,$(LISTED_LANGS))
tool_item  = $(TOOL_$(1)) ($(NAME_$(1)), $(HOW_$(1)))
PICK_LINE  = Pick your language first: $(pick_list)
# Shown only when no AUTO_LANGS tool is installed. A listed language outside AUTO_LANGS is
# never probed, so its clause says what it takes, never that it's missing. A repo gate
# ignores the saved language, so there the clause names SDK= instead of make use.
EXTRA_LANGS = $(filter-out $(AUTO_LANGS),$(LISTED_LANGS))
extra_use  = For $(NAME_$(1)): with $(call need,$(1)), run make use $(1), then make setup.
REPO_GOAL  = $(patsubst typecheck,ci,$(firstword $(filter $(REPO_GOALS),$(MAKECMDGOALS))))
extra_sdk  = For $(NAME_$(1)): make $(REPO_GOAL) SDK=$(1).
extra_item = $(if $(filter repo,$(FROM)),$(extra_sdk),$(extra_use))
MSG_NONE   = To run a mission, install $(call say_list,tool_item,$(AUTO_LANGS)), then run make setup.$(if $(EXTRA_LANGS), $(strip $(foreach l,$(EXTRA_LANGS),$(call extra_item,$(l)))))
MSG_SAVED  = Saved: $(NAME_$(USE_LANG)). make check, run and live use it now.$(if $(OTHER_USE), Add SDK=$(OTHER_USE) to run one command in $(NAME_$(OTHER_USE)).)
OTHER_USE  = $(firstword $(filter-out $(USE_LANG),$(AUTO_LANGS)))
# Java in the plain compose container (WORKSHOP_IN_DOCKER without a javac): that image has no JDK
# and apt in a --rm container is gone next run, so its lines name the workshop-java service. Once
# .workshop-lang says java (SAVED), the line is this same command on that service: a brief's
# pasteable line names the plain service, and "make use java, then make setup" is the wrong fix then.
MSG_JAVA_DOCKER = The Docker image has no JDK. For Java in Docker, use the workshop-java service (docker compose run --rm workshop-java make use java, then make setup); or VS Code Dev Containers, GitHub Codespaces, or your own machine (README: Java).
MSG_JAVA_SAVED = The Docker image has no JDK, and Java is your language: run this same command with workshop-java in place of workshop (docker compose run --rm workshop-java make $(firstword $(MAKECMDGOALS))$(if $(MISSION), $(MISSION))); or VS Code Dev Containers, GitHub Codespaces, or your own machine (README: Java).
MSG_JAVA_LINE = $(if $(filter java,$(SAVED)),$(MSG_JAVA_SAVED),$(MSG_JAVA_DOCKER))
MSG_NEEDS  = $(if $(and $(IN_DOCKER),$(filter java,$(1))),$(MSG_JAVA_LINE),$(NAME_$(1)) needs $(call need,$(1)), which isn't installed. Install it, then run make setup.)
MSG_NOT_SETUP = $(NAME_$(1)) isn't set up in this folder yet (make setup never installed it). Run $(DOCKER_PREFIX)make setup SDK=$(1) once, then this command again.
MSG_NO_HARNESS = The check harness isn't installed. Run $(DOCKER_PREFIX)make setup once, then this command again.
MSG_STATUS = Your language: $(NAME_$(SAVED)) (saved in $(LANG_FILE)). To switch: $(call use_list,$(filter-out $(SAVED),$(LISTED_LANGS)))
MSG_USE_BAD = make use takes $(call or_list,$(LISTED_LANGS)) (you typed $(USE_SHOW)).
MSG_FILE_BAD = $(LANG_FILE) says \"$(SAVED_SHOW)\", which isn't a language here. Pick again: $(pick_list)
MSG_FILE_EMPTY = $(LANG_FILE) is empty. Pick again: $(pick_list)
MSG_SDK_ENV = SDK=$(SDK_SAFE) in your environment overrides your saved language. Unset SDK to use the saved one.
MSG_SDK_CMD = SDK=$(SDK_SAFE) applies only to the command it's on and leaves your saved language as it is.
MSG_BAD_SDK_ENV = SDK in your environment is \"$(SDK_SHOW)\", which isn't a language here: use $(call or_list,$(addprefix SDK=,$(LISTED_LANGS))), or unset it.
MSG_BAD_SDK_CMD = SDK on the command line is \"$(SDK_SHOW)\", which isn't a language here: use $(call or_list,$(addprefix SDK=,$(LISTED_LANGS))).
run_item   = make run $(MISSION) SDK=$(1)
MSG_RUN_ONE = make run runs one language at a time: $(call say_list,run_item,$(SEL))
MSG_MIC    = MIC=1 runs in $(NAME_$(MIC_LANG)): make run $(MISSION) SDK=$(MIC_LANG) MIC=1 (add MISSION_TARGET=solution to use the reference answer)
MSG_MIC_DOCKER = No microphone in a container. Type your turns: make run $(MISSION) (Docker: docker compose run --rm $(DOCKER_SERVICE) make run $(MISSION))
MSG_SETUP_SDK = To make $(NAME_$(firstword $(SETUP_OPT))) your language: make use $(firstword $(SETUP_OPT))
MSG_SKIP   = $(if $(and $(IN_DOCKER),$(filter java,$(1))),Skipping Java: $(MSG_JAVA_LINE),Skipping $(NAME_$(1)): it needs $(call need,$(1)).)
# The last line of a setup that skipped the saved language: that language's needs line.
MSG_SETUP_SKIPPED = $(call MSG_NEEDS,$(SAVED))
MNUM       = $(firstword $(subst -, ,$(MDIR)))
HAVE_IT    = $(foreach l,$(LISTED_LANGS),$(call has,$(l)))
MSG_NOT_YET = Mission $(MNUM) runs in $(call or_list,$(foreach l,$(HAVE_IT),$(NAME_$(l)))) for now: make $@ $(MNUM) SDK=$(firstword $(HAVE_IT))
MSG_NODE_OLD = The checks need Node.js 20.19+ or 22.12+ (you have $$(node -v 2>/dev/null || echo none)). Install Node.js 22 from https://nodejs.org, then run make setup again.
MSG_ENV_CREATED = Created .env: at the workshop, paste the two WORKSHOP_ lines from the /code page into it; at home, put your DEEPGRAM_API_KEY in it
MSG_ENV_COPY = Couldn't copy .env.example to .env. Restore it with git checkout .env.example, then run make setup again.
MSG_SETUP_FAILED = Setup failed for $$failed (see the output above). Fix it, then run make setup again.
MSG_FILE   = $(if $(SAVED_SHOW),$(MSG_FILE_BAD),$(MSG_FILE_EMPTY))
MSG_BAD_SDK = $(if $(filter command line,$(origin SDK)),$(MSG_BAD_SDK_CMD),$(MSG_BAD_SDK_ENV))
MSG_SDK_OVERRIDES = $(if $(filter command line,$(origin SDK)),$(MSG_SDK_CMD),$(MSG_SDK_ENV))

TARGETS := help setup setup-harness $(addprefix setup-,$(LANGS)) need-good-sdk use run check live typecheck ci ci-solutions ci-starts harness-test names names-test hints-test make-test unit live-all need-mission need-sdk
.PHONY: $(TARGETS)

help:
	@awk 'NR > 2 { if ($$0 !~ /^#/) exit; sub(/^# ?/, ""); print }' Makefile
	@echo "Missions with checks: $(CHECKED)"

# Saves your language in .workshop-lang (git-ignored); with no language, says
# which one is saved. A language whose tool is missing is saved anyway, with the
# install line. Without a language it always exits 0: setup ends with it.
use:
ifneq ($(USE_ARG),)
ifneq ($(USE_LANG),)
	@rm -f $(LANG_FILE) && printf '%s\n' $(USE_LANG) > $(LANG_FILE)
	@echo "$(MSG_SAVED)"
	@$(DETECT_$(USE_LANG)) >/dev/null 2>&1 || echo "$(call MSG_NEEDS,$(USE_LANG))"
	@$(if $(SDK_GIVEN),$(if $(SDK_BAD),echo "$(MSG_BAD_SDK)",echo "$(MSG_SDK_OVERRIDES)"),:)
else
	@echo "$(MSG_USE_BAD)"; exit 2
endif
else
	@$(if $(SAVED_THERE),$(if $(SAVED),echo "$(MSG_STATUS)",echo "$(MSG_FILE)"),$(if $(INSTALLED),echo "$(PICK_LINE)",echo "$(MSG_NONE)"))
	@$(if $(SAVED),$(DETECT_$(SAVED)) >/dev/null 2>&1 || echo "$(call MSG_NEEDS,$(SAVED))",:)
	@$(if $(SDK_GIVEN),$(if $(SDK_BAD),echo "$(MSG_BAD_SDK)",$(if $(SAVED),echo "$(MSG_SDK_OVERRIDES)",:)),:)
endif

# With SDK, setup installs those languages only. Without it, every AUTO_LANGS
# language whose tool you have, whatever .workshop-lang says, so switching later
# needs no second setup, plus a saved language outside AUTO_LANGS (setup only
# widens). It never fails for want of a choice: Codespaces, Docker and the dev
# container run it before anyone picks. A missing tool is skipped with a line; an
# install that fails lets the other languages install, then fails setup. When the
# skipped language is the saved one, setup ends on that (exit 2) after creating .env:
# the README promised a build, so success would mislead.
# USE_HINT=0 leaves off the last line, `make use`'s status.
SETUP_LANGS = $(if $(filter sdk,$(FROM)),$(SEL),$(AUTO_LANGS) $(filter-out $(AUTO_LANGS),$(SAVED)))
# `make setup SDK=java` (a language outside AUTO_LANGS, not the saved one) ends on
# how to pick that language, once it set up; when it was skipped, only Created .env
# (on a first setup) follows the skip line.
# In setup's shell, where $$ok lists the languages that set up (its own variable: its
# case pattern's parenthesis can't sit inside a make function call).
SETUP_LAST  = case " $$ok " in *" $(firstword $(SETUP_OPT)) "*) echo "$(MSG_SETUP_SDK)";; esac
SETUP_OPT   = $(if $(filter sdk,$(FROM)),$(if $(filter $(SAVED),$(SEL)),,$(filter-out $(AUTO_LANGS),$(SEL))))
setup: setup-harness
	@failed=""; ok=""; skipped=""; \
	$(foreach l,$(SETUP_LANGS),if $(DETECT_$(l)) >/dev/null 2>&1; then if $(MAKE) --no-print-directory setup-$(l); then ok="$$ok $(l)"; else failed="$${failed:+$$failed and }$(NAME_$(l))"; fi; else echo "$(call MSG_SKIP,$(l))"; skipped="$$skipped $(l)"; fi;) \
	if [ -n "$$failed" ]; then echo; echo "$(MSG_SETUP_FAILED)"; exit 1; fi; \
	test -f .env || { cp .env.example .env && echo "$(MSG_ENV_CREATED)"; } || { echo "$(MSG_ENV_COPY)"; exit 1; }; \
	case " $$skipped " in *" $(SAVED) "*) [ -z "$(SAVED)" ] || { echo; echo "$(MSG_SETUP_SKIPPED)"; exit 2; };; esac; \
	$(if $(filter 0,$(USE_HINT)),:,$(if $(SETUP_OPT),$(SETUP_LAST),$(MAKE) --no-print-directory use SDK=))

# A bad SDK stops setup before anything installs (a prerequisite of setup-harness,
# so it runs first under make -j too).
need-good-sdk:
	@$(if $(and $(filter sdk,$(FROM)),$(SDK_BAD)),echo "$(MSG_BAD_SDK)"; exit 2,:)

# The check harness's Node.js range, ^20.19.0 || >=22.12.0 (its package.json engines;
# tools/replay-server/lib/node-version.mjs checks the same at every run). npm ci only
# warns outside it, and the checks then fail without saying why: stop first.
NODE_OK = node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)'
setup-harness: need-good-sdk
	@$(NODE_OK) 2>/dev/null || { echo "$(MSG_NODE_OLD)"; exit 2; }
	cd tools/replay-server && npm ci --no-audit --no-fund

setup-py:
	cd python && uv sync

setup-ts:
	cd typescript && pnpm install --frozen-lockfile

setup-java:
	cd java && sh mission.sh setup

need-mission: need-sdk
	@test -n "$(MDIR)" || (echo "Which mission? e.g. make check 00  (have: $(CHECKED))"; exit 2)
	@test -f missions/$(MDIR)/check.mjs || (echo "missions/$(MDIR) has no offline check. Read missions/$(MDIR)/README.md"; exit 2)

need-sdk:
	@case "$(FROM)" in \
	  none) $(if $(INSTALLED),echo "$(PICK_LINE)",echo "$(MSG_NONE)"); exit 2;; \
	  saved) $(if $(SEL),:,echo "$(MSG_FILE)"; exit 2);; \
	  sdk) $(if $(SDK_BAD),echo "$(MSG_BAD_SDK)"; exit 2,:);; \
	esac; \
	$(if $(SEL),:,echo "$(MSG_NONE)"; exit 2); \
	$(foreach l,$(SEL),if ! $(DETECT_$(l)) >/dev/null 2>&1; then echo "$(call MSG_NEEDS,$(l))"; exit 2; fi;) \
	$(HARNESS_READY) || { echo "$(MSG_NO_HARNESS)"; exit 2; }; \
	$(foreach l,$(SEL),if ! $(READY_$(l)) >/dev/null 2>&1; then echo "$(call MSG_NOT_SETUP,$(l))"; exit 2; fi;) :

# One language at a time. MIC=1 talks through your microphone and speakers
# (Python only: `make run 01 SDK=py MIC=1`; in a container it stops before the mic
# extra installs: there is no microphone to talk through).
run: need-mission
	@$(if $(word 2,$(SEL)),echo "$(MSG_RUN_ONE)"; exit 2,:)
	@$(if $(call has,$(SEL)),:,echo "$(call MSG_NOT_YET,$(SEL))"; exit 2)
	@$(if $(and $(MIC),$(IN_DOCKER)),echo "$(MSG_MIC_DOCKER)"; exit 2,:)
	@$(if $(and $(MIC),$(if $(MIC_$(SEL)),,x)),echo "$(MSG_MIC)"; exit 2,:)
	@echo "Running $(call what,$(SEL)): $(FILE_$(SEL))"
	@$(RUN_$(SEL))

# Each language runs even when another fails, so one failure never hides another.
# A language without this mission yet says so and the others still run; then the
# exit is 2, unless a check failed (1). A pass on your start file prints the next
# step (tools/hints/next-step.mjs).
check: need-mission
	@status=0; notyet=""; \
	$(foreach l,$(SEL),$(if $(call has,$(l)),echo "Checking $(call what,$(l)): $(FILE_$(l))"; ($(CHECK_$(l))) || status=1; $(if $(POSTCHECK_$(l)),if [ "$(TYPECHECK)" != "0" ]; then $(POSTCHECK_$(l)); fi;),echo "$(call MSG_NOT_YET,$(l))"; notyet=1;)) \
	if [ $$status -eq 0 ] && [ -n "$$notyet" ]; then status=2; fi; \
	if [ $$status -eq 0 ] && [ "$(MISSION_TARGET)" != "solution" ]; then node tools/hints/next-step.mjs $(MDIR) $(HINT_SDK) $(foreach l,$(SEL),"$(NAME_$(l))=$(FILE_$(l))"); fi; \
	exit $$status

live: need-mission
	@status=0; notyet=""; \
	$(foreach l,$(SEL),$(if $(call has,$(l)),echo "Live check of $(call what,$(l)): $(FILE_$(l))"; ($(LIVE_$(l))) || status=1;,echo "$(call MSG_NOT_YET,$(l))"; notyet=1;)) \
	if [ $$status -eq 0 ] && [ -n "$$notyet" ]; then status=2; fi; \
	exit $$status

# Live check for every mission with checks. LIVE_SKIP lists missions to leave
# out, by number or folder name ("01 02" or "01,02"): use it when your Deepgram
# project doesn't have a feature a mission uses (01 and 02 use `timing`). Each
# mission runs in the chosen languages that have it.
LIVE_SKIP ?=
SKIPPED = $(subst $(comma), ,$(LIVE_SKIP))
live-all: need-sdk
	@failed=""; for m in $(CHECKED); do \
	  n=$${m%%-*}; skip=""; \
	  for x in $(SKIPPED); do if [ "$$x" = "$$n" ] || [ "$$x" = "$$m" ]; then skip=1; fi; done; \
	  if [ -n "$$skip" ]; then echo "missions/$$m: skipped (LIVE_SKIP)"; continue; fi; \
	  langs=""; for l in $(SEL); do $(has_mission) langs="$$langs $$l"; done; \
	  [ -n "$$langs" ] || continue; \
	  $(MAKE) --no-print-directory live MISSION=$$m SDK="$$langs" || failed="$$failed $$m"; \
	done; \
	if [ -n "$$failed" ]; then echo "live checks failed:$$failed"; exit 1; fi

# --- CI: every solution passes, every start file still has work left in it ---

harness-test:
	cd tools/replay-server && REPLAY_EXPECT_MS=1500 npm test --silent

# Name scan over the tracked files. The terms come from FORBIDDEN_TERMS (comma
# separated; CI reads it from a repository secret). Unset, a local run skips the
# scan and a CI run fails, so a missing secret never passes as a clean scan.
names:
	node tools/names/names.mjs

names-test:
	node --test tools/names/names.test.mjs

# The hints a pass and the Codespaces setup print: tools/hints and .devcontainer/key-note.sh.
hints-test:
	node --test tools/hints/hints.test.mjs

# This Makefile's language choice, run against stub uv and pnpm in a temp folder,
# and the line endings a Windows clone gets (eol.test.mjs).
make-test:
	MAKE_BIN="$(MAKE)" node --test tools/make/make.test.mjs tools/make/eol.test.mjs

# Unit tests for the shared helpers (python/agent, typescript/src, java/src).
unit: need-sdk
	@status=0; \
	$(foreach l,$(SEL),echo "Testing the $(NAME_$(l)) helpers: $(UNITDIR_$(l))"; ($(UNIT_$(l))) || status=1;) \
	exit $$status

# Each mission in the chosen languages that have it.
ci-solutions: need-sdk
	@failed=""; for m in $(CHECKED); do \
	  langs=""; for l in $(SEL); do $(has_mission) langs="$$langs $$l"; done; \
	  [ -n "$$langs" ] || continue; \
	  $(MAKE) --no-print-directory check MISSION=$$m MISSION_TARGET=solution TYPECHECK=0 SDK="$$langs" || failed="$$failed $$m"; \
	done; \
	if [ -n "$$failed" ]; then echo "solutions failed:$$failed"; exit 1; fi

# One language at a time, so a start file that fails in one language can't
# hide one that already passes in the other; a mission a language doesn't have
# yet is skipped. A start file has to fail on its TODO checks (a "FAIL  TODO"
# line), and run cleanly while it does: a crash in the program or the harness
# counts as a broken start file.
ci-starts: need-sdk
	@bad=""; for l in $(SEL); do for m in $(CHECKED); do $(has_mission) \
	  out=$$($(MAKE) --no-print-directory check MISSION=$$m SDK=$$l TYPECHECK=0 2>&1); rc=$$?; \
	  if [ $$rc -eq 0 ]; then \
	    echo "missions/$$m ($$l): the start file already passes its check; leave the TODOs undone"; bad="$$bad $$m/$$l"; \
	  elif printf '%s\n' "$$out" | grep -qE 'your program stopped with|harness: '; then \
	    echo "missions/$$m ($$l): the start file or the harness crashed; it should run and fail only on its TODOs:"; \
	    printf '%s\n' "$$out" | grep -E 'your program stopped with|harness: ' | head -5; bad="$$bad $$m/$$l"; \
	  elif ! printf '%s\n' "$$out" | grep -q 'FAIL  TODO'; then \
	    echo "missions/$$m ($$l): the start file fails, but on no TODO check; the last lines:"; \
	    printf '%s\n' "$$out" | tail -15; bad="$$bad $$m/$$l"; \
	  else echo "missions/$$m ($$l): start file fails its TODO checks, as it should"; fi; \
	done; done; \
	if [ -n "$$bad" ]; then echo "start files to fix:$$bad"; exit 1; fi

# The whole TypeScript project typechecks: every start file, solution, helper and example.
typecheck: need-sdk
	@$(if $(filter ts,$(SEL)),cd typescript && pnpm -s tsc --noEmit -p . && echo "TypeScript (tsc): the project typechecks",:)

ci: harness-test names-test hints-test make-test unit typecheck ci-solutions ci-starts

# `make check 00`, `make use ts`: let the second word ride along as a goal that
# does nothing. Only after run, check, live or use, so `make names-test names`
# still runs both, and never for a word that is one of this file's targets
# (`make use setup` stops on make use's line, without a warning about overriding setup).
ifneq ($(filter run check live use,$(firstword $(MAKECMDGOALS))),)
ifneq ($(word 2,$(MAKECMDGOALS)),)
ifeq ($(filter $(word 2,$(MAKECMDGOALS)),$(TARGETS)),)
.PHONY: $(word 2,$(MAKECMDGOALS))
$(word 2,$(MAKECMDGOALS)):
	@:
endif
endif
endif

endif # native Windows
