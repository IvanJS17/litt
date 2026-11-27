#!/bin/sh
# Runs the container's command as the unprivileged litt-api user.
#
# Started as root, it drops to litt-api and keeps exactly two capabilities, as
# ambient: set-user-ID and set-group-ID, which the API needs to start the
# document readers as litt-reader (src/lib/extraction/isolated.ts). Nothing else
# survives: the readers themselves are started with none. Started as another
# user already (docker run --user), it runs the command as that user, and
# production then refuses to start for lack of the switch.
set -eu
if [ "$(id -u)" = 0 ]; then
  # Switching user needs the set-user-ID (bit 7) and set-group-ID (bit 6) capabilities.
  # Without them setpriv only says "Operation not permitted": say what is missing.
  caps=$(sed -n 's/^CapEff:[[:space:]]*//p' /proc/self/status 2>/dev/null || true)
  low=${caps#"${caps%??}"}
  if [ -n "$low" ] && [ $(( 0x$low & 192 )) -ne 192 ]; then
    echo "litt-entrypoint: cannot start: the container needs the SETUID and SETGID capabilities to run the API as an unprivileged user (cap_add: [SETUID, SETGID]); they are missing, as when cap_drop: ALL is set with nothing added" >&2
    exit 1
  fi
  export HOME=/home/litt-api
  exec setpriv --reuid litt-api --regid litt-api --init-groups \
    --inh-caps +setuid,+setgid --ambient-caps +setuid,+setgid -- "$@"
fi
exec "$@"
