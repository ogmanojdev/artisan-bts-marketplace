/**
 * Bandwidth-capped HTTP(S) proxy for demoing playback on a real Android phone below 50 kbps.
 * Android's own developer rate limit bottoms out at 128 kbps, so the phone's traffic is sent
 * through this proxy over USB instead:
 *
 *   node scripts/throttle-proxy.mjs --kbps 48
 *   adb reverse tcp:8888 tcp:8888
 *   adb shell settings put global http_proxy localhost:8888     # on
 *   adb shell settings put global http_proxy :0                 # off (always run this after)
 *
 * The cap is one shared budget for all downstream bytes, so it behaves like a single slow link.
 * Uploads are not limited. Keys while running:  t = toggle the cap,  q = quit.
 * Chrome can use the same proxy:  chrome --proxy-server=http://127.0.0.1:8888
 *
 * The first FAST_LANE_BYTES of every connection move unthrottled, before the cap applies to the
 * rest. Without this, a player that opens several requests at once (e.g. Shaka's ABR prefetch)
 * divides the shared budget so thin per-connection that even the TLS handshake response stalls
 * long enough for the origin to reset it — playback fails outright instead of just loading slowly.
 * (An earlier version of this script gated connection *count* instead with a slot semaphore, but
 * browsers keep connections open and reused well past their handshake, so a slot only freed on
 * close would let a few persistent connections hoard every slot forever. Metering per-connection
 * bytes instead needs no such bookkeeping and can't deadlock.)
 */
import { appendFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const PORT = arg("port", 8888);
const LIMIT_KBPS = arg("kbps", 48);
const TICK_MS = 100;
/** Just past a TLS handshake (~2.5-3 KB observed with GCS's cert chain) — not large enough to
 *  exempt real payload too, or the cap would stop meaning anything for small segments/responses. */
const FAST_LANE_BYTES = 4 * 1024;
/** Optional `--log <file>`: one JSON line per second with the measured downstream rate. */
const LOG_FILE = process.argv.includes("--log") ? process.argv[process.argv.indexOf("--log") + 1] : null;

let capped = true;
let sentThisSecond = 0;
/** Downstream queues, one per open connection. */
const flows = new Set();

function throttle(upstream, client) {
  const flow = { chunks: [], upstream, client, sent: 0 };
  flows.add(flow);
  upstream.on("data", (chunk) => {
    flow.chunks.push(chunk);
    upstream.pause(); // back-pressure: read more only once this chunk has drained
  });
  const close = () => {
    flows.delete(flow);
    upstream.destroy();
    client.destroy();
  };
  upstream.on("end", () => (flow.ended = true));
  upstream.on("error", close);
  client.on("error", close);
  client.on("close", close);
}

setInterval(() => {
  // Fast lane first: each connection's first FAST_LANE_BYTES bypass the cap entirely, so a burst
  // of new connections can't starve each other's handshake. Only bulk payload after that is capped.
  for (const f of flows) {
    if (!f.chunks.length || f.sent >= FAST_LANE_BYTES) continue;
    const head = f.chunks[0];
    const n = Math.min(head.length, FAST_LANE_BYTES - f.sent);
    f.client.write(head.subarray(0, n));
    f.sent += n;
    sentThisSecond += n;
    if (n === head.length) f.chunks.shift();
    else f.chunks[0] = head.subarray(n);
    if (!f.chunks.length) {
      if (f.ended) f.client.end();
      else f.upstream.resume();
    }
  }

  let budget = capped ? (LIMIT_KBPS * 1000 * TICK_MS) / 8000 : Infinity;
  const active = [...flows].filter((f) => f.chunks.length && f.sent >= FAST_LANE_BYTES);
  // Round-robin so one segment download can't starve the playlist or API calls.
  while (budget >= 1 && active.length) {
    const share = Math.max(1, Math.floor(budget / active.length));
    for (const f of [...active]) {
      const head = f.chunks[0];
      const n = Math.min(head.length, share, Math.floor(budget));
      if (n < 1) break;
      f.client.write(head.subarray(0, n));
      budget -= n;
      sentThisSecond += n;
      if (n === head.length) f.chunks.shift();
      else f.chunks[0] = head.subarray(n);
      if (!f.chunks.length) {
        active.splice(active.indexOf(f), 1);
        if (f.ended) f.client.end();
        else f.upstream.resume();
      }
    }
  }
  for (const f of flows) if (f.ended && !f.chunks.length) f.client.end();
}, TICK_MS);

setInterval(() => {
  const kbps = (sentThisSecond * 8) / 1000;
  sentThisSecond = 0;
  if (LOG_FILE) appendFileSync(LOG_FILE, `${JSON.stringify({ t: Date.now(), kbps, capped })}\n`);
  const bar = "#".repeat(Math.min(40, Math.round((kbps / LIMIT_KBPS) * 20)));
  process.stdout.write(`\r  down ${kbps.toFixed(1).padStart(7)} kbps  ${capped ? `cap ${LIMIT_KBPS} kbps` : "cap OFF    "}  ${bar.padEnd(40)}`);
}, 1000);

const server = http.createServer((req, res) => {
  // Control from another terminal:  curl http://127.0.0.1:8888/cap/on  (or /cap/off)
  if (req.url === "/cap/on" || req.url === "/cap/off") {
    capped = req.url === "/cap/on";
    return res.end(`cap ${capped ? "on" : "off"}\n`);
  }
  // Plain-HTTP proxying (absolute-URI requests).
  const url = new URL(req.url);
  const upstream = http.request(
    { host: url.hostname, port: url.port || 80, path: url.pathname + url.search, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      throttle(up, res);
    },
  );
  upstream.on("error", () => res.writeHead(502).end());
  req.pipe(upstream);
});

// HTTPS: tunnel the TLS stream and meter the bytes coming back.
server.on("connect", (req, client, head) => {
  const [host, port] = req.url.split(":");
  const upstream = net.connect(Number(port) || 443, host, () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    client.pipe(upstream);
    throttle(upstream, client);
  });
  upstream.on("error", () => client.destroy());
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Throttling proxy on 127.0.0.1:${PORT}, downstream cap ${LIMIT_KBPS} kbps.  t = toggle cap, q = quit`);
});

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.on("data", (key) => {
    const k = key.toString();
    if (k === "t") capped = !capped;
    if (k === "q" || k === "") process.exit(0);
  });
}
