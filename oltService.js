// oltService.js - ULTRA FAST & ACCURATE MAC SEARCH
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSAirpo API (Panglejar & Sukamelang)
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    try {
        const cleanTarget = mac.replace(/[:.-]/g, '').toLowerCase().substring(0, 12);
        const username = oltConfig.user || 'root';
        const password = oltConfig.pass || 'admin';
        const key = crypto.createHash('md5').update(`${username}:${password}`).digest('hex');
        const value = Buffer.from(password).toString('base64');

        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/userlogin?form=login`,
            { method: "set", param: { name: username, key, value, captcha_v: " ", captcha_f: " " } },
            { headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-token': 'null' }, timeout: 6000 }
        );

        if (loginRes.data.code !== 1) return null;
        const token = loginRes.headers['x-token'];

        for (let port = 1; port <= 16; port++) {
            const res = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/onu_allow_list?port_id=${port}`,
                { headers: { 'x-token': token }, timeout: 4000 }
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
        const cleanTarget = mac.replace(/[:.-]/g, '').toLowerCase().substring(0, 11);
        const passwordBase64 = Buffer.from(oltConfig.pass || 'admin').toString('base64');
        const loginRes = await axios.post(
            `http://${oltConfig.ip}:${oltConfig.port}/login/Auth`,
            { userName: oltConfig.user || 'admin', password: passwordBase64 },
            { headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' }, timeout: 6000 }
        );

        if (loginRes.data.errCode !== 'success') return null;

        const cookies = loginRes.headers['set-cookie'];
        let sessionCookie = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';

        const totalPon = oltConfig.total_pon || 4;
        for (let i = 1; i <= totalPon; i++) {
            const opticalRes = await axios.get(
                `http://${oltConfig.ip}:${oltConfig.port}/goform/getPortOnuOptical?${Math.random()}&PonPortName=pon${i}`,
                { headers: { 'Cookie': sessionCookie, 'X-Requested-With': 'XMLHttpRequest' }, timeout: 6000 }
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
// 3. HIOSO PUPPETEER (ANTI LEWAT + ULTRA FAST)
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    const cleanTargetMac = mac.replace(/[:.-]/g, '').toLowerCase().substring(0, 12);
    
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        const page = await browser.newPage();
        // Kurangi timeout agar respon kirim ke bot tidak lambat jika OLT mati
        page.setDefaultTimeout(10000);
        page.setDefaultNavigationTimeout(10000);

        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        await page.authenticate({ username: user, password: pass });
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 8000 });
        
        // Pangkas waktu tunggu buatan dari 3 detik menjadi 1 detik saja (Mempercepat eksekusi)
        await new Promise(r => setTimeout(r, 1000));

        if (oltConfig.iframe) {
            let leftFrame = null;
            const frames = page.frames();
            leftFrame = frames.find(f => f.name() === 'leftFrame' || f.name() === 'menuFrame' || (f.url() && f.url().includes('menu')));
            if (!leftFrame) throw new Error('No Frame');

            await leftFrame.waitForSelector('a', { timeout: 3000 });
            await leftFrame.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                const allOnuLink = links.find(l => l.innerText.trim() === 'All ONU' || l.innerText.trim().toLowerCase().includes('all onu'));
                if (allOnuLink) allOnuLink.click();
            });
            
            await new Promise(r => setTimeout(r, 1200));

            const mainFrames = page.frames();
            let mainFrame = mainFrames.find(f => f.name() === 'mainFrame' || f.name() === 'main' || (f.url() && f.url().includes('onu')));
            if (!mainFrame) throw new Error('No Main Frame');

            // Set size 300 secepatnya agar melompati pagination data
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
                        const match = row.innerText.replace(/\s+/g, ' ').trim().match(/-\d+\.\d+/);
                        return match ? match[0] : null;
                    }
                }
                return null;
            }, cleanTargetMac);

            if (rxPowerResult) {
                return { olt_name: oltConfig.label, redaman: `${rxPowerResult} dBm`, status: 'Online' };
            }

        } else {
            if (await page.$('#a')) {
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await new Promise(r => setTimeout(r, 1000));
            }

            await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { waitUntil: 'domcontentloaded', timeout: 8000 });
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
                        const match = row.innerText.replace(/\s+/g, ' ').trim().match(/(-\d+\.\d+)/);
                        return match ? match[1] : null;
                    }
                }
                return null;
            }, cleanTargetMac);

            if (rxPowerResult) {
                return { olt_name: oltConfig.label, redaman: `${rxPowerResult} dBm`, status: 'Online' };
            }
        }
        return null;
    } catch (error) {
        return null;
    } finally {
        await browser.close();
    }
}

// ==========================================
// 4. SCAN SEMUA OLT WITH CONCURRENCY
// ==========================================
async function scanSemuaOlt(oltList, mac) {
    const hasilAkhir = [];
    const axiosOlts = oltList.filter(o => o.type === 'HSAirpo');
    const puppeteerOlts = oltList.filter(o => o.type === 'Hioso');

    // HS Airpo berjalan secara paralel cepat
    if (axiosOlts.length > 0) {
        const axiosPromises = axiosOlts.map(async (olt) => {
            let hasil = olt.method === 'cibarola' ? await cekRedamanHSAirpoCibarola(olt, mac) : await cekRedamanHSAirpoAPI(olt, mac);
            if (hasil) {
                hasilAkhir.push(`🖥️ *OLT:* ${hasil.olt_name}\n📉 *Redaman:* *${hasil.redaman}*\n📡 *Status:* ${hasil.status}`);
            }
        });
        await Promise.all(axiosPromises);
    }

    // Hioso berjalan sekuensial namun dengan delay terpangkas habis
    if (puppeteerOlts.length > 0) {
        for (const olt of puppeteerOlts) {
            const hasil = await cekRedamanHioso(olt, mac);
            if (hasil) {
                hasilAkhir.push(`🖥️ *OLT:* ${hasil.olt_name}\n📉 *Redaman:* *${hasil.redaman}*\n📡 *Status:* ${hasil.status}`);
            }
        }
    }

    return hasilAkhir.length === 0 ? '⚠️ ONU tidak ditemukan' : hasilAkhir.join('\n\n');
}

module.exports = { scanSemuaOlt };
