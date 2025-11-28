/**
 * Berkeley Algorithm Client (Windows Local Time Version)
 * ------------------------------------------------------
 * Run (must be admin to set system time):
 *   node client.js --host 127.0.0.1 --port 9000 --id clientA
 */

const net = require("net");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { exec } = require("child_process");

const argv = yargs(hideBin(process.argv))
  .option("host", { default: "127.0.0.1", type: "string" })
  .option("port", { default: 9000, type: "number" })
  .option("id",   { default: "client-" + Math.floor(Math.random() * 1000), type: "string" })
  .help()
  .argv;

const HOST = argv.host;
const PORT = argv.port;
const CLIENT_ID = argv.id;


// ======================================================
// HELPER: Format timestamp human-friendly
// ======================================================
function formatTimestamp(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleString(); // otomatis pakai zona waktu Windows lokal
}


// ======================================================
// GET LOCAL WINDOWS TIME
// ======================================================
function getLocalSystemTime() {
  return Date.now() / 1000; 
}


// ======================================================
// SET WINDOWS SYSTEM TIME
// ======================================================
function setLocalSystemTime(unixSeconds) {
  const date = new Date(unixSeconds * 1000);

  const yyyy = date.getFullYear();
  const mm   = String(date.getMonth() + 1).padStart(2, "0");
  const dd   = String(date.getDate()).padStart(2, "0");
  const hh   = String(date.getHours()).padStart(2, "0");
  const mi   = String(date.getMinutes()).padStart(2, "0");
  const ss   = String(date.getSeconds()).padStart(2, "0");

  const datetime = `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  const cmd = `powershell -Command "Set-Date -Date '${datetime}'"`;

  console.log(`🕒 Applying time adjustment → ${datetime}`);

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error("❌ Failed to update local Windows time:", stderr);
    } else {
      console.log(`✔ Windows time successfully updated.`);
    }
  });
}


// ======================================================
// CONNECT TO BERKELEY MASTER SERVER
// ======================================================
function connectToMaster() {
  const socket = new net.Socket();
  socket.setEncoding("utf8");

  console.log(`🚀 Attempting connection to ${HOST}:${PORT} ...`);

  socket.connect(PORT, HOST, () => {
    console.log(`🎉 Connected to server as "${CLIENT_ID}"`);
    socket.write(JSON.stringify({ id: CLIENT_ID }) + "\n");
  });


  // ======================================================
  // SERVER MESSAGE HANDLER
  // ======================================================
  socket.on("data", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.log("⚠ Received invalid JSON data, ignoring.");
      return;
    }

    // ------------------------
    // HANDLE TIME REQUEST
    // ------------------------
    if (msg.type === "TIME_REQUEST") {
      const t0 = msg.t0;
      const t1 = getLocalSystemTime();

      console.log(
        `📨 TIME_REQUEST from server\n` +
        `   - t0 (server send time): ${t0.toFixed(3)} (${formatTimestamp(t0)})\n` +
        `   - t1 (client local time): ${t1.toFixed(3)} (${formatTimestamp(t1)})`
      );

      socket.write(JSON.stringify({ type: "TIME_REPLY", t1, t0 }) + "\n");

      console.log(`↩ Sent TIME_REPLY back to server.`);

    // ------------------------
    // HANDLE TIME ADJUST
    // ------------------------
    } else if (msg.type === "ADJUST") {
      const offset = msg.offset;
      const current = getLocalSystemTime();
      const newTime = current + offset;

      console.log(
        `⚙ ADJUST command received\n` +
        `   - offset : ${offset.toFixed(3)} seconds\n` +
        `   - before : ${formatTimestamp(current)}\n` +
        `   - after  : ${formatTimestamp(newTime)}`
      );

      setLocalSystemTime(newTime);
    }
  });


  // ======================================================
  // CONNECTION CLOSED
  // ======================================================
  socket.on("close", () => {
    console.log("🔌 Connection closed. Reconnecting in 3 seconds...");
    setTimeout(connectToMaster, 3000);
  });

  socket.on("error", (err) => {
    console.error("❗ Socket error:", err.message);
  });
}

connectToMaster();
