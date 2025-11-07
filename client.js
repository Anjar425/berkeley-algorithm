/**
 * Berkeley Algorithm Client
 * -------------------------
 * Run:
 *   node client.js --id C1 --port 9000 --host 127.0.0.1 --offset 2 --drift 0.0001
 */

const net = require("net");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");

const argv = yargs(hideBin(process.argv))
  .option("id", { type: "string", default: "client-" + Math.random() })
  .option("host", { type: "string", default: "127.0.0.1" })
  .option("port", { type: "number", default: 9000 })
  .option("offset", { type: "number", default: 0.0 })
  .option("drift", { type: "number", default: 0.0 })
  .help()
  .argv;

const { id, host, port, offset, drift } = argv;

// logical clock
let baseTime = Date.now() / 1000;
let localOffset = offset; // seconds

function now() {
  const realNow = Date.now() / 1000;
  const elapsed = realNow - baseTime;
  return realNow + localOffset + drift * elapsed;
}

function adjust(delta) {
  localOffset += delta;
  console.log(`[clock] applied offset=${delta.toFixed(3)} → newOffset=${localOffset.toFixed(3)}`);
}

function main() {
  const sock = net.connect(port, host, () => {
    console.log(`[+] Connected to server ${host}:${port} as ${id}`);
    sock.write(JSON.stringify({ id }) + "\n");
  });

  sock.setEncoding("utf8");

  sock.on("data", (raw) => {
    raw.trim()
      .split("\n")
      .forEach((line) => {
        if (!line) return;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "TIME_REQUEST") {
            const t1 = now();
            sock.write(JSON.stringify({ type: "TIME_REPLY", t1 }) + "\n");
            console.log(`[>] reply TIME_REPLY t1=${t1.toFixed(3)}`);

          } else if (msg.type === "ADJUST") {
            const off = msg.offset ?? 0;
            console.log(`[<] ADJUST offset=${off.toFixed(3)}`);
            adjust(off);

          } else {
            console.log("unknown msg", msg);
          }
        } catch {}
      });
  });

  sock.on("close", () => console.log("[-] disconnected"));
  sock.on("error", (e) => console.log("socket error", e));
}

main();
