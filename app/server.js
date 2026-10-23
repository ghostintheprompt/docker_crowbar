"use strict";

// The protected application. Every privileged action is authorized by a call
// to the policy sidecar. The only interesting line is what happens when that
// call does not come back: see decide().

const http = require("http");
const { decide } = require("./decide");

const POLICY_URL = process.env.POLICY_URL || "http://policy:7070";
const FAIL_MODE = process.env.FAIL_MODE === "open" ? "open" : "closed";
const PORT = 8080;

function checkPolicy(subject, action) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ subject, action });
    const req = http.request(
      POLICY_URL + "/check",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
        timeout: 1500,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            resolve({ reachable: true, allow: !!j.allow });
          } catch {
            resolve({ reachable: false });
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ reachable: false });
    });
    req.on("error", () => resolve({ reachable: false }));
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/transfer") {
    const subject = req.headers["x-subject"] || "anonymous";
    const policyResult = await checkPolicy(subject, "transfer");
    const verdict = decide(policyResult, FAIL_MODE);
    const degraded = !policyResult.reachable;
    res.writeHead(verdict === "ALLOW" ? 200 : 403, {
      "content-type": "application/json",
    });
    res.end(
      JSON.stringify({
        verdict,
        degraded,
        failMode: FAIL_MODE,
        subject,
        note: degraded
          ? "policy sidecar unreachable - app decided on its own"
          : "policy sidecar answered",
      })
    );
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => console.log(`[app] listening :${PORT} FAIL_MODE=${FAIL_MODE}`));
