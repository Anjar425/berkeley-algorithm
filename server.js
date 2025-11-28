/**
 * Berkeley Algorithm Master Server (Local Time Version)
 * -----------------------------------------------------
 * Run (must be admin for time change):
 *   node server.js --port 9000 --interval 10
 */

const net = require("net");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { exec } = require("child_process");

const argv = yargs(hideBin(process.argv))
  .option("port", { default: 9000, type: "number" })
  .option("interval", { default: 10, type: "number" }) // seconds
  .help()
  .argv;

const PORT = argv.port;
const POLL_INTERVAL = argv.interval * 1000;

let clients = {}; // { id: {socket, addr} }


// ======================================================
// FORMAT TIMESTAMP USING SERVER LOCAL TIME (NO UTC)
// ======================================================
function formatTimestamp(ts) {
  const date = new Date(ts * 1000);

  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, "0");
  const dd   = String(date.getDate()).padStart(2, "0");

  const hh   = String(date.getHours()).padStart(2, "0");   // LOCAL TIME
  const mi   = String(date.getMinutes()).padStart(2, "0");
  const ss   = String(date.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}


// ======================================================
// READ WINDOWS LOCAL CLOCK (REAL SYSTEM TIME)
// ======================================================
function getLocalSystemTime() {
  return Date.now() / 1000; // epoch detik (zona tidak berpengaruh)
}


// ======================================================
// SET WINDOWS SYSTEM TIME (NEED ADMIN PRIVILEGE)
// ======================================================
function setLocalSystemTime(unixSeconds) {
  const date = new Date(unixSeconds * 1000);

  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, "0");
  const dd   = String(date.getDate()).padStart(2, "0");
  const hh   = String(date.getHours()).padStart(2, "0");
  const mi   = String(date.getMinutes()).padStart(2, "0");
  const ss   = String(date.getSeconds()).padStart(2, "0");

  const dateTimeStr = `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;

  const cmd = `powershell -Command "Set-Date -Date '${dateTimeStr}'"`;

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error("❌ Failed to set system time:", stderr);
    } else {
      console.log("✔ System time updated to:", dateTimeStr);
    }
  });
}


// ======================================================
// CLIENT CONNECTION HANDLER
// ======================================================
function onClient(socket) {
  socket.setEncoding("utf8");

  socket.on("error", (err) => {
    console.error(`[!] Socket error for ${socket.remoteAddress}:`, err.code || err.message);
  });

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
      console.error("Invalid first message", err);
    }
  });
}


// ======================================================
// BERKELEY SYNC CORE
// ======================================================
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
    // Check if client still exists and socket is writable
    if (!clients[id]) continue;
    
    const sock = clients[id].socket;
    if (sock.destroyed) {
      delete clients[id];
      continue;
    }

    const t0 = getLocalSystemTime();
    
    try {
      sock.write(JSON.stringify({ type: "TIME_REQUEST", t0 }) + "\n");
    } catch (err) {
      console.log(`  X failed to write to ${id}:`, err.message);
      continue;
    }

    const timeReply = await new Promise((resolve) => {
      let timer;
      let resolved = false;

      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.type === "TIME_REPLY") {
            clearTimeout(timer);
            sock.removeListener("data", handler);
            resolved = true;
            resolve(msg);
          }
        } catch {}
      };

      sock.on("data", handler);

      timer = setTimeout(() => {
        if (!resolved) {
          sock.removeListener("data", handler);
          resolved = true;
          resolve(null);
        }
      }, 3000);
    });

    const t2 = getLocalSystemTime();

    if (!timeReply) {
      console.log(`  X no reply from ${id}`);
      continue;
    }

    const t1 = timeReply.t1;
    const rtt = t2 - t0;
    const est = t1 + rtt / 2; 

    estimates[id] = { t1, t0, t2, rtt, est };

    console.log(
      `  response ${id}: t1=${t1.toFixed(3)} (${formatTimestamp(t1)}), rtt=${rtt.toFixed(3)}, est=${est.toFixed(3)}`
    );
  }

  const tServer = getLocalSystemTime();
  console.log(`  server time: ${tServer.toFixed(3)} (${formatTimestamp(tServer)})`);

  // 2) Calculate mean time
  const values = [tServer, ...Object.values(estimates).map(e => e.est)];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  console.log(`  mean time: ${mean.toFixed(3)} (${formatTimestamp(mean)})`);

  // 3) Send adjustments to clients
  for (const id of Object.keys(estimates)) {
    if (!clients[id] || clients[id].socket.destroyed) continue;
    
    const offset = mean - estimates[id].est;
    const sock = clients[id].socket;

    try {
      sock.write(JSON.stringify({ type: "ADJUST", offset }) + "\n");
      console.log(`  sent ADJUST to ${id}: offset=${offset.toFixed(3)}s`);
    } catch (err) {
      console.log(`  X failed to send ADJUST to ${id}:`, err.message);
    }
  }

  // 4) Adjust server time
  const serverOffset = mean - tServer;
  console.log(`  server offset = ${serverOffset.toFixed(3)}s`);

  if (Math.abs(serverOffset) > 0.05) {
    console.log("  → Applying server correction...");
    setLocalSystemTime(tServer + serverOffset);
  }
}


// ======================================================
// DETECT LOCAL HOUR CHANGE (OPTIONAL FOR LOGGING)
// ======================================================
let lastHour = new Date().getHours();

setInterval(() => {
  const now = new Date();
  const hour = now.getHours();

  if (hour !== lastHour) {
    console.log(`⏰ Hour changed: ${lastHour} → ${hour}`);
    lastHour = hour;
  }
}, 1000);


// ======================================================
// START SERVER
// ======================================================
const server = net.createServer(onClient);

server.listen(PORT, () => {
  console.log(`[+] Berkeley Server running on port ${PORT}`);
});

// Sync interval
setInterval(pollClients, POLL_INTERVAL);
