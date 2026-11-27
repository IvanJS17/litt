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
  export HOME=/home/litt-api
  exec setpriv --reuid litt-api --regid litt-api --init-groups \
    --inh-caps +setuid,+setgid --ambient-caps +setuid,+setgid -- "$@"
fi
exec "$@"
