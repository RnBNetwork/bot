// oltService.js - STREAMING + SMART RETRY VERSION
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSAirpo API (Panglejar & Sukamelang)
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (API)...`);
    try {
        const searchMac = mac.substring(0, 16);
        console.log(`   MAC dicari: ${searchMac}`);

        const username = oltConfig.user || 'root';
        const password = oltConfig.pass || 'admin';
        const key = crypto.createHash('md5').update(`${username}:${password}`).digest('hex');
        const value = Buffer.from(password).toString('base64');

        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`,
            { method: "set", param: { name: username, key, value, captcha_v: " ", captcha_f: " " } },
            { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-token': 'null' }, timeout: 10000 }
        );

        if (loginRes.data.code !== 1) throw new Error(`Login gagal: ${loginRes.data.message}`);
        const token = loginRes.headers['x-token'];

        for (let port = 1; port <= 16; port++) {
            const res = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`,
                { headers: { 'x-token': token }, timeout: 5000 }
            );
            const onuList = res.data.data || [];
            const found = onuList.find(x => x.macaddr && x.macaddr.toLowerCase().startsWith(searchMac.toLowerCase()));

            if (found) {
                console.log(`   ✅ Ditemukan di PON ${port}: ${found.macaddr}`);
                let redaman = found.receive_power || 'N/A';
                if (redaman !== 'N/A' && !String(redaman).includes('dBm')) redaman = `${redaman} dBm`;
                return { olt_name: `${oltConfig.label} (PON ${port})`, mac_onu: found.macaddr, redaman, status: found.status || 'Online' };
            }
        }
        console.log(`   ❌ Tidak ditemukan di semua port`);
        return null;
    } catch (error) {
        console.error(`    Error: ${error.message}`);
        return { error: error.message };
    }
}

// ==========================================
// 2. HSAirpo CIBAROLA (Axios API)
// ==========================================
async function cekRedamanHSAirpoCibarola(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Cibarola API)...`);
    try {
        const cleanTargetMac = mac.replace(/[:.-]/g, '').toLowerCase();
        const matchTarget = cleanTargetMac.substring(0, 11);
        console.log(`   MAC dicari: ${matchTarget}...`);

        const passwordBase64 = Buffer.from(oltConfig.pass || 'admin').toString('base64');
        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/login/Auth`,
            { userName: oltConfig.user || 'admin', password: passwordBase64 },
            { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000 }
        );

        if (loginRes.data.errCode !== 'success') throw new Error('Login gagal');

        const cookies = loginRes.headers['set-cookie'];
        let sessionCookie = '';
        if (cookies) {
            sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
        }

        const totalPon = oltConfig.total_pon || 4;
        for (let i = 1; i <= totalPon; i++) {
            const ponPort = `pon${i}`;
            const opticalRes = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/goform/getPortOnuOptical?${Math.random()}&PonPortName=${ponPort}`,
                { headers: { 'Cookie': sessionCookie, 'X-Requested-With': 'XMLHttpRequest' }, timeout: 15000 }
            );

            let jsonData = opticalRes.data;
            if (typeof jsonData === 'string') {
                try { jsonData = JSON.parse(jsonData); } catch (e) {}
            }

            if (jsonData && jsonData.list) {
                const found = jsonData.list.find(onu => {
                    const onuMac = (onu.mac || '').replace(/\./g, '').toLowerCase();
                    return onuMac.startsWith(matchTarget);
                });

                if (found) {
                    console.log(`   ✅ Ditemukan di ${ponPort.toUpperCase()}: ${found.mac}`);
                    let redaman = found.rxpower || 'N/A';
                    if (redaman !== 'N/A' && !String(redaman).includes('dBm')) redaman = `${redaman} dBm`;
                    return { olt_name: `${oltConfig.label} (${ponPort.toUpperCase()})`, mac_onu: found.mac, redaman, status: 'Online' };
                }
            }
        }
        console.log(`   ❌ Tidak ditemukan di semua PON`);
        return null;
    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    }
}

// ==========================================
// 3. Hioso (Puppeteer) - SMART RETRY
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    let searchMac = mac.substring(0, 16);
    if (oltConfig.label.includes('Cibarola') || oltConfig.label.includes('8Pon')) {
        searchMac = mac.substring(0, 15);
    }
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Puppeteer)...`);
    console.log(`   MAC dicari: ${searchMac} (Panjang: ${searchMac.length})`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);

        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        console.log(`   ⏳ Mengakses halaman utama OLT...`);
        await page.authenticate({ username: user, password: pass });
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        console.log(`   ✅ HTTP Basic Auth sukses`);
        await new Promise(r => setTimeout(r, 3000));

        // ==========================================
        // MODE A: IFRAME = true (Cibarola & 8Pon)
        // ==========================================
        if (oltConfig.iframe) {
            console.log(`   Mode: Double Login + Iframe`);

            // LOGIN PERTAMA
            if (await page.$('#a')) {
                console.log(`   🔑 Login pertama...`);
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 2000));
            }

            // LOGIN KEDUA (DOUBLE LOGIN)
            if (await page.$('#a')) {
                console.log(`   🔑 Login kedua (Double Login)...`);
                await page.evaluate(() => {
                    document.querySelector('#a').value = '';
                    document.querySelector('#b').value = '';
                });
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 3000));
            }

            // CARI leftFrame (RETRY AGRESIF)
            let leftFrame = null;
            for (let attempt = 1; attempt <= 20; attempt++) {
                const frames = page.frames();
                leftFrame = frames.find(f =>
                    f.name() === 'leftFrame' ||
                    f.name() === 'menuFrame' ||
                    (f.url() && (f.url().includes('menu') || f.url().includes('left')))
                );
                if (leftFrame) {
                    console.log(`   ✅ leftFrame ditemukan di attempt ${attempt}`);
                    break;
                }
                console.log(`    Mencari leftFrame... attempt ${attempt}/20`);
                await new Promise(r => setTimeout(r, 2000));
            }

            if (!leftFrame) {
                throw new Error('Gagal memuat menu (leftFrame tidak ditemukan)');
            }

            // KLIK All ONU
            try {
                await leftFrame.waitForSelector('a', { timeout: 10000 });
                await leftFrame.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const allOnuLink = links.find(link =>
                        link.innerText.trim() === 'All ONU' ||
                        link.innerText.trim().toLowerCase().includes('all onu')
                    );
                    if (allOnuLink) allOnuLink.click();
                });
                console.log(`   ✅ Klik All ONU sukses`);
            } catch (err) {
                console.log(`   ⚠️ Gagal klik All ONU: ${err.message}`);
            }

            // ✅ TUNGGU 5 DETIK SETELAH KLIK ALL ONU
            console.log(`   ⏳ Menunggu 5 detik setelah klik All ONU...`);
            await new Promise(r => setTimeout(r, 5000));

            // CARI mainFrame
            let mainFrame = null;
            for (let attempt = 1; attempt <= 20; attempt++) {
                const frames = page.frames();
                mainFrame = frames.find(f =>
                    f.name() === 'mainFrame' ||
                    f.name() === 'main' ||
                    f.name() === 'content' ||
                    (f.url() && f.url().includes('onu'))
                );
                if (mainFrame) {
                    console.log(`   ✅ mainFrame ditemukan di attempt ${attempt}`);
                    break;
                }
                console.log(`   ⏳ Mencari mainFrame... attempt ${attempt}/20`);
                await new Promise(r => setTimeout(r, 2000));
            }

            if (!mainFrame) {
                throw new Error('Gagal memuat tabel (mainFrame tidak ditemukan)');
            }

            // TUNGGU TABEL DIMUAT
            console.log(`   ⏳ Menunggu data tabel dimuat...`);
            try {
                await mainFrame.waitForSelector('table tr', { timeout: 20000 });
            } catch (err) {
                console.log(`   ⚠️ Tabel belum muncul, coba reload...`);
                try {
                    await mainFrame.evaluate(() => location.reload());
                    await new Promise(r => setTimeout(r, 5000));
                } catch (e) {}
            }

            // UBAH LIMIT TABEL
            try {
                await mainFrame.evaluate(() => {
                    if (typeof setNumPerPage === 'function') setNumPerPage(300);
                    else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
                });
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {}

            // ✅ SMART RETRY: CARI MAC SAMPAI KETEMU (MAX 10X RETRY, INTERVAL 3 DETIK)
            console.log(`   🔍 Mulai pencarian MAC (Smart Retry sampai ketemu)...`);
            let rxPowerResult = null;
            const MAX_RETRY = 10;

            for (let retry = 1; retry <= MAX_RETRY; retry++) {
                rxPowerResult = await mainFrame.evaluate((macToFind) => {
                    const cleanTarget = macToFind.replace(/[:.-]/g, '').toLowerCase();
                    const rows = Array.from(document.querySelectorAll('table tr'));

                    for (let row of rows) {
                        const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                        if (cleanRowText.includes(cleanTarget)) {
                            const rowTextClean = row.innerText.replace(/\s+/g, ' ').trim();
                            const rxPattern = /-\d+\.\d+/;
                            const match = rowTextClean.match(rxPattern);
                            return match ? match[0] : null;
                        }
                    }
                    return null;
                }, searchMac);

                if (rxPowerResult) {
                    console.log(`   ✅ Ditemukan pada percobaan ke-${retry}! Redaman: ${rxPowerResult} dBm`);
                    break;
                } else {
                    console.log(`   ⏳ MAC belum muncul, menunggu 3 detik dan coba lagi (${retry}/${MAX_RETRY})...`);
                    await new Promise(r => setTimeout(r, 3000));
                }
            }

            if (rxPowerResult) {
                return {
                    olt_name: oltConfig.label,
                    mac_onu: searchMac,
                    redaman: `${rxPowerResult} dBm`,
                    status: 'Online'
                };
            }

        // ==========================================
        // MODE B: IFRAME = false (Perum & 4Pon)
        // ==========================================
        } else {
            console.log(`   Mode: Single Login + Direct URL`);

            await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 3000));

            if (await page.$('#a')) {
                console.log(`   🔑 Mengisi form login web...`);
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 3000));
            }

            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 3000));

            let targetFrame = page;
            const frames = page.frames();
            if (frames.length > 1) {
                targetFrame = frames.find(f => f.url().includes('onu')) || frames[1];
            }

            console.log(`   ⏳ Menunggu data tabel dimuat...`);
            try {
                await targetFrame.waitForSelector('table tr', { timeout: 20000 });
            } catch (err) {
                console.log(`   ⚠️ Tabel tidak ditemukan: ${err.message}`);
            }

            const rxPowerResult = await targetFrame.evaluate((macToFind) => {
                const cleanTarget = macToFind.replace(/[:-]/g, '').toLowerCase();
                const rows = Array.from(document.querySelectorAll('table tr'));

                for (let row of rows) {
                    const rowText = row.innerText.replace(/[:-]/g, '').toLowerCase();
                    if (rowText.includes(cleanTarget)) {
                        const cleanRowText = row.innerText.replace(/\s+/g, ' ').trim();
                        const rxPattern = /\s(-\d+\.\d+)\s/;
                        const match = cleanRowText.match(rxPattern);
                        if (match) return match[1];
                    }
                }
                return null;
            }, searchMac);

            if (rxPowerResult) {
                console.log(`   ✅ Ditemukan! Redaman: ${rxPowerResult} dBm`);
                return {
                    olt_name: oltConfig.label,
                    mac_onu: searchMac,
                    redaman: `${rxPowerResult} dBm`,
                    status: 'Online'
                };
            }
        }

        console.log(`   ❌ Tidak ditemukan di tabel`);
        return null;

    } catch (error) {
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    } finally {
        await browser.close();
    }
}

// ==========================================
// 4. SCAN SEMUA OLT (DENGAN CALLBACK STREAMING)
// ==========================================
async function scanSemuaOlt(oltList, mac, onFoundCallback) {
    console.log(`\n========================================`);
    console.log(`🚀 MULAI SCAN ${oltList.length} OLT...`);
    console.log(`========================================`);

    const axiosOlts = oltList.filter(o => o.type === 'HSAirpo');
    const puppeteerOlts = oltList.filter(o => o.type === 'Hioso');

    // 1. Scan HSAirpo (Cepat & Paralel)
    if (axiosOlts.length > 0) {
        console.log(`\n⚡ Menjalankan ${axiosOlts.length} HSAirpo secara paralel...`);
        const axiosPromises = axiosOlts.map(async (olt) => {
            let hasil = null;
            if (olt.method === 'cibarola') {
                hasil = await cekRedamanHSAirpoCibarola(olt, mac);
            } else {
                hasil = await cekRedamanHSAirpoAPI(olt, mac);
            }

            // 🚀 LANGSUNG KIRIM KE WA JIKA SUKSES
            if (hasil && !hasil.error && onFoundCallback) {
                const text = `✅ *${hasil.olt_name}*\n📉 Redaman: *${hasil.redaman}*\n Status: ${hasil.status}`;
                await onFoundCallback(text);
            }
            return { olt, hasil };
        });
        await Promise.all(axiosPromises);
    }

    // 2. Scan Hioso (Lambat & Berurutan)
    if (puppeteerOlts.length > 0) {
        console.log(`\n🐢 Menjalankan ${puppeteerOlts.length} Hioso secara berurutan...`);
        for (const olt of puppeteerOlts) {
            const hasil = await cekRedamanHioso(olt, mac);

            // 🚀 LANGSUNG KIRIM KE WA JIKA SUKSES
            if (hasil && !hasil.error && onFoundCallback) {
                const text = `✅ *${hasil.olt_name}*\n📉 Redaman: *${hasil.redaman}*\n📡 Status: ${hasil.status}`;
                await onFoundCallback(text);
            }
        }
    }

    console.log(`\n========================================`);
    console.log(`✅ SCAN SELESAI!`);
    console.log(`========================================\n`);
}

module.exports = { scanSemuaOlt };
