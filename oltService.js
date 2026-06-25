// oltService.js - FIXED: HAPUS page.authenticate + DOUBLE LOGIN WEB FORM
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
                { headers: { 'x-token': token }, timeout: 15000 }
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
// 3. Hioso (Puppeteer) - DOUBLE LOGIN WEB FORM
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
        
        // ✅ SMART AUTH: Cek authMethod dari config
        const authMethod = oltConfig.authMethod || 'basic'; // Default: basic
        
        if (authMethod === 'basic') {
            console.log(`   🔐 Menggunakan HTTP Basic Auth...`);
            await page.authenticate({ username: user, password: pass });
        } else {
            console.log(`   🔐 Menggunakan Web Form Login...`);
        }
        
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await new Promise(r => setTimeout(r, 2000));

        // ==========================================
        // MODE 1: IFRAME = true (8Pon & Cibarola) - DOUBLE LOGIN WEB FORM
        // ==========================================
        if (oltConfig.iframe) {
            console.log(`   Mode: Double Login + Iframe`);
            
            // LOGIN PERTAMA (Web Form)
            if (await page.$('#a')) {
                console.log(`   🔑 Login pertama...`);
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 2000));
            }

            // LOGIN KEDUA (Double Login)
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

            // Cari leftFrame
            let leftFrame = null;
            for (let attempt = 1; attempt <= 15; attempt++) {
                const frames = page.frames();
                leftFrame = frames.find(f => 
                    f.name() === 'leftFrame' || 
                    (f.url() && (f.url().includes('menu') || f.url().includes('left')))
                );
                if (leftFrame) break;
                await new Promise(r => setTimeout(r, 1000));
            }
            
            if (!leftFrame) {
                const allFrames = page.frames();
                console.log(`   📋 Frames: ${allFrames.map(f => `"${f.name()}"`).join(', ')}`);
                throw new Error('Gagal memuat menu (leftFrame tidak ditemukan)');
            }
            console.log(`   ✅ leftFrame ditemukan`);

            // Klik All ONU
            await leftFrame.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const allOnuLink = links.find(link => 
                    link.innerText.trim() === 'All ONU' || 
                    link.innerText.trim().toLowerCase().includes('all onu')
                );
                if (allOnuLink) allOnuLink.click();
            }).catch(() => console.log('   ⚠️ Gagal klik All ONU'));
            
            await new Promise(r => setTimeout(r, 4000));

            // Cari mainFrame
            let mainFrame = null;
            for (let attempt = 1; attempt <= 15; attempt++) {
                const frames = page.frames();
                mainFrame = frames.find(f => 
                    f.name() === 'mainFrame' || 
                    (f.url() && f.url().includes('onu'))
                );
                if (mainFrame) break;
                await new Promise(r => setTimeout(r, 1000));
            }
            
            if (!mainFrame) throw new Error('Gagal memuat tabel (mainFrame tidak ditemukan)');
            console.log(`   ✅ mainFrame ditemukan`);

            console.log(`   ⏳ Menunggu data tabel dimuat...`);
            await mainFrame.waitForSelector('table tr', { timeout: 30000 });

            await mainFrame.evaluate(() => {
                if (typeof setNumPerPage === 'function') setNumPerPage(300);
                else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
            }).catch(() => {});
            
            await new Promise(r => setTimeout(r, 3000));

            const rxPowerResult = await mainFrame.evaluate((macToFind) => {
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
                console.log(`   ✅ Ditemukan! Redaman: ${rxPowerResult} dBm`);
                return { 
                    olt_name: oltConfig.label, 
                    mac_onu: searchMac, 
                    redaman: `${rxPowerResult} dBm`, 
                    status: 'Online' 
                };
            }

        // ==========================================
        // MODE B: IFRAME = false (4Pon & Perum) - SINGLE LOGIN + DIRECT URL
        // ==========================================
        } else {
            console.log(`   Mode: Single Login + Direct URL`);
            
            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 3000));
            
            let targetFrame = page;
            const frames = page.frames();
            if (frames.length > 1) {
                targetFrame = frames.find(f => f.url().includes('onu')) || frames[1];
                console.log(`   ✅ Frame ditemukan: ${frames.length} frames`);
            }

            console.log(`   ⏳ Menunggu data tabel dimuat...`);
            await targetFrame.waitForSelector('table tr', { timeout: 30000 });

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
        console.log(`\n⚡ Menjalankan ${axiosOlts.length} HSAirpo secara paralel...`);
        const axiosPromises = axiosOlts.map(async (olt) => {
            let hasil = null;
            if (olt.method === 'cibarola') {
                hasil = await cekRedamanHSAirpoCibarola(olt, mac);
            } else {
                hasil = await cekRedamanHSAirpoAPI(olt, mac);
            }
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
        console.log(`\n🐢 Menjalankan ${puppeteerOlts.length} Hioso secara berurutan...`);
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
