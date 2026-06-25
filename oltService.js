// ==========================================
// 4. SCAN SEMUA OLT (DENGAN REAL-TIME STREAMING KE WA)
// ==========================================
async function scanSemuaOlt(oltList, mac, msg) {
    console.log(`\n========================================`);
    console.log(`🚀 MULAI SCAN ${oltList.length} OLT...`);
    console.log(`========================================`);
    
    let foundCount = 0; // Penghitung data yang ditemukan
    const axiosOlts = oltList.filter(o => o.type === 'HSAirpo');
    const puppeteerOlts = oltList.filter(o => o.type === 'Hioso');

    // 1. Jalankan Scan HSAirpo (Paralel)
    if (axiosOlts.length > 0) {
        console.log(`\n⚡ Menjalankan ${axiosOlts.length} HSAirpo secara paralel...`);
        const axiosPromises = axiosOlts.map(async (olt) => {
            let hasil = null;
            try {
                if (olt.method === 'cibarola') {
                    hasil = await cekRedamanHSAirpoCibarola(olt, mac);
                } else {
                    hasil = await cekRedamanHSAirpoAPI(olt, mac);
                }

                // JIKA DITEMUKAN, LANGSUNG KIRM KE BOT WA DETIK ITU JUGA!
                if (hasil && !hasil.error) {
                    foundCount++;
                    await msg.reply(`✅ *${hasil.olt_name}*\n📉 Redaman: *${hasil.redaman}*\n📡 Status: ${hasil.status}`);
                }
            } catch (err) {
                console.error(`Error pada ${olt.label}:`, err.message);
            }
        });

        // Tunggu hingga semua request API selesai
        await Promise.all(axiosPromises);
    }

    // 2. Jalankan Scan Hioso (Berurutan dengan Puppeteer)
    if (puppeteerOlts.length > 0) {
        console.log(`\n🐢 Menjalankan ${puppeteerOlts.length} Hioso secara berurutan...`);
        for (const olt of puppeteerOlts) {
            try {
                const hasil = await cekRedamanHioso(olt, mac);
                
                // JIKA DITEMUKAN, LANGSUNG KIRIM KE BOT WA DETIK ITU JUGA!
                if (hasil && !hasil.error) {
                    foundCount++;
                    await msg.reply(`✅ *${hasil.olt_name}*\n📉 Redaman: *${hasil.redaman}*\n📡 Status: ${hasil.status}`);
                }
            } catch (err) {
                console.error(`Error pada ${olt.label}:`, err.message);
            }
        }
    }

    console.log(`\n========================================`);
    console.log(`✅ SCAN SELESAI!`);
    console.log(`========================================\n`);

    // Mengembalikan status ringkasan ke laporan akhir index.js
    if (foundCount === 0) {
        return '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
    }
    return `🏁 Pemeriksaan semua OLT selesai. Ditemukan total *${foundCount}* data ONU cocok.`;
}
