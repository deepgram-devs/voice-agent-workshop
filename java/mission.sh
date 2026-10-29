#!/bin/sh
# The Java track's runner. The Makefile calls it from java/; you can too.
#
#   sh mission.sh setup                 build the helpers and fetch the SDK (Maven, once)
#   sh mission.sh check 00-first-words  offline check of your Start.java (make check adds its header and the Next: line)
#                                       (MISSION_TARGET=solution: Solution.java)
#   sh mission.sh live  00-first-words  live check, on your key
#   sh mission.sh run   00-first-words  talk to your agent
#   sh mission.sh unit                  the helpers' unit tests (Maven; expects the untouched Start.java files: one test asserts mission 00's start file still fails its check)
#   sh mission.sh example [file.wav]    the no-helpers example
#
# Maven runs only for setup and unit. check, live and run compile your one file with
# javac and run it, so one broken mission never breaks another. Everything built goes
# to JAVA_TARGET (default java/target). JAVA_SDK_VERSION builds against another
# deepgram-java-sdk release.
set -eu

cd "$(dirname "$0")"
T=${JAVA_TARGET:-target}
case "$T" in /*) ;; *) T="$(pwd)/$T" ;; esac
SDK_VERSION=${JAVA_SDK_VERSION:-}
STAMP="$T/helpers.stamp"
JFLAGS="-XX:TieredStopAtLevel=1 -XX:+UseSerialGC"
# Whether you type your turns: Java can only ask System.console(), which on JDK 17 to 21
# is null when stdout is a pipe (make run 00 | tee log). The shell knows from stdin.
if [ -t 0 ]; then JFLAGS="$JFLAGS -Dworkshop.stdin=tty"; else JFLAGS="$JFLAGS -Dworkshop.stdin=piped"; fi

say() { printf '%s\n' "$*"; }

# Where a JDK comes from, as the Makefile's HOW_java says: in Codespaces and the dev
# container (Debian 13: openjdk-21, no 17) apt; elsewhere adoptium.net.
if [ -n "${CODESPACES:-}${DEVCONTAINER:-}" ]; then
  HOW_JDK="sudo apt-get update && sudo apt-get install -y openjdk-21-jdk-headless"
else
  HOW_JDK=https://adoptium.net
fi

no_javac() {
  say "Java needs a JDK 17 or newer ($HOW_JDK), and the javac here doesn't run. Install a JDK, then run make setup."
  exit 2
}

# A JDK 17 or newer, with javac (a JRE has none). In the plain compose container (WORKSHOP_IN_DOCKER,
# compose.yaml's workshop service) the image has no JDK: name the workshop-java service, as the
# Makefile's MSG_JAVA_DOCKER does.
need_jdk() {
  if ! command -v javac >/dev/null 2>&1; then
    if [ -n "${WORKSHOP_IN_DOCKER:-}" ]; then
      say "The Docker image has no JDK. For Java in Docker, use the workshop-java service (docker compose run --rm workshop-java make use java, then make setup); or VS Code Dev Containers, GitHub Codespaces, or your own machine (README: Java)."
      exit 2
    fi
    runtime=""
    command -v java >/dev/null 2>&1 && runtime=" The Java here is a runtime only."
    say "No javac on the PATH.$runtime Java needs a JDK 17 or newer ($HOW_JDK), which includes javac. Install a JDK, then run make setup."
    exit 2
  fi
  # macOS's /usr/bin/javac only offers to install a JDK: don't run it unless java_home finds
  # one (of any version: an older one gets the version line below).
  if [ "$(uname)" = Darwin ] && [ "$(command -v javac)" = /usr/bin/javac ] && ! /usr/libexec/java_home >/dev/null 2>&1; then
    no_javac
  fi
  v=$(javac -version 2>&1 | sed -n 's/^javac \([0-9][0-9]*\)\.\{0,1\}\([0-9]*\).*/\1 \2/p' | head -n 1)
  major=${v%% *}
  [ "$major" = 1 ] && major=${v#* }
  if [ -z "$major" ]; then
    no_javac
  fi
  if [ "$major" -lt 17 ]; then
    say "Java needs a JDK 17 or newer ($HOW_JDK); you have $(javac -version 2>&1 | grep '^javac ' | head -n 1). Install a newer JDK, then run make setup."
    exit 2
  fi
}

mvn() {
  sh ./mvnw -q -B "-Djava.target=$T" ${SDK_VERSION:+"-Dsdk.version=$SDK_VERSION"} "$@"
}

# The helpers are built when src/main/java, pom.xml or the SDK version changed since the
# last build, or when a jar classpath.txt names is gone. target/ sits in the mounted repo and
# outlives the home volume (~/.m2): after `docker compose down -v`, a cleared ~/.m2 or a clone
# moved to another machine, classpath.txt and the stamp alone would say "built", and every
# javac then fails on an import. Paths are split on ':' only (a home folder may hold a space).
jars_missing() {
  [ -f "$T/classpath.txt" ] || return 0
  cp_list=$(cat "$T/classpath.txt")
  old_ifs=$IFS
  IFS=:
  for j in $cp_list; do
    [ -f "$j" ] || { IFS=$old_ifs; return 0; }
  done
  IFS=$old_ifs
  return 1
}

stale() {
  [ -f "$T/classpath.txt" ] && [ -f "$STAMP" ] || return 0
  [ "$(cat "$STAMP")" = "sdk=${SDK_VERSION:-pinned}" ] || return 0
  jars_missing && return 0
  [ -n "$(find pom.xml src/main/java -newer "$STAMP" -print 2>/dev/null | head -n 1)" ]
}

build() {
  need_jdk
  if [ -f "$T/classpath.txt" ] && ! jars_missing; then
    say "[setup] Building the Java helpers again (they changed)."
  else
    say "[setup] Building the Java helpers and fetching the SDK: about a minute, the first time."
  fi
  if ! mvn compile; then
    say "Building the Java helpers failed (see the output above). Fix it, then run make setup again."
    exit 1
  fi
  printf 'sdk=%s\n' "${SDK_VERSION:-pinned}" > "$STAMP"
}

# @argfile with the classpath: the helpers, the SDK and its libraries, and $1.
argfile() {
  printf -- '-cp\n"%s:%s:%s"\n' "$T/classes" "$(cat "$T/classpath.txt")" "$1" > "$1.args"
}

# Compiles one mission file into its own folder; on an error, one line after javac's.
compile() { # <NN-name> <Start|Solution>
  pkg="m$(printf '%s' "$1" | tr '-' '_')"
  src="missions/$pkg/$2.java"
  [ -f "$src" ] || { say "No $src here. Check the mission name (for example 00-first-words), then run this again."; exit 2; }
  out="$T/missions/$pkg-$2"
  rm -rf "$out" && mkdir -p "$out"
  argfile "$out"
  # javac names the file as given (missions/...); the lines show it from the project root, as
  # every other line does. WORKSHOP_HINT_SDK (the Makefile's HINT_SDK) is the SDK= the "run
  # again" command needs: unset (run by hand) it is SDK=java, empty when Java is the saved language.
  # In Docker (WORKSHOP_IN_DOCKER, set by compose.yaml) that command carries the docker compose
  # prefix every other printed command has, with the service WORKSHOP_DOCKER_SERVICE names.
  if ! javac -nowarn -Xlint:none -encoding UTF-8 --release 17 -d "$out" "@$out.args" "$src" >"$out.log" 2>&1; then
    sed 's#^missions/#java/missions/#' "$out.log"
    first=$(sed -n 's#^\(missions/[^:]*:[0-9]*\): error:.*#java/\1#p' "$out.log" | head -n 1)
    sdk_hint=${WORKSHOP_HINT_SDK-SDK=java}
    say "Your Java file doesn't compile: fix the first error above${first:+ ($first)}, then run ${WORKSHOP_IN_DOCKER:+docker compose run --rm ${WORKSHOP_DOCKER_SERVICE:-workshop} }make $cmd ${1%%-*}${sdk_hint:+ $sdk_hint}${MISSION_TARGET:+ MISSION_TARGET=$MISSION_TARGET} again."
    exit 1
  fi
}

# Sets cls in this shell (a $(...) subshell's exit and line would be lost under set -e).
target_class() {
  case "${MISSION_TARGET:-start}" in
    start) cls=Start ;;
    solution) cls=Solution ;;
    *) say "MISSION_TARGET must be start or solution: leave it unset, or add MISSION_TARGET=solution."; exit 2 ;;
  esac
}

cmd=${1:-}
[ $# -gt 0 ] && shift
case "$cmd" in
  setup)
    need_jdk
    if stale; then build; else say "[setup] The Java helpers are built."; fi
    ;;
  check | live)
    [ $# -eq 1 ] || { say "usage: sh mission.sh $cmd <NN-name>"; exit 2; }
    target_class
    need_jdk
    if stale; then build; fi
    compile "$1" "$cls"
    if [ "$cmd" = live ]; then
      exec java $JFLAGS "@$out.args" -Dworkshop.target="$cls" agent.Check "$pkg" --live
    fi
    exec java $JFLAGS "@$out.args" -Dworkshop.target="$cls" agent.Check "$pkg"
    ;;
  run)
    [ $# -ge 1 ] || { say "usage: sh mission.sh run <NN-name> [--no-save]"; exit 2; }
    target_class
    need_jdk
    if stale; then build; fi
    m=$1
    shift
    compile "$m" "$cls"
    exec java $JFLAGS "@$out.args" agent.Run "$pkg" "$cls" "$@"
    ;;
  unit)
    need_jdk
    if ! mvn test; then exit 1; fi
    printf 'sdk=%s\n' "${SDK_VERSION:-pinned}" > "$STAMP"
    cat "$T"/surefire-reports/*.txt 2>/dev/null | awk -F'[:,] *' '/^Tests run/ { n += $2; s += $8 } END { print n - s " passed" (s ? ", " s " skipped" : "") }'
    ;;
  example)
    need_jdk
    if stale; then build; fi
    out="$T/examples"
    rm -rf "$out" && mkdir -p "$out"
    argfile "$out"
    javac -nowarn -Xlint:none -encoding UTF-8 --release 17 -d "$out" "@$out.args" examples/FirstSettings.java
    exec java $JFLAGS "@$out.args" FirstSettings "$@"
    ;;
  *)
    say "usage: sh mission.sh setup | check <NN-name> | live <NN-name> | run <NN-name> | unit | example [file.wav]"
    exit 2
    ;;
esac
