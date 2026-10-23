# Docker Crowbar

Force a reliability defect, walk through the door it opens.

A runnable lab for one idea: a system is rarely equally secure in every state,
and the degraded state is usually the weaker one. If you can force the
degradation on demand, you choose when the target sits in its weakest state.
This shows the cleanest version of that, an authorization sidecar taken out by
a forced out-of-memory kill, against containers this lab owns. No real service,
no real target, no exploit pointed at anyone.

Companion to the article *Forcing Reliability Defects in Docker* on
ghostintheprompt.com. The chain runs in stages. Stage 1 forces the defect in a
single container. Stage 2 (`stage2_ci/`) shows how GitHub CI takes that same
primitive and amplifies it into a supply-chain poison that reaches everyone
downstream.

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

## Stage 2: CI turns a local fail-open into a supply-chain poison

Stage 1 is one request against one app. Stage 2 is the same move pointed at a
build pipeline, where the blast radius is everyone who pulls the result.

The vector is GitHub Actions cache poisoning. A `pull_request_target` workflow
runs with the base repo's secrets and default-branch cache access. When it
builds untrusted fork code, usually in Docker, that code writes a poisoned
entry into the shared cache. A later trusted release job restores that cache by
key and runs what it finds, with publish permissions. It happened to TanStack
(May 2026) and to Angular. The crowbar is the same family as Stage 1: the write
has to land during a running build, and one way to force that is to evict
existing entries by filling the cache, which is CWE-400 resource exhaustion
again. Force the reliability condition, land the poison.

Proven locally, deterministically, with a marker payload and no live CI:

```bash
./stage2_ci/test.sh                    # 2/2: poison runs on a shared key, stranded on a trust-scoped key
./stage2_ci/poison_cache_demo.sh shared     # vulnerable: trusted job runs the poison
./stage2_ci/poison_cache_demo.sh isolated   # fixed: trust-scoped cache key strands it
```

`.github/workflows/cache-poison-lab.yml` is the same mechanism on real GitHub
Actions, marker-only, read-only permissions, manual dispatch, against this repo.
It deliberately does not wire up the `pull_request_target` fork trigger that
makes it attacker-reachable in the wild; the prose explains that part, the code
does not ship it.

Stage 3 is where it stops being only code execution. A poisoned artifact, cache,
or log is trusted by everything downstream, which is a trust transition. When
the thing downstream is an agent that reads CI output, the poison becomes an
indirect prompt injection that rode the supply chain through that trust
boundary. The article carries Stage 3; this repo stops at the mechanism.

GitHub has been closing this, which tells you it is real: the Actions runtime
token can no longer write to the cache after a job concludes, `actions/checkout`
is being hardened, and orgs can now enforce pinning actions to a commit SHA.

## Layout

```
app/server.js                        Stage 1 app; FAIL_MODE=open|closed selects the behavior
policy/server.js                     Stage 1 sidecar; /check answers, /balloon is the crowbar
lib/decide.js                        the one decision: what to do when the sidecar is silent
test.js                              deterministic proof of that decision (no Docker)
docker-compose.yml                   two apps, one sidecar, the mem_limit that makes OOM clean
run_demo.sh                          Stage 1 end to end, baseline then forced-degraded
stage2_ci/poison_cache_demo.sh       Stage 2 local model of shared-cache poisoning
stage2_ci/test.sh                    deterministic proof of Stage 2 (no live CI)
.github/workflows/cache-poison-lab.yml   Stage 2 on real Actions, marker-only, manual dispatch
```

## Scope

Educational. Everything runs against this lab's own containers on your own
machine. There is no code here that attacks a third party, and the only "attack"
is a memory balloon fired at a sidecar you started yourself. Use it to learn to
find and close this pattern, which is common wherever a sidecar authorizes an
app and nobody tested what happens when the sidecar is gone.

## License

MIT. Built by **MDRN Corp** - [mdrn.app](https://mdrn.app)
