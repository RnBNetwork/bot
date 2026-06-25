// index.js - RnBNET BOT (Queue System + Streaming)
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

// ==========================================
// 3. QUEUE SYSTEM
// ==========================================
let isProcessing = false;
const commandQueue = [];

async function processQueue() {
    if (isProcessing || commandQueue.length === 0) return;
    isProcessing = true;

    while (commandQueue.length > 0) {
        const task = commandQueue.shift();
        try {
            await task();
        } catch (err) {
            console.error('❌ Queue Task Error:', err);
        }
        await new Promise(r => setTimeout(r, 1000));
    }

    isProcessing = false;
}

function enqueueTask(task) {
    commandQueue.push(task);
    processQueue();
}

// ==========================================
// 4. EVENT LISTENER
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
    console.log('🔓 PUBLIC ACCESS: Siap melayani siapa saja');
    console.log('================================');
});
client.on('disconnected', (reason) => {
    console.warn('⚠️ BOT DISCONNECTED:', reason);
    setTimeout(() => client.initialize().catch(console.error), 5000);
});

// ==========================================
// 5. HELPER MIKROTIK
// ==========================================
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
        await api.connect();
        return { api, targetServer };
    } catch (err) {
        throw new Error(`Gagal konek MikroTik ${targetServer.label}. Cek port API.`);
    }
}
async function getUserFromMikrotik(api, username) {
    const secrets = await api.write('/ppp/secret/print');
    const userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
    if (!userObj) throw new Error(`User "${username}" tidak ditemukan`);
    return userObj;
}
async function getActiveUserFromMikrotik(api, username) {
    const activeUsers = await api.write('/ppp/active/print');
    return activeUsers.find(x => x.name && x.name.trim().toLowerCase() === username.trim().toLowerCase());
}

// ==========================================
// 6. MESSAGE HANDLER
// ==========================================
client.on('message_create', async (msg) => {
    try {
        const text = msg.body.trim();
        const args = text.split(/\s+/);
        const command = args[0]?.toLowerCase();

        if (command === 'ping') { await msg.reply('pong '); return; }

        if (command === '!menu') {
            await msg.reply(
                `📡 *RnBNET BOT HIGH SPEED*\n\n` +
                `🔍 *CEK REDAMAN:*\n\`!cek [mikrotik] [username]\`\n` +
                `⚡ *AKTIVASI:*\n\`!aktifkan [mikrotik] [username]\`\n\n` +
                ` *SERVER:* panglejar, perum, cibarola, sukamelang\n\n` +
                `✅ _Bot ini terbuka untuk umum_`
            );
            return;
        }

        if (['!cek', '!aktifkan'].includes(command)) {
            if (args.length < 3) {
                await msg.reply(`❌ *Format Salah*\n\nGunakan: \`${command} [mikrotik] [username]\`\nContoh: \`${command} cibarola liacahyani\``);
                return;
            }

            const serverKey = args[1].toLowerCase();
            const username = args[2];

            if (!config.servers[serverKey]) {
                const serverList = Object.keys(config.servers).join(', ');
                await msg.reply(`❌ *Nama MikroTik Salah!*\n\nPilihan yang tersedia:\n• ${serverList}`);
                return;
            }

            console.log(`\n [REQUEST] Dari: ${msg.from} | Perintah: ${command} ${serverKey} ${username}`);

            // Jika bot sedang bekerja, simpan di antrian
            if (isProcessing) {
                await msg.reply(`⏳ _Bot sedang memproses perintah lain. Perintah Anda akan diproses setelah selesai._`);
            }

            // Enqueue task
            enqueueTask(async () => {
                if (command === '!cek') await handleCekRedaman(msg, serverKey, username);
                else if (command === '!aktifkan') await handleAktivasi(msg, serverKey, username);
            });
        }

    } catch (err) {
        console.error('❌ Handler Error:', err);
        try { await msg.reply(`❌ *Terjadi Kesalahan*\n\n${err.message}`); } catch (e) {}
    }
});

// ==========================================
// 7. HANDLER CEK REDAMAN (STREAMING)
// ==========================================
async function handleCekRedaman(msg, serverKey, username) {
    let api;
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;

        await msg.reply(` Mencari *${username}* di MikroTik *${targetServer.label}*...`);
        const userObj = await getUserFromMikrotik(api, username);

        let rawMac = userObj['caller-id'] || 'Any';
        const activeUser = await getActiveUserFromMikrotik(api, username);
        if (activeUser) rawMac = activeUser['caller-id'] || rawMac;

        if (!rawMac || rawMac === 'Any') {
            await msg.reply(`⚠️ *MAC Address tidak terbaca*\n\nUser "${username}" ditemukan, tetapi MAC address tidak tersedia.`);
            return;
        }

        const mac = rawMac.trim().toLowerCase();
        await msg.reply(`📡 *MAC Ditemukan:*\n\`${mac}\`\n\n⏳ _Menyisir OLT... Hasil akan dikirim langsung saat ditemukan._`);

        //  STREAMING: Kirim hasil ke WA segera saat ditemukan
        let adaHasil = false;
        await scanSemuaOlt(targetServer.olts, mac, async (textHasil) => {
            await msg.reply(textHasil);
            adaHasil = true;
        });

        if (!adaHasil) {
            await msg.reply('⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.');
        }

    } catch (err) {
        await msg.reply(`❌ *Gagal Cek Redaman*\n\n${err.message}`);
    } finally {
        try { if (api) await api.close(); } catch (e) {}
    }
}

// ==========================================
// 8. HANDLER AKTIVASI (STREAMING)
// ==========================================
async function handleAktivasi(msg, serverKey, username) {
    let api;
    try {
        const { api: mikrotikApi, targetServer } = await connectMikrotik(serverKey);
        api = mikrotikApi;

        await msg.reply(`⏳ *Memproses Open Isolir*\n\n👤 User: ${username}\n💻 Server: ${targetServer.label}\n\n_Mohon tunggu..._`);

        const userObj = await getUserFromMikrotik(api, username);
        await api.write(['/ppp/secret/set', `=.id=${userObj['.id']}`, '=disabled=no']);
        await new Promise(r => setTimeout(r, 2000));

        const activeUser = await getActiveUserFromMikrotik(api, username);
        let ip = userObj['remote-address'] || 'Dynamic';
        let rawMac = userObj['caller-id'] || 'Any';
        const paket = userObj.profile || 'default';

        if (activeUser) {
            ip = activeUser.address || ip;
            rawMac = activeUser['caller-id'] || rawMac;
        }

        let report =
            `✨ *RnB Network - Aktivasi Sukses*\n\n` +
            `✅ *Status:* BERHASIL\n` +
            `👤 *Pelanggan:* ${username}\n` +
            `🛜 *Paket:* ${paket}\n` +
            `💻 *Server:* ${targetServer.label}\n` +
            `🌐 *IP:* ${ip}\n` +
            `🔒 *MAC Asli:* \`${rawMac}\`\n`;

        if (rawMac && rawMac !== 'Any') {
            const mac = rawMac.trim().toLowerCase();
            report += `✂️ *MAC OLT:* \`${mac}\`\n\n🔍 _Menyisir OLT otomatis..._`;
            await msg.reply(report);

            // 🚀 STREAMING: Kirim hasil OLT ke WA segera saat ditemukan
            let adaHasil = false;
            await scanSemuaOlt(targetServer.olts, mac, async (textHasil) => {
                await msg.reply(textHasil);
                adaHasil = true;
            });

            if (!adaHasil) {
                await msg.reply('⚠️ ONU tidak ditemukan di OLT manapun pada cabang ini.');
            }
        } else {
            report += `\n⚠️ _Pengecekan OLT dilewati karena MAC tidak terbaca._`;
            await msg.reply(report);
        }
    } catch (err) {
        await msg.reply(`❌ *Gagal Aktivasi*\n\n${err.message}`);
    } finally {
        try { if (api) await api.close(); } catch (e) {}
    }
}

// ==========================================
// 9. ERROR HANDLING
// ==========================================
process.on('unhandledRejection', err => console.error('❌ UNHANDLED:', err));
process.on('uncaughtException', err => {
    if (err.name === 'RosException' && err.message.includes('Timed out')) return;
    console.error('❌ UNCAUGHT:', err);
});
client.initialize().catch(console.error);
