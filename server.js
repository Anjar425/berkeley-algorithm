/**
 * Berkeley Algorithm Master Server
 * --------------------------------
 * Run:
 *   node server.js --port 9000 --interval 10
 */

const net = require("net");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const argv = yargs(hideBin(process.argv))
  .option("port", { default: 9000, type: "number" })
  .option("interval", { default: 10, type: "number" })
  .help()
  .argv;


const PORT = argv.port;
const POLL_INTERVAL = argv.interval * 1000;

let clients = {}; // { id: {socket, addr} }

function formatTimestamp(ts) {
  const date = new Date(ts * 1000); // detik → ms
  return date.toISOString().replace("T", " ").slice(0, 19);
}


// Handle connected client
function onClient(socket) {
  socket.setEncoding("utf8");
  socket.once("data", (data) => {
    try {
      const msg = JSON.parse(data);
      const id = msg.id ?? socket.remoteAddress + ":" + socket.remotePort;

      clients[id] = { socket, addr: socket.remoteAddress };
      console.log(`[+] Client connected: ${id}`);

      socket.on("close", () => {
        delete clients[id];
        console.log(`[-] Client disconnected: ${id}`);
      });

    } catch (err) {
      console.error("invalid first msg", err);
    }
  });
}

// Core sync loop
async function pollClients() {
  const ids = Object.keys(clients);
  if (ids.length === 0) {
    console.log("[*] No clients connected");
    return;
  }

  console.log("\n[*] Starting Berkeley poll…");

  const estimates = {};

  // 1) Request time from each client
  for (const id of ids) {
    const obj = clients[id];
    const sock = obj.socket;

    const t0 = Date.now() / 1000;
    sock.write(JSON.stringify({ type: "TIME_REQUEST", t0 }) + "\n");

    let rtt;

    // Wait for reply
    const timeReply = await new Promise((resolve) => {
      let timer;

      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === "TIME_REPLY") {
            clearTimeout(timer);
            sock.removeListener("data", handler);
            resolve(msg);
          }
        } catch {}
      };

      sock.on("data", handler);

      timer = setTimeout(() => {
        sock.removeListener("data", handler);
        resolve(null);
      }, 3000);
    });

    const t2 = Date.now() / 1000;

    if (!timeReply) {
      console.log(`  X no reply from ${id}`);
      continue;
    }

    const t1 = timeReply.t1;
    rtt = t2 - t0;
    const est = t1 + rtt / 2;
    estimates[id] = { t0, t1, t2, rtt, est };

    console.log(
      `  response ${id}: t1=${t1.toFixed(3)}, rtt=${rtt.toFixed(3)}, est=${est.toFixed(3)}`
    );
  }

  const tServer = Date.now() / 1000;
  console.log(`  server time: ${tServer.toFixed(3)} (${formatTimestamp(tServer)})`);

  // Build clock list
  const values = [tServer, ...Object.values(estimates).map((e) => e.est)];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  console.log(`  mean time: ${mean.toFixed(3)} (${formatTimestamp(mean)})`);

  // 2) Send adjustment
  for (const id of Object.keys(estimates)) {
    const e = estimates[id];
    const offset = mean - e.est;
    const sock = clients[id].socket;

    sock.write(JSON.stringify({ type: "ADJUST", offset }) + "\n");
    console.log(`  sent ADJUST to ${id}: offset=${offset.toFixed(3)}s`);
  }

  const serverAdjust = mean - tServer;
  console.log(`  server offset (simulated): ${serverAdjust.toFixed(3)}s`);
}

// Server
const server = net.createServer(onClient);

server.listen(PORT, () => {
  console.log(`[+] Berkeley Server running on port ${PORT}`);
});

// Sync timer
setInterval(pollClients, POLL_INTERVAL);
