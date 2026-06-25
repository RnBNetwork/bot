// oltService.js - 100% CLEAN & FIXED VERSION (UNIVERSAL & ROBUST MATCHING)
const axios = require('axios');
const crypto = require('crypto');
const puppeteer = require('puppeteer');

// ==========================================
// 1. HSAirpo API (Panglejar & Sukamelang)
// ==========================================
async function cekRedamanHSAirpoAPI(oltConfig, mac) {
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (API)...`);
    try {
        const cleanTargetMac = mac.replace(/[:.-]/g, '').toLowerCase().trim();
        console.log(`MAC dicari: ${cleanTargetMac}`);

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
                const onuMacClean = (x.macaddr || '').replace(/[:.-]/g, '').toLowerCase();
                return onuMacClean.startsWith(cleanTargetMac) || cleanTargetMac.startsWith(onuMacClean);
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
        const cleanTargetMac = mac.replace(/[:.-]/g, '').toLowerCase().trim();
        const matchTarget = cleanTargetMac.substring(0, 11);
        console.log(`MAC dicari: ${matchTarget}...`);

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
// 3. Hioso (Puppeteer Normal Navigation)
// ==========================================
async function cekRedamanHioso(oltConfig, mac) {
    // Membersihkan MAC secara menyeluruh (Bebas dari bug potong string)
    const cleanTargetMac = mac.replace(/[:.-]/g, '').toLowerCase().trim();
    
    console.log(`\n🔍 [${oltConfig.label}] Mulai cek (Puppeteer)...`);
    console.log(`   MAC dicari (Alfanumerik): ${cleanTargetMac}`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(35000);
        page.setDefaultNavigationTimeout(35000);

        const baseUrl = `http://${oltConfig.ip}:${oltConfig.port}`;
        const user = oltConfig.user || 'admin';
        const pass = oltConfig.pass || 'admin';

        console.log(`   ⏳ Mengakses halaman utama OLT...`);
        
        // ✅ HTTP Basic Auth Utama
        await page.authenticate({ username: user, password: pass });
        
        // Menggunakan catch internal & perpanjang toleransi waktu muat OLT yang lambat
        await page.goto(baseUrl, { timeout: 30000 }).catch(e => console.log(`   ⚠️ Info Navigasi: ${e.message}`));
        await new Promise(r => setTimeout(r, 4000));

        let targetFrame = page;

        // ==========================================
        // MODE 1: IFRAME = true (Cibarola & 8Pon Sukamelang)
        // ==========================================
        if (oltConfig.iframe) {
            console.log(`   Mode OLT: Struktur Iframe`);
            
            let leftFrame = null;
            for (let attempt = 1; attempt <= 10; attempt++) {
                const frames = page.frames();
                leftFrame = frames.find(f => 
                    f.name() === 'leftFrame' || 
                    f.name() === 'menuFrame' ||
                    (f.url() && (f.url().includes('menu') || f.url().includes('left')))
                );
                if (leftFrame) break;
                await new Promise(r => setTimeout(r, 1000));
            }
            
            if (leftFrame) {
                console.log(`   ✅ leftFrame ditemukan: "${leftFrame.name()}"`);
                try {
                    await leftFrame.evaluate(() => {
                        const links = Array.from(document.querySelectorAll('a'));
                        const allOnuLink = links.find(link => 
                            link.innerText.trim() === 'All ONU' || 
                            link.innerText.toLowerCase().includes('all onu')
                        );
                        if (allOnuLink) allOnuLink.click();
                    });
                    console.log(`   ✅ Klik All ONU sukses`);
                } catch (err) {
                    console.log(`   ⚠️ Gagal klik All ONU via Frame: ${err.message}`);
                }
            }
            
            await new Promise(r => setTimeout(r, 3000));

            // Cari mainFrame tabel data
            for (let attempt = 1; attempt <= 10; attempt++) {
                const frames = page.frames();
                const mf = frames.find(f => 
                    f.name() === 'mainFrame' || 
                    f.name() === 'main' ||
                    f.name() === 'content' ||
                    (f.url() && f.url().includes('onu'))
                );
                if (mf) {
                    targetFrame = mf;
                    break;
                }
                await new Promise(r => setTimeout(r, 1000));
            }

        // ==========================================
        // MODE 2: IFRAME = false (Perum & 4Pon Sukamelang)
        // ==========================================
        } else {
            console.log(`   Mode OLT: Struktur Non-Iframe`);
            
            // Cek lapis form login web internal di dalam body jika ada
            if (await page.$('#a')) {
                console.log(`   🔑 Mengisi form login web internal...`);
                await page.type('#a', user);
                await page.type('#b', pass);
                await page.click('input[type="button"]');
                await new Promise(r => setTimeout(r, 4000));
            }

            console.log(`   ⏳ Mencari menu 'All ONU' di halaman utama...`);
            let menuClicked = false;
            try {
                menuClicked = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const target = links.find(x => 
                        x.innerText.trim() === 'All ONU' || 
                        x.innerText.toLowerCase().includes('all onu')
                    );
                    if (target) { target.click(); return true; }
                    return false;
                });
            } catch (e) {}

            if (menuClicked) {
                console.log(`   ✅ Klik menu 'All ONU' sukses`);
                await new Promise(r => setTimeout(r, 4000));
            } else {
                console.log(`   ℹ️ Tombol tidak sengaja terlewat, memuat halaman via navigasi internal...`);
                await page.goto(`${baseUrl}/m/onu_all_onu.htm`, { timeout: 30000 }).catch(() => {});
                await new Promise(r => setTimeout(r, 4000));
            }

            // Antisipasi jika firmware memuat internal sub-frame pasca klik menu
            const frames = page.frames();
            if (frames.length > 1) {
                const mf = frames.find(f => f.url().includes('onu')) || frames[1];
                if (mf) targetFrame = mf;
            }
        }

        // ==========================================
        // PROSES EKSTRAKSI DATA DATA (UNIVERSAL & AMAN)
        // ==========================================
        console.log(`   ⏳ Menyisir tabel untuk mencari MAC...`);
        
        // Atur kapasitas tampilan baris tabel ke 300 data
        try {
            await targetFrame.waitForSelector('table tr', { timeout: 15000 }).catch(() => {});
            await targetFrame.evaluate(() => {
                if (typeof setNumPerPage === 'function') setNumPerPage(300);
                else if (typeof OnPageSizeChange === 'function') OnPageSizeChange(300);
                else {
                    const sel = document.querySelector('select');
                    if (sel) {
                        sel.value = sel.options[sel.options.length - 1].value;
                        sel.dispatchEvent(new Event('change'));
                    }
                }
            });
            await new Promise(r => setTimeout(r, 2000));
        } catch (err) {}

        // Pencarian Baris Data Menggunakan Alfanumerik Cocok & Regex Bebas-Spasi
        const rxPowerResult = await targetFrame.evaluate((targetMac) => {
            const rows = Array.from(document.querySelectorAll('table tr'));
            for (let row of rows) {
                const cleanRowText = row.innerText.replace(/[:.-]/g, '').toLowerCase();
                
                // Jika baris mengandung sebagian besar string MAC target
                if (cleanRowText.includes(targetMac) || (targetMac.length >= 10 && cleanRowText.includes(targetMac.substring(0, 10)))) {
                    const normalText = row.innerText.replace(/\s+/g, ' ').trim();
                    const match = normalText.match(/-\d+\.\d+/); // Ambil desimal negatif apa saja langsung
                    if (match) return match[0];
                    
                    // Metode cadangan: Periksa cell demi cell
                    const cells = Array.from(row.querySelectorAll('td'));
                    for (let cell of cells) {
                        const txt = cell.innerText.trim();
                        if (txt.includes('-') && /\d/.test(txt)) {
                            const cellMatch = txt.match(/-\d+(\.\d+)?/);
                            if (cellMatch) return cellMatch[0];
                        }
                    }
                }
            }
            return null;
        }, cleanTargetMac);

        if (rxPowerResult) {
            console.log(`   ✅ Ditemukan! Redaman: ${rxPowerResult} dBm`);
            return { 
                olt_name: oltConfig.label, 
                mac_onu: mac, 
                redaman: `${rxPowerResult} dBm`, 
                status: 'Online' 
            };
        }

        console.log(`   ❌ Tidak ditemukan di tabel OLT`);
        return null;

    } catch (error) {
        console.error(`   ❌ Error Hioso: ${error.message}`);
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
