# Docker Crowbar

Force a reliability defect, walk through the door it opens.

A runnable lab for one idea: a system is rarely equally secure in every state,
and the degraded state is usually the weaker one. If you can force the
degradation on demand, you choose when the target sits in its weakest state.
This shows the cleanest version of that, an authorization sidecar taken out by
a forced out-of-memory kill, against containers this lab owns. No real service,
no real target, no exploit pointed at anyone.

Companion to the article *Forcing Reliability Defects in Docker* on
ghostintheprompt.com.

## The chain

Two copies of the same app sit behind one policy sidecar. Every privileged
action (`POST /transfer`) is authorized by a call to that sidecar. The apps
differ by one line, the thing they do when the sidecar does not answer:

- `app-vulnerable` fails **open** (allow on a silent sidecar). CWE-636.
- `app-hardened` fails **closed** (deny on a silent sidecar).

The crowbar is a deliberate reliability defect in the sidecar: a `/balloon`
endpoint that allocates memory without bound. Under the sidecar's `mem_limit`
(128m in `docker-compose.yml`) Docker's OOM killer takes the process, and it
goes silent. One request forces the degraded state, repeatably.

```
unauthorized "anonymous" transfer:

                        policy healthy      policy OOM-killed
----------------------------------------------------------------
app-vulnerable (open)        DENY                  ALLOW
app-hardened  (closed)       DENY                  DENY
```

The attack never touched the authorization logic. It removed the conditions
under which that logic runs.

## Run it

Live, end to end, in Docker:

```bash
./run_demo.sh
```

Verified output (Docker 29.x), trimmed to the four requests that matter:

```
== baseline (policy healthy): unauthorized transfer ==
vulnerable (fail-open):  {"verdict":"DENY","degraded":false,...,"note":"policy sidecar answered"}
hardened  (fail-closed): {"verdict":"DENY","degraded":false,...,"note":"policy sidecar answered"}

== fire the crowbar (force policy OOM) ==

== degraded (policy down): same unauthorized transfer ==
vulnerable (fail-open):  {"verdict":"ALLOW","degraded":true,...,"note":"policy sidecar unreachable - app decided on its own"}
hardened  (fail-closed): {"verdict":"DENY","degraded":true,...,"note":"policy sidecar unreachable - app decided on its own"}
```

The decision the whole lab turns on is a pure function (`lib/decide.js`) with a
deterministic test that needs no Docker, so the point is provable even where a
container runtime is not:

```bash
node test.js      # 7/7 assertions
```

## Why it works, and how to close it

The forced OOM is CWE-400 (uncontrolled resource consumption) and CWE-770
(allocation without limits), driven as MITRE ATT&CK T1499 (endpoint denial of
service). The denial is not the goal. The goal is the fail-open state the
denial leaves behind (CWE-636, failure to fail securely).

Two unglamorous fixes, both in this repo:

- Fail closed. `app-hardened` denies when the sidecar is silent, and that is
  the entire difference in the output above. Availability cost, paid on purpose.
- Bound the blast radius. `mem_limit` keeps the OOM container-scoped instead of
  letting the kernel OOM killer pick a victim across the host. Add `pids_limit`
  and `cpus` for the same reason.

## Layout

```
app/server.js        protected app; FAIL_MODE=open|closed selects the behavior
policy/server.js     authorization sidecar; /check answers, /balloon is the crowbar
lib/decide.js        the one decision: what to do when the sidecar is silent
test.js              deterministic proof of that decision (no Docker)
docker-compose.yml   two apps, one sidecar, the mem_limit that makes OOM clean
run_demo.sh          the full chain, baseline then forced-degraded
```

## Scope

Educational. Everything runs against this lab's own containers on your own
machine. There is no code here that attacks a third party, and the only "attack"
is a memory balloon fired at a sidecar you started yourself. Use it to learn to
find and close this pattern, which is common wherever a sidecar authorizes an
app and nobody tested what happens when the sidecar is gone.

## License

MIT. Built by **MDRN Corp** - [mdrn.app](https://mdrn.app)
