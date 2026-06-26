// oltService.js - RnBNET STABLE VERSION WITH CLEAN EXTRAC FOR ALL HIOSO & HSAIRPO
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSAirpo API
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    try {
        const cleanTarget = mac.replace(/[:.-]/g, '').toLowerCase().substring(0, 10);
        const username = oltConfig.user || 'root';
        const password = oltConfig.pass || 'admin';
        const key = crypto.createHash('md5').update(`${username}:${password}`).digest('hex');
        const value = Buffer.from(password).toString('base64');

        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`,
            { method: "set", param: { name: username, key, value, captcha_v: " ", captcha_f: " " } },
            { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-token': 'null' }, timeout: 10000 }
        );

        if (loginRes.data.code !== 1) return null;
        const token = loginRes.headers['x-token'];

        for (let port = 1; port <= 16; port++) {
            const res = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`,
                { headers: { 'x-token': token }, timeout: 5000 }
            ).catch(() => null);
            
            if (!res) continue;
            const onuList = res.data.data || [];
            const found = onuList.find(x => {
                const rowMac = (x.macaddr || '').replace(/[:.-]/g, '').toLowerCase();
                return rowMac.startsWith(cleanTarget);
            });

            if (found) {
                let redaman = found.receive_power || 'N/A';
                if (redaman !== 'N/A' && !String(redaman).includes('dBm')) redaman = `${redaman} dBm`;
                return { olt_name: `${oltConfig.label} (PON ${port})`, redaman, status: found.status || 'Online' };
            }
        }
        return null;
    } catch (error) {
        return null;
    }
}

// ==========================================
// 2. HSAirpo CIBAROLA (Axios API)
// ==========================================
async function cekRedamanHSAirpoCibarola(oltConfig, mac) {
    try {
        const cleanTarget = mac.replace(/[:.-]/g, '').toLowerCase().substring(0, 10);
        const passwordBase64 = Buffer.from(oltConfig.pass || 'admin').toString('base64');
        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/login/Auth`,
            { userName: oltConfig.user || 'admin', password: passwordBase64 },
            { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 10000 }
        );

        if (loginRes.data.errCode !== 'success') return null;

        const cookies = loginRes.headers['set-cookie'];
        let sessionCookie = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';

        const totalPon = oltConfig.total_pon || 4;
        for (let i = 1; i <= totalPon; i++) {
            const opticalRes = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/goform/getPortOnuOptical?${Math.random()}&PonPortName=pon${i}`,
                { headers: { 'Cookie': sessionCookie, 'X-Requested-With': 'XMLHttpRequest' }, timeout: 15000 }
            ).catch(() => null);

            if (!opticalRes) continue;
            let jsonData = opticalRes.data;
            if (typeof jsonData === 'string') {
                try { jsonData = JSON.parse(jsonData); } catch (e) {}
            }

            if (jsonData && jsonData.list) {
                const found = jsonData.list.find(onu => {
                    const onuMac = (onu.mac || '').replace(/[:.-]/g, '').toLowerCase();
                    return onuMac.startsWith(cleanTarget);
                });

                if (found) {
                    let redaman = found.rxpower || 'N/A';
                    if (redaman !== 'N/A' && !String(redaman).includes('dBm')) redaman = `${redaman} dBm`;
                    return { olt_name: `${oltConfig.label} (PON ${i})`, redaman, status: 'Online' };
                }
            }
        }
        return null;
    } catch (error) {
        return null;
    }
}

// ==========================================
// 3. HIOSO PUPPETEER (CLEAN & ROBUST)
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    const cleanTargetMac = mac.replace(/[:.-]/g, '').toLowerCase().substring(0, 10);
    
    console.log(`\n🔍 [${oltConfig.label}] Memulai pemindaian via Puppeteer...`);
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    let page;
    let finalResultData = null;

    try {
        page = await browser.newPage();
        page.setDefaultTimeout(30000); // Batasi timeout 30 detik agar tidak hang lama
        page.setDefaultNavigationTimeout(30000);

        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        // Pembeda Jalur Menggunakan File Config Asli Anda (config.iframe)
        if (oltConfig.iframe) {
            // Jalur Sukamelang, 8Pon, Cibarola (HTTP Basic Auth + Iframe)
            await page.authenticate({ username: user, password: pass });
            await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
            await new Promise(r => setTimeout(r, 2000));

            const frames = page.frames();
            let leftFrame = frames.find(f => f.name() === 'leftFrame' || f.name() === 'menuFrame' || f.url().includes('menu'));
            if (leftFrame) {
                await leftFrame.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const allOnuLink = links.find(link => link.innerText.trim().toLowerCase().includes('all onu'));
                    if (allOnuLink) allOnuLink.click();
                }).catch(() => null);
                await new Promise(r => setTimeout(r, 2000));
            }

            let mainFrame = page.frames().find(f => f.name() === 'mainFrame' || f.name() === 'main' || f.url().includes('onu'));
            let targetContext = mainFrame || page;

            const rxPowerResult = await targetContext.evaluate((target) => {
                const rows = Array.from(document.querySelectorAll('table tr'));
                for (let row of rows) {
                    if (row.innerText.replace(/[:.-]/g, '').toLowerCase().includes(target)) {
                        // Cari angka minus yang merupakan ciri khas redaman optik
                        const match = row.innerText.match(/-\d+\.\d+/);
                        return match ? match[0] : null;
                    }
                }
                return null;
            }, cleanTargetMac);

            if (rxPowerResult) {
                finalResultData = { olt_name: oltConfig.label, redaman: `${rxPowerResult} dBm`, status: 'Online' };
            }
        } else {
            // Jalur Perum (Web Form Login)
            await page.goto(baseUrl, { waitUntil: 'networkidle2' });
            if (await page.$('#a')) {
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await new Promise(r => setTimeout(r, 2000));
            }

            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'networkidle2' });
            const rxPowerResult = await page.evaluate((target) => {
                const rows = Array.from(document.querySelectorAll('table tr'));
                for (let row of rows) {
                    if (row.innerText.replace(/[:.-]/g, '').toLowerCase().includes(target)) {
                        const match = row.innerText.match(/-\d+\.\d+/);
                        return match ? match[0] : null;
                    }
                }
                return null;
            }, cleanTargetMac);

            if (rxPowerResult) {
                finalResultData = { olt_name: oltConfig.label, redaman: `${rxPowerResult} dBm`, status: 'Online' };
            }
        }

    } catch (error) {
        console.error(`❌ Error OLT [${oltConfig.label}]: ${error.message}`);
    } finally {
        if (browser) {
            await browser.close().catch(() => null);
        }
        return finalResultData;
    }
}

// ==========================================
// 4. SCAN SEMUA OLT
// ==========================================
async function scanSemuaOlt(oltList, mac, msg, userObj, targetServer) {
    let ditemukan = false;
    const axiosOlts = oltList.filter(o => o.type === 'HSAirpo');
    const puppeteerOlts = oltList.filter(o => o.type === 'Hioso');

    // 1. Eksekusi HSAirpo API (Cepat)
    if (axiosOlts.length > 0) {
        const axiosPromises = axiosOlts.map(async (olt) => {
            let hasil = olt.method === 'cibarola' ? await cekRedamanHSAirpoCibarola(olt, mac) : await cekRedamanHSAirpoAPI(olt, mac);
            if (hasil) {
                ditemukan = true;
                await msg.reply(`📌 *HASIL CEK REDAMAN OLT*\n\n👤 Pelanggan: ${userObj.name}\n💻 Server: ${targetServer.label}\n🔒 MAC: \`${mac}\`\n\n🖥️ OLT: ${hasil.olt_name}\n📉 Redaman: *${hasil.redaman}*\n📡 Status: ${hasil.status}`).catch(() => null);
            }
        });
        await Promise.all(axiosPromises);
    }

    // 2. Eksekusi Hioso Puppeteer Satu per Satu (Mencegah Crash Browser)
    if (puppeteerOlts.length > 0) {
        for (const olt of puppeteerOlts) {
            const hasil = await cekRedamanHioso(olt, mac);
            if (hasil) {
                ditemukan = true;
                await msg.reply(`📌 *HASIL CEK REDAMAN OLT*\n\n👤 Pelanggan: ${userObj.name}\n💻 Server: ${targetServer.label}\n🔒 MAC: \`${mac}\`\n\n🖥️ OLT: ${hasil.olt_name}\n📉 Redaman: *${hasil.redaman}*\n📡 Status: ${hasil.status}`).catch(() => null);
            }
        }
    }
    return ditemukan;
}

module.exports = { scanSemuaOlt };
