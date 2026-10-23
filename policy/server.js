"use strict";

// The authorization sidecar. It answers /check with allow/deny, and it carries
// one deliberate reliability defect: /balloon allocates memory without bound.
// Under the container's mem_limit, Docker OOM-kills the process. That is the
// crowbar - a forced, repeatable way to make this sidecar go silent.

const http = require("http");

const PORT = 7070;

// Who may perform the privileged action. "anonymous" is deliberately not here.
const AUTHORIZED = new Set(["treasury-admin"]);

// Held at module scope so the allocation cannot be garbage-collected away.
const balloon = [];

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/check") {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      let subject = "anonymous";
      try {
        subject = JSON.parse(data).subject || "anonymous";
      } catch {
        /* malformed body stays anonymous */
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ allow: AUTHORIZED.has(subject) }));
    });
    return;
  }

  if (req.url === "/balloon") {
    // THE CROWBAR. Grow off-heap memory 10MB at a time until the container's
    // mem_limit trips Docker's OOM killer. The process dies; the sidecar is
    // unreachable until (if ever) it is restarted.
    res.writeHead(200);
    res.end("ballooning\n");
    const grow = () => {
      balloon.push(Buffer.alloc(10 * 1024 * 1024, 1));
      setImmediate(grow);
    };
    grow();
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`[policy] listening :${PORT}`));
