/**
 * Berkeley Algorithm Client
 * -------------------------
 * Run:
 * node client.js --id C1 --port 9000 --host 127.0.0.1 --offset 2 --drift 0.0001
 * * CATATAN PENTING: Untuk mengubah jam sistem (setSystemTime), 
 * script ini HARUS dijalankan sebagai ADMINISTRATOR di Windows.
 */

const net = require("net");
const yargs = require("yargs"); // Load yargs utama
const { exec } = require('child_process'); // Digunakan untuk menjalankan perintah OS
const os = require('os'); // Digunakan untuk cek platform OS

// --- FUNGSI PENGUBAH JAM SISTEM WINDOWS (DENGAN TANGGAL) ---

/**
 * Menjalankan perintah DATE dan TIME di Windows untuk mengatur jam sistem.
 * @param {Date} newDate - Objek Date dengan waktu yang ingin disetel.
 */
// [MODIFIED] FUNGSI PENGUBAH JAM SISTEM WINDOWS
function setSystemTime(newDate) {
    if (os.platform() !== 'win32') {
        console.log(`[OS Hook] Perintah ubah jam sistem diabaikan (Bukan Windows).`);
        return;
    }

    // --- 1. Dapatkan Waktu Lokal (WIB) ---
    // Gunakan fungsi toLocaleTimeString() untuk mendapatkan waktu dalam format regional
    // Pastikan zona waktu Node.js Anda benar (atau gunakan UTC + 7)
    
    // Asumsi: Waktu sudah dikonversi ke waktu lokal Anda (WIB) di targetDate.
    // Kita gunakan format numerik untuk meminimalkan masalah regional:
    
    const month = (newDate.getMonth() + 1).toString().padStart(2, '0');
    const day = newDate.getDate().toString().padStart(2, '0');
    const year = newDate.getFullYear();
    
    // Menggunakan format yang paling umum diterima Windows: MM/DD/YYYY
    const dateString = `${month}/${day}/${year}`; 

    const hours = newDate.getHours().toString().padStart(2, '0');
    const minutes = newDate.getMinutes().toString().padStart(2, '0');
    const seconds = newDate.getSeconds().toString().padStart(2, '0');
    const timeString = `${hours}:${minutes}:${seconds}`;

    // --- 2. Perintah Pemaksa Eksekusi Windows (Paling Robust) ---
    // Menggunakan cmd /c untuk memaksa eksekusi dan 'set' untuk menghindari prompt interaktif
    
    const command = `cmd /c date ${dateString} & cmd /c time ${timeString}`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`[ERROR OS] Gagal mengubah jam sistem. Error: ${error.message}`);
            console.error(`[ERROR OS] Cek: Hak Admin (Sudo) dan format MM/DD/YYYY`);
            return;
        }
        // Log ini menunjukkan perintah berhasil dieksekusi di OS
        console.log(`[SUCCESS OS] Jam sistem diubah ke ${timeString} [Target: ${dateString}]`);
    });
}

// --- ARGUMEN BARIS PERINTAH ---

const argv = yargs(process.argv.slice(2))
  .option("id", { type: "string", default: "client-" + Math.random().toFixed(4).slice(2) })
  .option("host", { type: "string", default: "127.0.0.1" })
  .option("port", { type: "number", default: 9000 })
  .option("offset", { type: "number", default: 0.0 })
  .option("drift", { type: "number", default: 0.0 })
  .help()
  .argv;

const { id, host, port, offset, drift } = argv;

// --- JAM LOGIS & SIMULASI CLOCK SKEW ---

// logical clock
let baseTime = Date.now() / 1000;
let localOffset = offset; // seconds

function now() {
  const realNow = Date.now() / 1000;
  const elapsed = realNow - baseTime;
  // Perhitungan jam logis (Waktu Nyata + Offset + Drift * Waktu Berlalu)
  return realNow + localOffset + drift * elapsed;
}

function logCurrentTime(tag = "") {
  const t = now();
  console.log(
    `[time] ${tag} now_unix=${t.toFixed(3)} | iso=${new Date(t * 1000).toISOString()}`
  );
}

// --- FUNGSI ADJUST BARU (Mengubah Jam Sistem) ---

function adjust(delta) {
    // Hitung waktu sistem yang baru setelah penyesuaian (dalam detik)
    const targetTimeUnix = now() + delta;
    const targetDate = new Date(targetTimeUnix * 1000);

    // [MODIFIKASI] Menghilangkan pengecekan if (Math.abs(delta) > 60)
    // Sekarang akan selalu memanggil setSystemTime
    
    // Panggil fungsi OS untuk mengubah jam sistem secara nyata
    setSystemTime(targetDate);

    // Catat penyesuaian di offset lokal: 
    // Kita asumsikan jam sistem diubah, sehingga baseTime logis Node.js ini 
    // sekarang juga harus disetel ulang berdasarkan jam sistem yang baru.
    
    // Setel ulang baseTime ke waktu nyata saat ini
    baseTime = Date.now() / 1000; 
    localOffset = 0; // Karena jam sistem sudah diubah, offset kita terhadap waktu nyata harusnya 0

    console.log(`[clock] REAL ADJUSTMENT: target time=${targetDate.toLocaleTimeString()}`);
    
    logCurrentTime("after_adjust");
}

// --- KOMUNIKASI JARINGAN ---

function main() {
  const sock = net.connect(port, host, () => {
    console.log(`[+] Connected to server ${host}:${port} as ${id}`);
    sock.write(JSON.stringify({ id }) + "\n");
  });

  sock.setEncoding("utf8");

  sock.on("data", (raw) => {
    raw
      .trim()
      .split("\n")
      .forEach((line) => {
        if (!line) return;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "TIME_REQUEST") {
            const t1 = now();
            sock.write(JSON.stringify({ type: "TIME_REPLY", t1 }) + "\n");

            console.log(`[>] TIME_REPLY t1=${t1.toFixed(3)}`);
            logCurrentTime("reply");

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

  sock.on("close", () => {
    console.log("[-] disconnected");
    process.exit(0);
  });
  
  sock.on("error", (e) => {
    console.log("socket error", e.code || e.message);
    process.exit(1);
  });
}

main();