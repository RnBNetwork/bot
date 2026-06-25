// Ganti fungsi cekRedamanHioso di dalam oltService.js dengan ini:
async function cekRedamanHioso(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Menyisir kilat via URL Direct: /m/onu_all_onu.htm`);
    let browser;
    try {
        // Normalisasi MAC: hilangkan tanda titik/titik dua/strip agar murni alphanumeric (contoh: aabbccddeeff)
        const cleanSearchMac = mac.replace(/[^a-f0-9]/gi, '').toLowerCase(); 

        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        
        const page = await browser.newPage();
        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;

        // 1. Jalur Tol: Tetap login ke halaman utama untuk mendapatkan Cookie/Session Auth
        await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 10000 });
        
        // Isi form login Hioso secara otomatis
        await page.type('input[type="text"], input[name*="user"]', oltConfig.user || 'admin');
        await page.type('input[type="password"], input[name*="pass"]', oltConfig.pass || 'admin');
        
        // Klik Login dan tunggu navigasi selesai
        await Promise.all([
            page.click('input[type="submit"], input[type="button"], button'),
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {})
        ]);

        // 2. TEMBAK LANGSUNG KE URL ALL ONU (Rekomendasi Anda)
        console.log(`🚀 Tembak langsung target: ${baseUrl}/m/onu_all_onu.htm`);
        await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'networkidle0', timeout: 15000 });

        // 3. Ambil isi tabel dan cari baris yang mengandung MAC pelanggan
        const dataOnu = await page.evaluate((searchMac) => {
            const rows = Array.from(document.querySelectorAll('tr'));
            
            for (const row of rows) {
                // Bersihkan text satu baris penuh dari karakter non-hex untuk pencarian yang akurat
                const rowTextClean = row.innerText.toLowerCase().replace(/[^a-f0-9]/g, '');
                
                if (rowTextClean.includes(searchMac)) {
                    // Jika baris MAC COCOK, ambil seluruh teks kolom (td) di baris tersebut
                    return Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
                }
            }
            return null;
        }, cleanSearchMac);

        // Jika MAC tidak ditemukan di tabel OLT ini
        if (!dataOnu) {
            return { olt_name: oltConfig.label, error: 'MAC tidak ditemukan di OLT ini' };
        }

        // 4. Ekstrak Nilai Redaman (Rx Power) & Status dari Baris Kolom Hioso
        let redaman = 'Tidak terbaca';
        let status = 'Online 🟢';

        for (const col of dataOnu) {
            // Hioso biasanya mencantumkan redaman dengan satuan "dBm" atau angka minus desimal (ex: -23.45)
            if (col.includes('dBm') || (col.startsWith('-') && col.includes('.'))) {
                redaman = col;
            }
            // Cek jika statusnya offline / down
            if (col.toLowerCase().includes('offline') || col.toLowerCase().includes('down') || col.toLowerCase().includes('lose')) {
                status = 'Offline 🔴';
            }
        }

        return {
            olt_name: oltConfig.label,
            redaman: redaman,
            status: status
        };

    } catch (err) {
        console.error(`❌ Error Hioso [${oltConfig.label}]:`, err.message);
        return { olt_name: oltConfig.label, error: `Gagal akses OLT (${err.message})` };
    } finally {
        if (browser) await browser.close();
    }
}
