// ==================================================
// TAMBAHKAN DI ATAS GLOBAL SCOPE (DI LUAR EVENT LISTENER)
// ==================================================
const commandQueue = [];
let isBotBusy = false; // Flag penanda jika bot sedang memproses perintah

// Fungsi utama penjadwal antrean
async function jalankanAntrean() {
    // Jika bot sedang sibuk atau antrean kosong, batalkan eksekusi
    if (isBotBusy || commandQueue.length === 0) return;

    // Kunci bot agar permintaan lain mengantre
    isBotBusy = true;
    
    // Ambil permintaan pertama dari antrean
    const { msg, executeFn } = commandQueue.shift();

    try {
        // Jalankan logika bot utama Anda
        await executeFn(msg);
    } catch (error) {
        console.error("❌ Error dalam eksekusi antrean:", error);
    } finally {
        // Buka kembali kunci bot
        isBotBusy = false;
        // Berikan jeda aman 1.5 detik sebelum memproses antrean berikutnya agar resource bersih
        setTimeout(jalankanAntrean, 1500);
    }
}

// ==================================================
// PASANG DI BAGIAN EVENT LISTENER PESAN MASUK
// ==================================================
client.on('message', async (msg) => {
    // Sesuaikan dengan format trigger perintah cek Anda (misal: !cek)
    if (msg.body.startsWith('!cek')) {
        
        // Bungkus logika pengecekan utama Anda ke dalam fungsi tugas (Task)
        const taskPengecekan = async (currentMsg) => {
            try {
                // --- KODE UTAMA MIKROTIK & PARSING ANDA DI SINI ---
                // Contoh alur lama Anda:
                // const api = new RouterOSAPI({...});
                // ... Ambil data username, paket, server, dan MAC ...
                
                // Saat memanggil scanSemuaOlt, PASTIKAN sertakan parameter 'currentMsg'
                // agar hasil redaman bisa langsung dikirim balik ke chat pembaca.
                const hasilOlt = await scanSemuaOlt(targetServer.olts, mac, currentMsg);
                
                // Laporan penutup scan selesai
                await currentMsg.reply(
                    `✨ *RnB Network - Laporan Akhir*\n\n` +
                    `👤 *Pelanggan:* ${username}\n` +
                    `💻 *Server:* ${targetServer.label}\n` +
                    `🔒 *MAC OLT:* \`${mac}\`\n\n` +
                    `${hasilOlt}`
                );
            } catch (err) {
                await currentMsg.reply(`❌ *Gagal Aktivasi/Pengecekan*:\n${err.message}`);
            }
        };

        // Masukkan pesan ke daftar antrean
        commandQueue.push({ msg: msg, executeFn: taskPengecekan });

        // Jika bot sedang sibuk, beri tahu pengguna posisi antreannya
        if (isBotBusy) {
            await msg.reply(
                `⏳ *[ANTREAN BOT RnB]*\n\n` +
                `Bot sedang memproses permintaan hp lain agar tidak *hang/bentrok*.\n` +
                `Permintaan Anda aman di *Antrean #${commandQueue.length}* dan akan diproses otomatis jika giliran tiba.`
            );
        }

        // Trigger jalankan antrean
        jalankanAntrean();
    }
});
