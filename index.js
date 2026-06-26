// index.js - RnBNET BOT Original Version
const path = require('path');
const express = require('express');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const RouterOSAPI = require('node-routeros').RouterOSAPI;
const config = require('./config');
const { scanSemuaOlt } = require('./oltService');

const app = express();
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`🌐 WEB SERVER RUNNING ON PORT ${PORT}`));

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'rnbnet', dataPath: './session' }),
    puppeteer: {
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,720'],
        timeout: 180000
    }
});

let commandQueue = Promise.resolve();
let jumlahAntrian = 0; 

console.log('🤖 BOT STARTING...');
client.on('qr', async (qr) => {
    await qrcode.toFile(path.join(__dirname, 'qr.png'), qr);
    console.log('📱 SCAN QR CODE -> qr.png');
});
client.on('authenticated', () => console.log('✅ AUTH SUCCESS'));
client.on('ready', () => {
    console.log('================================');
    console.log('🚀 BOT READY FOR RnBNET!');
    console.log('================================');
});
client.on('disconnected', (reason) => {
    console.warn('⚠️ BOT DISCONNECTED:', reason);
    setTimeout(() => client.initialize().catch(console.error), 5000);
});

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
        timeout: 30
    });

    try {
        await withTimeout(api.connect(), 30000, `Timeout koneksi ke MikroTik ${targetServer.label}.`);
        return { api, targetServer };
    } catch (err) {
        throw new Error(`Gagal konek MikroTik ${targetServer.label}.`);
    }
}

async function getUserFromMikrotik(api, username) {
    const secrets = await withTimeout(api.write('/ppp/secret/print'), 35000, 'Timeout Query Secret MikroTik.');
    const targetName = username.trim().toLowerCase();
    
    const userObj = secrets.find(x => x.name && x.name.trim().toLowerCase() === targetName);
    if (!userObj) {
        const looserObj = secrets.find(x => x.name && x.name.trim().toLowerCase().includes(targetName));
        if (!looserObj) throw new Error(`User "${username}" tidak ditemukan di MikroTik`);
        return looserObj;
    }
    return userObj;
}

async function getActiveUserFromMikrotik(api, username) {
    const activeUsers = await withTimeout(api.write('/ppp/active/print'), 35000, 'Timeout Query Active MikroTik.');
    const targetName = username.trim().toLowerCase();
    
    return activeUsers.find(x => x.name && x.name.trim().toLowerCase() === targetName) || 
           activeUsers.find(x => x.name && x.name.trim().toLowerCase().includes(targetName));
}

async function safeCloseMikrotik(api) {
    if (!api) return;
    try { await withTimeout(api.close(), 5000, 'Close timeout'); } catch (e) {}
}

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

            jumlahAntrian++;

            if (jumlahAntrian > 1) {
                await msg.reply(`⏳ *[RnBNET ANTRIAN]* Mohon tunggu, perintah Anda berada di *Antrian Nomor [ ${jumlahAntrian - 1} ]*`);
            }

            commandQueue = commandQueue.then(async () => {
                try {
                    if (command === '!cek') {
                        await handleCekRedaman(msg, serverKey, username);
                    } else if (command === '!aktifkan') {
                        await handleAktivasi(msg, serverKey, username);
                    }
                    await new Promise(r => setTimeout(r, 1000));
                } catch (queueErr) {
                    console.error('Error antrian:', queueErr);
                } finally {
                    jumlahAntrian--;
                }
            });
        }

    } catch (err) {
        console.error('❌ Handler Error:', err);
    }
});

async function handleCekRedaman(msg, serverKey, username) {
    let api; let targetServer; let userObj; let mac = null;
    await msg.reply(`⏳ *[RnBNET]* Menghubungi MikroTik untuk mengambil data MAC user *${username}...*`);
    
    try {
        const connection = await connectMikrotik(serverKey);
        api = connection.api; targetServer = connection.targetServer;
        userObj = await getUserFromMikrotik(api, username);
        
        let rawMac = userObj['caller-id'] || 'Any';
        const activeUser = await getActiveUserFromMikrotik(api, username);
        if (activeUser) rawMac = activeUser['caller-id'] || rawMac;
        if (rawMac && rawMac !== 'Any') mac = rawMac.trim().toLowerCase();
    } catch (err) {
        await msg.reply(`❌ *Gagal Cek Redaman MikroTik*\n\n${err.message}`);
        return;
    } finally {
        await safeCloseMikrotik(api);
    }

    if (!mac) {
        await msg.reply(`⚠️ *MAC Address tidak terbaca*\n\nUser "${userObj.name}" ditemukan di MikroTik, tetapi Caller ID kosong.`);
        return;
    }

    try {
        const isFound = await scanSemuaOlt(targetServer.olts, mac, msg, userObj, targetServer);
        if (!isFound) {
            await msg.reply(`⚠️ *ONU Tidak Ditemukan*\n\nPelanggan: ${userObj.name}\nServer: ${targetServer.label}\nMAC: \`${mac}\``);
        }
    } catch (err) {
        await msg.reply(`❌ *Gagal Mencari di OLT*\n\n${err.message}`);
    }
}

async function handleAktivasi(msg, serverKey, username) {
    let api; let targetServer; let userObj; let ip = 'Dynamic'; let paket = 'default'; let mac = null;
    try {
        const connection = await connectMikrotik(serverKey);
        api = connection.api; targetServer = connection.targetServer;
        userObj = await getUserFromMikrotik(api, username);
        
        await withTimeout(api.write(['/ppp/secret/set', `=.id=${userObj['.id']}`, '=disabled=no']), 20000, 'Timeout');
        await new Promise(r => setTimeout(r, 500));

        const activeUser = await getActiveUserFromMikrotik(api, username);
        ip = userObj['remote-address'] || ip;
        let rawMac = userObj['caller-id'] || 'Any';
        paket = userObj.profile || paket;

        if (activeUser) { ip = activeUser.address || ip; rawMac = activeUser['caller-id'] || rawMac; }
        if (rawMac && rawMac !== 'Any') mac = rawMac.trim().toLowerCase();
    } catch (err) {
        await msg.reply(`❌ *Gagal Aktivasi MikroTik*\n\n${err.message}`);
        return;
    } finally {
        await safeCloseMikrotik(api);
    }

    if (mac) {
        try {
            const isFound = await scanSemuaOlt(targetServer.olts, mac, msg, userObj, targetServer);
            if (!isFound) {
                await msg.reply(`✨ *Aktivasi Berhasil*\n\nPelanggan: ${userObj.name}\nPaket: ${paket}\nServer: ${targetServer.label}\nIP: ${ip}\nMAC: \`${mac}\``);
            }
        } catch (err) {
            await msg.reply(`✨ *Isolir Terbuka!* Namun gagal membaca data OLT.`);
        }
    } else {
        await msg.reply(`✨ *Aktivasi Berhasil*\n\nPelanggan: ${userObj.name}\nPaket: ${paket}\nServer: ${targetServer.label}\nIP: ${ip}`);
    }
}

process.on('unhandledRejection', err => console.error('❌ UNHANDLED:', err));
process.on('uncaughtException', err => console.error('❌ UNCAUGHT:', err));
client.initialize().catch(console.error);
