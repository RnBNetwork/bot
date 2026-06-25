async function scanSemuaOlt(oltList, mac, msg) {
    let foundCount = 0;
    const axiosOlts = oltList.filter(o => o.type === 'HSAirpo');
    const puppeteerOlts = oltList.filter(o => o.type === 'Hioso');

    // 1. Scan HSAirpo
    if (axiosOlts.length > 0) {
        const axiosPromises = axiosOlts.map(async (olt) => {
            try {
                let hasil = olt.method === 'cibarola' ? await cekRedamanHSAirpoCibarola(olt, mac) : await cekRedamanHSAirpoAPI(olt, mac);
                
                // JIKA COCOK, LANGSUNG KIRM CHAT DETIK ITU JUGA TANPA NUNGGU SELESAI SEMUA
                if (hasil && !hasil.error) {
                    foundCount++;
                    await msg.reply(`✅ *${hasil.olt_name}*\n📉 Redaman: *${hasil.redaman}*\n📡 Status: ${hasil.status}`);
                }
            } catch (err) {}
        });
        await Promise.all(axiosPromises);
    }

    // 2. Scan Hioso (Puppeteer)
    if (puppeteerOlts.length > 0) {
        for (const olt of puppeteerOlts) {
            try {
                const hasil = await cekRedamanHioso(olt, mac);
                
                // JIKA COCOK, LANGSUNG KIRIM DETIK ITU JUGA
                if (hasil && !hasil.error) {
                    foundCount++;
                    await msg.reply(`✅ *${hasil.olt_name}*\n📉 Redaman: *${hasil.redaman}*\n📡 Status: ${hasil.status}`);
                }
            } catch (err) {}
        }
    }

    if (foundCount === 0) return '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
    return `🏁 Pemeriksaan semua OLT selesai. Ditemukan total *${foundCount}* data ONU cocok.`;
}
