// config.js - RnBNET BOT (With Auth Method Control)
module.exports = {
    defaultMikrotik: { timeout: 15 },
    servers: {
        // 1. PANGLEJAR
        panglejar: {
            label: 'Panglejar',
            mikrotik: { host: '103.191.165.115', port: 705, user: 'berry', pass: 'subang21' },
            olts: [
                { type: 'HSAirpo', label: 'HSAirpo Panglejar', ip: '103.191.165.115', port: 710, user: 'root', pass: 'admin' }
            ]
        },
        // 2. PERUM
        perum: {
            label: 'Perum',
            mikrotik: { host: '103.191.165.38', port: 8725, user: 'berry', pass: 'subang21' },
            olts: [
                { 
                    type: 'Hioso', 
                    label: 'Hioso Perum', 
                    ip: '103.191.165.38', 
                    port: 8422, 
                    user: 'admin', 
                    pass: 'admin', 
                    iframe: false,
                    authMethod: 'basic' // ✅ PAKAI page.authenticate()
                }
            ]
        },
        // 3. CIBAROLA
        cibarola: {
            label: 'Cibarola',
            mikrotik: { host: '103.191.165.115', port: 3155, user: 'berry', pass: 'subang21' },
            olts: [
                { 
                    type: 'Hioso', 
                    label: 'Hioso Cibarola', 
                    ip: '103.191.165.115', 
                    port: 655, 
                    user: 'admin', 
                    pass: 'admin', 
                    iframe: true,
                    authMethod: 'form' // ✅ PAKAI Web Form Login (Double Login)
                },
                { 
                    type: 'HSAirpo', 
                    label: 'HSAirpo Cibarola', 
                    ip: '103.191.165.115', 
                    port: 704, 
                    user: 'admin', 
                    pass: 'admin', 
                    method: 'cibarola', 
                    total_pon: 4 
                }
            ]
        },
        // 4. SUKAMELANG
        sukamelang: {
            label: 'Sukamelang',
            mikrotik: { host: '103.191.165.126', port: 8728, user: 'berry', pass: 'Subang21' },
            olts: [
                { 
                    type: 'Hioso', 
                    label: 'Hioso 8Pon Sukamelang', 
                    ip: '103.191.165.126', 
                    port: 680, 
                    user: 'admin', 
                    pass: 'admin', 
                    iframe: true,
                    authMethod: 'form' // ✅ PAKAI Web Form Login (Double Login)
                },
                { 
                    type: 'Hioso', 
                    label: 'Hioso 4Pon Sukamelang', 
                    ip: '103.191.165.126', 
                    port: 670, 
                    user: 'admin', 
                    pass: 'admin', 
                    iframe: false,
                    authMethod: 'basic' // ✅ PAKAI page.authenticate()
                },
                { 
                    type: 'HSAirpo', 
                    label: 'HSAirpo Sukamelang', 
                    ip: '103.191.165.126', 
                    port: 9900, 
                    user: 'root', 
                    pass: 'admin' 
                }
            ]
        }
    }
};
