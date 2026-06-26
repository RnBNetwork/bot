// index.js - RnBNET BOT (Queue System, Instant Reply & Fast Scan)
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

// SYSTEM ANTRIAN PERINTAH (Command Queue)
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
    console.log('🔒 ANTRIAN AKTIF: Aman dari Bentrok Banyak HP');
    console.log('================================');
});
client.on('disconnected', (reason) => {
    console.warn('⚠️ BOT DISCONNECTED:', reason);
    setTimeout(() => client.initialize().catch(console.error), 5000);
});

// ==========================================
// 4. HELPER MIKROTIK
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
        timeout: 15
    });

    try {
        await withTimeout(api.connect(), 15000, `Timeout koneksi ke MikroTik ${targetServer.label}.`);
        return { api, targetServer };
    } catch (err) {
        throw new Error(`Gagal konek MikroTik ${targetServer.label}.`);
    }
}

async function getUserFromMikrotik(api, username) {
    const secrets = await withTimeout(api.write('/ppp/secret/print'), 25000, 'Timeout Query Secret MikroTik.');
    const userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
    if (!userObj) throw new Error(`User "${username}" tidak ditemukan`);
    return userObj;
}

async function getActiveUserFromMikrotik(api, username) {
    const activeUsers = await withTimeout(api.write('/ppp/active/print'), 25000, 'Timeout Query Active MikroTik.');
    return activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
}

async function safeCloseMikrotik(api) {
    if (!api) return;
    try { await withTimeout(api.close(), 5000, 'Close timeout'); } catch (e) {}
}

// ==========================================
// 5. MESSAGE HANDLER & QUEUE INJECTION
// ==========================================
client.on('message_create', async (msg) => {
    try {
        const text = msg.body.trim();
        const args = text.split(/\s+/);
        const command = args[0]?.toLowerCase();

        if (command === 'ping') { await msg.reply('pong 🏓'); return; }
        
        if (command === '!menu') {
            await msg.reply(
                `📡 *RnBNET BOT HIGH SPEED*\n\n` +
                `🔍 *CEK REDAMAN:*\n\`!cek [mikrotik] [username]\`\n` +
                `⚡ *AKTIVASI:*\n\`!aktifkan [mikrotik] [username]\`\n\n` +
                `📍 *SERVER:* panglejar, perum, cibarola, sukamelang`
            );
            return;
        }

        if (['!cek', '!aktifkan'].includes(command)) {
            if (args.length < 3) {
                await msg.reply(`❌ *Format Salah*\nGunakan: \`${command} [mikrotik] [username]\``);
                return;
            }

            const serverKey = args[1].toLowerCase();
            const username = args[2];

            if (!config.servers[serverKey]) {
                return;
            }

            // MASUKKAN KE DALAM ANTRIAN (Agar HP 1 & HP 2 tidak bentrok browser)
            commandQueue = commandQueue.then(async () => {
                try {
                    if (command === '!cek') {
                        await handleCekRedaman(msg, serverKey, username);
                    } else if (command === '!aktifkan') {
                        await handleAktivasi(msg, serverKey, username);
                    }
                } catch (queueErr) {
                    console.error('Error saat mengeksekusi antrian:', queueErr);
                }
            });
        }

    } catch (err) {
        console.error('❌ Handler Error:', err);
    }
});

// ==========================================
// 6. HANDLER CEK REDAMAN (INSTANT REPLY + FAST SCAN)
// ==========================================
async function handleCekRedaman(msg, serverKey, username) {
    let api;
    // Balas Dulu Biar Kelihatan Bot Merespons Mengambil MAC MikroTik
    const statusMsg = await msg.reply(`⏳ *[RnBNET]* Menghubungi MikroTik untuk mengambil data MAC user *${username}...*`);
    
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;
        
        const userObj = await getUserFromMikrotik(api, username);
        
        let rawMac = userObj['caller-id'] || 'Any';
        const activeUser = await getActiveUserFromMikrotik(api, username);
        if (activeUser) rawMac = activeUser['caller-id'] || rawMac;

        if (!rawMac || rawMac === 'Any') {
            await statusMsg.edit(`⚠️ *MAC Address tidak terbaca*\n\nUser "${username}" ditemukan di MikroTik, tetapi Caller ID kosong.`);
            return;
        }

        const mac = rawMac.trim().toLowerCase();
        
        // Update status pesan memberi tahu teknisi bahwa MAC ditemukan dan mulai menyisir OLT
        await statusMsg.edit(`🔍 *MAC Ditemukan:* \`${mac}\`\n⚡ Memulai penyisiran OLT cabang *${targetServer.label}...*`);

        const hasilOlt = await scanSemuaOlt(targetServer.olts, mac);
        
        // Edit pesan awal tadi menjadi 1 hasil akhir yang bersih utuh
        if (!hasilOlt || hasilOlt.startsWith('⚠️')) {
            await statusMsg.edit(
                `⚠️ *ONU Tidak Ditemukan*\n\n` +
                `👤 *Pelanggan:* ${username}\n` +
                `💻 *Server:* ${targetServer.label}\n` +
                `🔒 *MAC:* \`${mac}\`\n\n` +
                `Status: Tidak terdaftar di OLT manapun.`
            );
        } else {
            await statusMsg.edit(
                `📌 *HASIL CEK REDAMAN OLT*\n\n` +
                `👤 *Pelanggan:* ${username}\n` +
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
                `👤 *Pelanggan:* ${username}\n` +
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
                `👤 *Pelanggan:* ${username}\n` +
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
