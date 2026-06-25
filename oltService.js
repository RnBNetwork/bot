// oltService.js - RnBNET BOT (OLT Scanner Service with Real-Time Streaming)
const axios = require('axios');
const puppeteer = require('puppeteer');

/**
 * 1. CEK REDAMAN HS AIRPO CIBAROLA (CONTOH METHOD API)
 */
async function cekRedamanHSAirpoCibarola(olt, mac) {
    try {
        // Sesuaikan dengan URL API, endpoint, payload, atau token OLT HSAirpo Cibarola Anda
        const response = await axios.post(`${olt.host}/api/onu/status`, { mac: mac }, {
            headers: { 'Authorization': `Bearer ${olt.token}` },
            timeout: 10000
        });

        if (response.data && response.data.found) {
            return {
                olt_name: olt.label,
                redaman: response.data.rx_power || '-25.00 dBm',
                status: response.data.status || 'Online',
                error: false
            };
        }
        return null; // Mengembalikan null jika ONU tidak ditemukan di OLT ini
    } catch (err) {
        console.error(`❌ Error API HSAirpo Cibarola (${olt.label}):`, err.message);
        return { olt_name: olt.label, error: true, message: err.message };
    }
}

/**
 * 2. CEK REDAMAN HS AIRPO API GENERAL
 */
async function cekRedamanHSAirpoAPI(olt, mac) {
    try {
        // Sesuaikan URL, parameter, atau basic auth sesuai dengan OLT HSAirpo cabang lain
        const response = await axios.get(`${olt.host}/api/v1/onu`, {
            params: { mac: mac },
            auth: { username: olt.user, password: olt.pass },
            timeout: 10000
        });

        if (response.data && response.data.success && response.data.data) {
            return {
                olt_name: olt.label,
                redaman: response.data.data.onu_rx_power + ' dBm',
                status: response.data.data.phase_state === 'working' ? 'Online' : 'Offline',
                error: false
            };
        }
        return null; // Mengembalikan null jika ONU tidak ditemukan di OLT ini
    } catch (err) {
        console.error(`❌ Error API HSAirpo (${olt.label}):`, err.message);
        return { olt_name: olt.label, error: true, message: err.message };
    }
}

/**
 * 3. CEK REDAMAN HIOSO (PUPPETEER BROWSER AUTOMATION)
 */
async function cekRedamanHioso(olt, mac) {
    let browser;
    try {
        // Jalankan headless browser dengan argument optimal agar hemat CPU & RAM (Anti-Hang)
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(30000);
        
        // 🛑 SILAHKAN SESUAIKAN ALUR SCRAPING DI BAWAH INI DENGAN WEB GUI HIOSO ANDA 🛑
        
        // 1. Menuju Halaman Login
        await page.goto(olt.host, { waitUntil: 'networkidle2' });
        await page.type('#username', olt.user || 'admin');
        await page.type('#password', olt.pass || 'admin');
        await page.click('#login_btn');
        await page.waitForNavigation({ waitUntil: 'networkidle2' });

        // 2. Menuju Halaman Pencarian ONU
        await page.goto(`${olt.host}/onu_search.html`, { waitUntil: 'networkidle2' });
        await page.type('#search_mac', mac);
        await page.click('#search_btn');
        
        // Beri jeda 2 detik agar tabel memuat data dari perangkat
        await new Promise(r => setTimeout(r, 2000)); 

        // 3. Ekstrak Data dari DOM Tabel HTML OLT
        const dataOnu = await page.evaluate(() => {
            const row = document.querySelector('#onu_table tr.datarow'); // Sesuaikan selector ID tabel Anda
            if (!row) return null;
            
            const cols = row.querySelectorAll('td');
            return {
                redaman: cols[4]?.innerText?.trim() || 'Tidak terbaca', // Sesuaikan urutan kolom td
                status: cols[5]?.innerText?.trim() || 'Unknown'
            };
        });

        if (dataOnu) {
            return {
                olt_name: olt.label,
                redaman: dataOnu.redaman,
                status: dataOnu.status,
                error: false
            };
        }
        return null; // Mengembalikan null jika ONU tidak ditemukan di OLT ini
    } catch (err) {
        console.error(`❌ Error Puppeteer Hioso (${olt.label}):`, err.message);
        return { olt_name: olt.label, error: true, message: err.message };
    } finally {
        // Pastikan browser selalu ditutup agar tidak meninggalkan proses 'ghost/zombie' di RAM server
        if (browser) await browser.close();
    }
}

/**
 * 4. FUNGSI UTAMA: SCAN SEMUA OLT (DENGAN REAL-TIME STREAMING KE WHATSAPP)
 * Dipanggil langsung dari index.js di dalam sistem antrean
 */
async function scanSemuaOlt(oltList, mac, msg) {
    console.log(`\n========================================`);
    console.log(`🚀 MULAI SCAN ${oltList.length} OLT...`);
    console.log(`========================================`);
    
    let foundCount = 0;
    const axiosOlts = oltList.filter(o => o.type === 'HSAirpo');
    const puppeteerOlts = oltList.filter(o => o.type === 'Hioso');

    // --- BAGIAN A. JALANKAN SCAN HS AIRPO (PARALEL LEWAT API AXIOS) ---
    if (axiosOlts.length > 0) {
        console.log(`\n⚡ Menjalankan ${axiosOlts.length} HSAirpo secara paralel...`);
        const axiosPromises = axiosOlts.map(async (olt) => {
            try {
                let hasil = null;
                if (olt.method === 'cibarola') {
                    hasil = await cekRedamanHSAirpoCibarola(olt, mac);
                } else {
                    hasil = await cekRedamanHSAirpoAPI(olt, mac);
                }

                // JIKA COCOK, DETIK ITU JUGA LANGSUNG DIKIRIM KE CHAT WA (TANPA MENUNGGU SCAN SELESAI)
                if (hasil && !hasil.error) {
                    foundCount++;
                    await msg.reply(
                        `📌 *OLT DITEMUKAN (Real-time)*\n\n` +
                        `🖥️ *OLT:* ${hasil.olt_name}\n` +
                        `📉 *Redaman:* *${hasil.redaman}*\n` +
                        `📡 *Status:* ${hasil.status}`
                    );
                }
            } catch (err) {
                console.error(`Error pada scan paralel ${olt.label}:`, err.message);
            }
        });

        // Tunggu hingga seluruh request API Axios selesai
        await Promise.all(axiosPromises);
    }

    // --- BAGIAN B. JALANKAN SCAN HIOSO (BERURUTAN LEWAT PUPPETEER) ---
    if (puppeteerOlts.length > 0) {
        console.log(`\n🐢 Menjalankan ${puppeteerOlts.length} Hioso secara berurutan...`);
        for (const olt of puppeteerOlts) {
            try {
                const hasil = await cekRedamanHioso(olt, mac);
                
                // JIKA COCOK, DETIK ITU JUGA LANGSUNG DIKIRIM KE CHAT WA (TANPA MENUNGGU OLT BERIKUTNYA)
                if (hasil && !hasil.error) {
                    foundCount++;
                    await msg.reply(
                        `📌 *OLT DITEMUKAN (Real-time)*\n\n` +
                        `🖥️ *OLT:* ${hasil.olt_name}\n` +
                        `📉 *Redaman:* *${hasil.redaman}*\n` +
                        `📡 *Status:* ${hasil.status}`
                    );
                }
            } catch (err) {
                console.error(`Error pada scan Puppeteer ${olt.label}:`, err.message);
            }
        }
    }

    console.log(`\n========================================`);
    console.log(`✅ SCAN SEMUA OLT SELESAI!`);
    console.log(`========================================\n`);

    // Mengembalikan status ringkasan akhir untuk teks penutup di index.js
    if (foundCount === 0) {
        return '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
    }
    return `🏁 Pemeriksaan selesai. Ditemukan total *${foundCount}* data ONU cocok di lapangan.`;
}

// Export fungsi agar dapat di-require di index.js
module.exports = {
    scanSemuaOlt
};
