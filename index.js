// index.js - RnBNET BOT (Queue System, Instant Reply, Fast Scan & Anti-Timeout Mikrotik)
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const RouterOSAPI = require('node-routeros').RouterOSAPI;
const config = require('./config');
const { scanSemuaOlt } = require('./oltService');

// ==========================================
// 1. WEB SERVER
// ==========================================
const app = express();
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🌐 WEB SERVER RUNNING ON PORT ${PORT}`));

// ==========================================
// 2. WHATSAPP CLIENT
// ==========================================
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'rnbnet', dataPath: './session' }),
    puppeteer: {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,720'],
        timeout: 180000
    }
});

// SYSTEM ANTRIAN PERINTAH (Command Queue - Mencegah Bentrok Banyak HP)
let commandQueue = Promise.resolve();

// ==========================================
// 3. EVENT LISTENER
// ==========================================
console.log('🤖 BOT STARTING...');
client.on('qr', async (qr) => {
    await qrcode.toFile(path.join(__dirname, 'qr.png'), qr);
    console.log('📱 SCAN QR CODE -> qr.png');
});
client.on('authenticated', () => console.log('✅ AUTH SUCCESS'));
client.on('ready', () => {
    console.log('================================');
    console.log('🚀 BOT READY FOR RnBNET!');
    console.log('🔒 ANTRIAN AKTIF: Berjalan Bergantian Otomatis');
    console.log('================================');
});
client.on('disconnected', (reason) => {
    console.warn('⚠️ BOT DISCONNECTED:', reason);
    setTimeout(() => client.initialize().catch(console.error), 5000);
});

// ==========================================
// 4. HELPER MIKROTIK (OPTIMIZED ULTRA FAST & CASE INSENSITIVE)
// ==========================================
function withTimeout(promise, ms, errMsg) {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(errMsg)), ms);
    });
    return Promise.race([
        promise.finally(() => clearTimeout(timeoutId)),
        timeoutPromise
    ]);
}

async function connectMikrotik(serverKey) {
    const targetServer = config.servers[serverKey];
    if (!targetServer) throw new Error(`Server "${serverKey}" tidak ditemukan`);
    const api = new RouterOSAPI({
        host: targetServer.mikrotik.host,
        port: targetServer.mikrotik.port,
        user: targetServer.mikrotik.user,
        password: targetServer.mikrotik.pass,
        timeout: 10
    });

    try {
        await withTimeout(api.connect(), 10000, `Timeout koneksi ke MikroTik ${targetServer.label}.`);
        return { api, targetServer };
    } catch (err) {
        throw new Error(`Gagal konek MikroTik ${targetServer.label}.`);
    }
}

// Menggunakan filter '?~name=' (Regex MikroTik untuk toleransi Huruf Besar/Kecil & Spasi)
async function getUserFromMikrotik(api, username) {
    const namaRegex = `^${username.trim().toLowerCase()}$`;
    
    const secrets = await withTimeout(
        api.write(['/ppp/secret/print', `?~name=${namaRegex}`]), 
        10000, 
        'Timeout Query Secret MikroTik.'
    );
    
    if (!secrets || secrets.length === 0) {
        // JIKA TETAP TIDAK KETEMU: Coba pencarian lebih longgar (mengandung kata tersebut)
        const looserSecrets = await withTimeout(
            api.write(['/ppp/secret/print', `?~name=${username.trim().toLowerCase()}`]), 
            10000, 
            'Timeout Query Secret MikroTik.'
        );
        
        if (!looserSecrets || looserSecrets.length === 0) {
            throw new Error(`User "${username}" benar-benar tidak terdaftar di MikroTik.`);
        }
        return looserSecrets[0];
    }
    
    return secrets[0];
}

// Active user dibuat efisien dan anti sensitif huruf besar/kecil
async function getActiveUserFromMikrotik(api, username) {
    const namaRegex = `^${username.trim().toLowerCase()}$`;
    
    const activeUsers = await withTimeout(
        api.write(['/ppp/active/print', `?~name=${namaRegex}`]), 
        10000, 
        'Timeout Query Active MikroTik.'
    );
    
    if (!activeUsers || activeUsers.length === 0) {
        const looserActive = await withTimeout(
            api.write(['/ppp/active/print', `?~name=${username.trim().toLowerCase()}`]), 
            10000, 
            'Timeout Query Active MikroTik.'
        );
        return looserActive ? looserActive[0] : null;
    }
    return activeUsers[0];
}

async function safeCloseMikrotik(api) {
    if (!api) return;
    try { await withTimeout(api.close(), 3000, 'Close timeout'); } catch (e) {}
}

// ==========================================
// 5. MESSAGE HANDLER & QUEUE SYSTEM
// ==========================================
client.on('message_create', async (msg) => {
    try {
        const text = msg.body.trim();
        const args = text.split(/\s+/);
        const command = args[0]?.toLowerCase();

        if (command === 'ping') { await msg.reply('pong 🏓'); return; }

        if (['!cek', '!aktifkan'].includes(command)) {
            if (args.length < 3) {
                await msg.reply(`❌ *Format Salah*\nGunakan: \`${command} [mikrotik] [username]\``);
                return;
            }

            const serverKey = args[1].toLowerCase();
            const username = args[2];

            if (!config.servers[serverKey]) return;

            // Memasukkan perintah ke antrian serial agar berjalan bergantian
            commandQueue = commandQueue.then(async () => {
                try {
                    if (command === '!cek') {
                        await handleCekRedaman(msg, serverKey, username);
                    } else if (command === '!aktifkan') {
                        await handleAktivasi(msg, serverKey, username);
                    }
                    
                    // 🚀 COOLDOWN 1.5 DETIK SETELAH SETIAP PROSES AGAR SYSTEM TIDAK OVERLOAD
                    await new Promise(r => setTimeout(r, 1500));
                    
                } catch (queueErr) {
                    console.error('Error eksekusi antrian:', queueErr);
                }
            });
        }

    } catch (err) {
        console.error('❌ Handler Error:', err);
    }
});

// ==========================================
// 6. HANDLER CEK REDAMAN (INSTANT REPLY)
// ==========================================
async function handleCekRedaman(msg, serverKey, username) {
    let api;
    const statusMsg = await msg.reply(`⏳ *[RnBNET]* Menghubungi MikroTik untuk mengambil data MAC user *${username}...*`);
    
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;
        
        const userObj = await getUserFromMikrotik(api, username);
        
        let rawMac = userObj['caller-id'] || 'Any';
        const activeUser = await getActiveUserFromMikrotik(api, username);
        if (activeUser) rawMac = activeUser['caller-id'] || rawMac;

        if (!rawMac || rawMac === 'Any') {
            await statusMsg.edit(`⚠️ *MAC Address tidak terbaca*\n\nUser "${userObj.name}" ditemukan di MikroTik, tetapi Caller ID kosong.`);
            return;
        }

        const mac = rawMac.trim().toLowerCase();
        
        await statusMsg.edit(`🔍 *MAC Ditemukan:* \`${mac}\`\n⚡ Memulai penyisiran OLT cabang *${targetServer.label}...*`);

        const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
        
        if (!hasilOlt || hasilOlt.startsWith('⚠️')) {
            await statusMsg.edit(
                `⚠️ *ONU Tidak Ditemukan*\n\n` +
                `👤 *Pelanggan:* ${userObj.name}\n` +
                `💻 *Server:* ${targetServer.label}\n` +
                `🔒 *MAC:* \`${mac}\`\n\n` +
                `Status: Tidak terdaftar di OLT manapun pada cabang ini.`
            );
        } else {
            await statusMsg.edit(
                `📌 *HASIL CEK REDAMAN OLT*\n\n` +
                `👤 *Pelanggan:* ${userObj.name}\n` +
                `💻 *Server:* ${targetServer.label}\n` +
                `🔒 *MAC:* \`${mac}\`\n\n` +
                `${hasilOlt}`
            );
        }

    } catch (err) {
        await statusMsg.edit(`❌ *Gagal Cek Redaman*\n\n${err.message}`);
    } finally {
        await safeCloseMikrotik(api);
    }
}

// ==========================================
// 7. HANDLER AKTIVASI (INSTANT REPLY)
// ==========================================
async function handleAktivasi(msg, serverKey, username) {
    let api;
    const statusMsg = await msg.reply(`⏳ *[RnBNET]* Memulai proses open isolir user *${username}...*`);
    
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;
        
        const userObj = await getUserFromMikrotik(api, username);
        
        await withTimeout(
            api.write(['/ppp/secret/set', `=.id=${userObj['.id']}`, '=disabled=no']),
            15000,
            'Timeout: Gagal mengirim perintah isolir.'
        );
        
        await new Promise(r => setTimeout(r, 1000));

        const activeUser = await getActiveUserFromMikrotik(api, username);
        let ip = userObj['remote-address'] || 'Dynamic';
        let rawMac = userObj['caller-id'] || 'Any';
        const paket = userObj.profile || 'default';

        if (activeUser) {
            ip = activeUser.address || ip;
            rawMac = activeUser['caller-id'] || rawMac;
        }

        if (rawMac && rawMac !== 'Any') {
            const mac = rawMac.trim().toLowerCase();
            await statusMsg.edit(`✨ *Isolir Terbuka!* [MAC: \`${mac}\`].\n🔍 Sedang mengukur redaman OLT...`);
            
            const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
            
            let finalReport = 
                `✨ *RnB Network - Aktivasi Berhasil*\n\n` +
                `👤 *Pelanggan:* ${userObj.name}\n` +
                `🛜 *Paket:* ${paket}\n` +
                `💻 *Server:* ${targetServer.label}\n` +
                `🌐 *IP:* ${ip}\n` +
                `🔒 *MAC:* \`${mac}\`\n\n`;

            if (!hasilOlt || hasilOlt.startsWith('⚠️')) {
                finalReport += `⚠️ _ONU tidak terdeteksi di OLT cabang ini._`;
            } else {
                finalReport += `📌 *Detail Redaman OLT:*\n${hasilOlt}`;
            }
            
            await statusMsg.edit(finalReport);
        } else {
            await statusMsg.edit(
                `✨ *RnB Network - Aktivasi Berhasil*\n\n` +
                `👤 *Pelanggan:* ${userObj.name}\n` +
                `🛜 *Paket:* ${paket}\n` +
                `💻 *Server:* ${targetServer.label}\n` +
                `🌐 *IP:* ${ip}\n\n` +
                `⚠️ _Pengecekan OLT dilewati karena MAC tidak terbaca di MikroTik._`
            );
        }
    } catch (err) {
        await statusMsg.edit(`❌ *Gagal Aktivasi*\n\n${err.message}`);
    } finally {
        await safeCloseMikrotik(api);
    }
}

process.on('unhandledRejection', err => console.error('❌ UNHANDLED:', err));
process.on('uncaughtException', err => {
    if (err.name === 'RosException' && err.message.includes('Timed out')) return;
    console.error('❌ UNCAUGHT:', err);
});
client.initialize().catch(console.error);
