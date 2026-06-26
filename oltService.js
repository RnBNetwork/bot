// oltService.js - OPTIMIZED MAC MATCH & FAST PUPPETEER
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSAirpo API (Panglejar & Sukamelang)
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (API)...`);
    try {
        // Ambil 10 karakter pertama murni (membuang 2 karakter ujung)
        const cleanTarget = mac.replace(/[:.-]/g, '').toLowerCase().substring(0, 10);
        console.log(`MAC dicari (Murni): ${cleanTarget}`);

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
            const found = onuList.find(x => {
                const rowMac = (x.macaddr || '').replace(/[:.-]/g, '').toLowerCase();
                return rowMac.startsWith(cleanTarget);
            });

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
        console.error(`   ❌ Error: ${error.message}`);
        return { error: error.message };
    }
}

// ==========================================
// 2. HSAirpo CIBAROLA (Axios API)
// ==========================================
async function cekRedamanHSAirpoCibarola(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Cibarola API)...`);
    try {
        // Ambil 10 karakter pertama murni (membuang 2 karakter ujung)
        const cleanTargetMac = mac.replace(/[:.-]/g, '').toLowerCase();
        const matchTarget = cleanTargetMac.substring(0, 10);
        console.log(`MAC dicari (Murni): ${matchTarget}...`);

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
                    const onuMac = (onu.mac || '').replace(/[:.-]/g, '').toLowerCase();
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
// 3. Hioso (Puppeteer) - SELEKTIF POTONG UJUNG MAC
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    // Menghapus semua separator titik dua/strip/titik dan mengambil 10 karakter awal murni (potong 2 karakter di ujung)
    const cleanTargetMac = mac.replace(/[:.-]/g, '').toLowerCase().substring(0, 10);
    
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Puppeteer)...`);
    console.log(`   MAC murni dicari (10 char awal): ${cleanTargetMac}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(20000);
        page.setDefaultNavigationTimeout(20000);

        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        console.log(`   ⏳ Mengakses halaman utama OLT...`);
        
        await page.authenticate({ username: user, password: pass });
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        
        await new Promise(r => setTimeout(r, 1000));

        // ==========================================
        // MODE 1: IFRAME = true (Cibarola & 8Pon)
        // ==========================================
        if (oltConfig.iframe) {
            let leftFrame = null;
            const frames = page.frames();
            leftFrame = frames.find(f => 
                f.name() === 'leftFrame' || 
                f.name() === 'menuFrame' ||
                (f.url() && (f.url().includes('menu') || f.url().includes('left')))
            );
            
            if (!leftFrame) throw new Error('Gagal memuat menu frame');

            try {
                await leftFrame.waitForSelector('a', { timeout: 5000 });
                await leftFrame.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const allOnuLink = links.find(link => 
                        link.innerText.trim() === 'All ONU' || 
                        link.innerText.trim().toLowerCase().includes('all onu')
                    );
                    if (allOnuLink) allOnuLink.click();
                });
            } catch (err) {
                console.log(`   ⚠️ Gagal klik All ONU: ${err.message}`);
            }
            
            await new Promise(r => setTimeout(r, 1200));

            const mainFrames = page.frames();
            let mainFrame = mainFrames.find(f => 
                f.name() === 'mainFrame' || 
                f.name() === 'main' ||
                f.name() === 'content' ||
                (f.url() && f.url().includes('onu'))
            );
            
            if (!mainFrame) throw new Error('Gagal memuat main frame');

            try {
                await mainFrame.evaluate(() => {
                    if (typeof setNumPerPage === 'function') setNumPerPage(300);
                    else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
                });
                await new Promise(r => setTimeout(r, 800));
            } catch (err) {}

            const rxPowerResult = await mainFrame.evaluate((target) => {
                const rows = Array.from(document.querySelectorAll('table tr'));
                for (let row of rows) {
                    const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                    if (cleanRowText.includes(target)) {
                        const rowTextClean = row.innerText.replace(/\s+/g, ' ').trim();
                        const match = rowTextClean.match(/-\d+\.\d+/);
                        return match ? match[0] : null;
                    }
                }
                return null;
            }, cleanTargetMac);

            if (rxPowerResult) {
                console.log(`   ✅ Ditemukan! Redaman: ${rxPowerResult} dBm`);
                return { olt_name: oltConfig.label, mac_onu: mac, redaman: `${rxPowerResult} dBm`, status: 'Online' };
            }

        // ==========================================
        // MODE 2: IFRAME = false (Perum & 4Pon)
        // ==========================================
        } else {
            if (await page.$('#a')) {
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await new Promise(r => setTimeout(r, 1000));
            }

            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await new Promise(r => setTimeout(r, 1000));
            
            let targetFrame = page;
            const frames = page.frames();
            if (frames.length > 1) {
                targetFrame = frames.find(f => f.url().includes('onu')) || frames[1];
            }

            const rxPowerResult = await targetFrame.evaluate((target) => {
                const rows = Array.from(document.querySelectorAll('table tr'));
                for (let row of rows) {
                    const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                    if (cleanRowText.includes(target)) {
                        const cleanRowTextRaw = row.innerText.replace(/\s+/g, ' ').trim();
                        const match = cleanRowTextRaw.match(/(-\d+\.\d+)/);
                        if (match) return match[1];
                    }
                }
                return null;
            }, cleanTargetMac);

            if (rxPowerResult) {
                console.log(`   ✅ Ditemukan! Redaman: ${rxPowerResult} dBm`);
                return { olt_name: oltConfig.label, mac_onu: mac, redaman: `${rxPowerResult} dBm`, status: 'Online' };
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
// 4. SCAN SEMUA OLT
// ==========================================
async function scanSemuaOlt(oltList, mac) {
    console.log(`\n========================================`);
    console.log(`🚀 MULAI SCAN ${oltList.length} OLT...`);
    console.log(`========================================`);
    const hasilAkhir = [];
    const axiosOlts = oltList.filter(o => o.type === 'HSAirpo');
    const puppeteerOlts = oltList.filter(o => o.type === 'Hioso');

    if (axiosOlts.length > 0) {
        const axiosPromises = axiosOlts.map(async (olt) => {
            let hasil = olt.method === 'cibarola' ? await cekRedamanHSAirpoCibarola(olt, mac) : await cekRedamanHSAirpoAPI(olt, mac);
            return { olt, hasil };
        });

        const axiosResults = await Promise.all(axiosPromises);
        axiosResults.forEach(({ olt, hasil }) => {
            if (hasil && !hasil.error) {
                hasilAkhir.push(`\n✅ *${hasil.olt_name}*\n   📉 Redaman: *${hasil.redaman}*\n   📡 Status: ${hasil.status}`);
            } else if (hasil && hasil.error) {
                hasilAkhir.push(`\n⚠️ *${olt.label}*: ${hasil.error}`);
            }
        });
    }

    if (puppeteerOlts.length > 0) {
        for (const olt of puppeteerOlts) {
            const hasil = await cekRedamanHioso(olt, mac);
            if (hasil && !hasil.error) {
                hasilAkhir.push(`\n✅ *${hasil.olt_name}*\n   📉 Redaman: *${hasil.redaman}*\n   📡 Status: ${hasil.status}`);
            } else if (hasil && hasil.error) {
                hasilAkhir.push(`\n⚠️ *${olt.label}*: ${hasil.error}`);
            }
        }
    }

    console.log(`\n========================================`);
    console.log(`✅ SCAN SELESAI!`);
    console.log(`========================================\n`);

    if (hasilAkhir.length === 0) {
        return '⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.';
    }
    return hasilAkhir.join('\n');
}

module.exports = { scanSemuaOlt };
