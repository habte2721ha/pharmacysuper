import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import http from 'http';
import { Server } from 'socket.io';
import os from 'os';

import { db as sqlDb, bootstrapDatabaseSchema } from './src/db/index';
import { appData } from './src/db/schema';
import { eq } from 'drizzle-orm';

const appExpress = express();
const PORT = process.env.PORT || 3000;

const isSqlActive = !!process.env.SQL_HOST;
let sqlProbeSuccessful = false;
let isSqlActiveEffective = false;

async function probeSql() {
    if (!isSqlActive) {
        console.log("[DATABASE] SQL_HOST is not set. Using safe local file storage.");
        isSqlActiveEffective = false;
        return;
    }
    try {
        console.log("[DATABASE] Probing database connection with a 15-second timeout...");
        const queryPromise = sqlDb.select().from(appData).limit(1);
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15000));
        await Promise.race([queryPromise, timeoutPromise]);
        
        sqlProbeSuccessful = true;
        isSqlActiveEffective = true;
        console.log("[DATABASE] Database connection probe succeeded! Dynamic storage is active.");
    } catch (err: any) {
        console.warn("[DATABASE] Database probe failed or timed out. Falling back to local JSON file storage.", err.message || err);
        sqlProbeSuccessful = false;
        isSqlActiveEffective = false;
    }
}

async function readSqlKey(key: string): Promise<any> {
    try {
        const result = await sqlDb.select().from(appData).where(eq(appData.key, key)).limit(1);
        if (result.length > 0) {
            return result[0].value;
        }
    } catch (err) {
        console.error(`PostgreSQL read failure for ${key}:`, err);
    }
    return null;
}

async function writeSqlKey(key: string, value: any): Promise<boolean> {
    try {
        if (value === null || value === undefined) {
            await sqlDb.delete(appData).where(eq(appData.key, key));
            return true;
        }
        await sqlDb.insert(appData)
            .values({ key, value })
            .onConflictDoUpdate({
                target: appData.key,
                set: { value }
            });
        return true;
    } catch (err) {
        console.error(`PostgreSQL write failure for ${key}:`, err);
        return false;
    }
}


appExpress.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'] }));
appExpress.use(bodyParser.json({ limit: '100mb' }));

const httpServer = http.createServer(appExpress);
const io = new Server(httpServer, { 
    cors: { origin: "*", methods: ["GET", "POST"] } 
});

const activeUsers = new Map();

io.on('connection', (socket) => {
    socket.on('user_login', (data) => {
        activeUsers.set(socket.id, {
            username: data.username,
            role: data.role,
            loginTime: new Date().toISOString(),
            ip: socket.handshake.address,
            userAgent: socket.handshake.headers['user-agent']
        });
        io.emit('active_users_update', Array.from(activeUsers.values()));
    });
    
    socket.on('disconnect', () => {
        activeUsers.delete(socket.id);
        io.emit('active_users_update', Array.from(activeUsers.values()));
    });
});

const isProduction = process.env.NODE_ENV === "production";
const appRoot = isProduction ? path.join(__dirname, '..') : process.cwd();
const userDataPath = path.join(appRoot, 'data');
if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true });
}
const DB_FILE = path.join(userDataPath, 'pharma_db.json');
const BACKUP_FILE = path.join(userDataPath, 'pharma_db.backup.json');
const BACKUPS_DIR = path.join(userDataPath, 'backups');

const initialDB = {
  pharma_products: [],
  pharma_sales: [],
  pharma_info: null,
  pharma_users_db: [],
  pharma_customers_db: [],
  pharma_suppliers: [],
  pharma_activity_logs: [],
  pharma_receipt_counter: 0,
  bincards: {}
};

function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            if (fs.existsSync(BACKUP_FILE)) {
                const backupData = fs.readFileSync(BACKUP_FILE, 'utf8');
                fs.writeFileSync(DB_FILE, backupData);
                return JSON.parse(backupData);
            }
            fs.writeFileSync(DB_FILE, JSON.stringify(initialDB, null, 2));
            return initialDB;
        }
        const data = fs.readFileSync(DB_FILE, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Database read failure:", err);
        return initialDB;
    }
}

function writeDB(data) {
    try {
        const stringified = JSON.stringify(data, null, 2);
        const tempPath = DB_FILE + '.tmp';
        fs.writeFileSync(tempPath, stringified);
        if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, BACKUP_FILE);
        fs.renameSync(tempPath, DB_FILE);
        return true;
    } catch (err) {
        console.error("Database write failure:", err);
        return false;
    }
}

const performPeriodicBackup = () => {
    try {
        const dbData = readDB();
        
        if (!fs.existsSync(BACKUPS_DIR)) {
            fs.mkdirSync(BACKUPS_DIR, { recursive: true });
        }
        if (fs.existsSync(DB_FILE)) {
            const dateStr = new Date().toISOString().split('T')[0];
            const backupFilename = `pharma_db_${dateStr}.json`;
            const backupPath = path.join(BACKUPS_DIR, backupFilename);
            
            // Avoid creating multiple backups on the same day if the server restarts
            if (!fs.existsSync(backupPath)) {
                fs.copyFileSync(DB_FILE, backupPath);
                console.log(`[BACKUP] Daily automatic backup created: ${backupPath}`);
            }
        }
    } catch (err) {
        console.error("Backup failure:", err);
    }
};

const performNotificationsRuns = async () => {
    try {
        let info;
        if (isSqlActiveEffective) {
            info = await readSqlKey('pharma_info');
        } else {
            const dbData = readDB();
            info = dbData.pharma_info;
        }

        if (!info) return;

        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        
        // 1. Daily Reports (run around closing time, let's say after 20:00)
        // Ensure it runs once per day
        const dailyRunKey = `pharma_daily_report_run_${dateStr}`;
        let hasDailyRun;
        if (isSqlActiveEffective) {
            hasDailyRun = await readSqlKey(dailyRunKey);
        } else {
            hasDailyRun = readDB()[dailyRunKey];
        }

        if (!hasDailyRun && now.getHours() >= 20) {
            if (info.enableDailyEmailReport && info.notificationEmail) {
                console.log(`[REPORTING] Sending Daily Summary Email to ${info.notificationEmail}`);
                // In a real environment, integrate NodeMailer/SendGrid here
            }
            if (info.enableDailySmsReport && info.notificationPhone) {
                console.log(`[REPORTING] Sending Daily Summary SMS to ${info.notificationPhone}`);
                // In a real environment, integrate Twilio/MessageBird here
            }
            
            // Mark as run
            if (isSqlActiveEffective) {
                await writeSqlKey(dailyRunKey, true);
            } else {
                const dbData = readDB();
                dbData[dailyRunKey] = true;
                writeDB(dbData);
            }
        }

        // 2. Monthly Expiry Reports (run on the 1st of every month)
        const monthStr = `${now.getFullYear()}-${now.getMonth() + 1}`;
        const monthlyRunKey = `pharma_monthly_expiry_run_${monthStr}`;
        
        let hasMonthlyRun;
        if (isSqlActiveEffective) {
            hasMonthlyRun = await readSqlKey(monthlyRunKey);
        } else {
            hasMonthlyRun = readDB()[monthlyRunKey];
        }

        if (!hasMonthlyRun && now.getDate() === 1) {
            if (info.enableMonthlyExpiryEmail && info.notificationEmail) {
                console.log(`[REPORTING] Sending Monthly Near-Expiry Alert Email to ${info.notificationEmail}`);
                // Iterate over inventory to build expiry list and send
            }
            if (info.enableMonthlyExpirySms && info.notificationPhone) {
                console.log(`[REPORTING] Sending Monthly Near-Expiry Alert SMS to ${info.notificationPhone}`);
            }

            // Mark as run
            if (isSqlActiveEffective) {
                await writeSqlKey(monthlyRunKey, true);
            } else {
                const dbData = readDB();
                dbData[monthlyRunKey] = true;
                writeDB(dbData);
            }
        }

    } catch (err) {
        console.error("Notifications background task failure:", err);
    }
};

const getLocalIP = () => {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return 'localhost';
};

appExpress.get('/api/health', async (req, res) => {
    let pharmacyName = 'Unset';
    if (isSqlActiveEffective) {
        const info = await readSqlKey('pharma_info');
        pharmacyName = info?.name || 'Unset';
    } else {
        pharmacyName = readDB().pharma_info?.name || 'Unset';
    }
    res.json({ 
        status: 'online', 
        ip: getLocalIP(),
        port: PORT,
        pharmacy: pharmacyName
    });
});

appExpress.get('/api/data/:key', async (req, res) => {
    const key = req.params.key;
    if (isSqlActiveEffective) {
        const data = await readSqlKey(key);
        return res.json(data || []);
    } else {
        const dbData = readDB();
        if (key.startsWith('pharma_bincard_')) {
            const pid = key.replace('pharma_bincard_', '');
            return res.json(dbData.bincards?.[pid] || []);
        }
        res.json(dbData[key] || []);
    }
});

appExpress.post('/api/data/:key', async (req, res) => {
    const key = req.params.key;
    const incomingData = req.body;
    
    if (isSqlActiveEffective) {
        let finalData = incomingData;
        if (!key.startsWith('pharma_bincard_')) {
            const existing = await readSqlKey(key);
            if (Array.isArray(incomingData) && Array.isArray(existing)) {
                const map = new Map();
                existing.forEach(item => { if(item?.id) map.set(item.id, item); });
                incomingData.forEach(item => { if(item?.id) map.set(item.id, item); });
                finalData = Array.from(map.values());
            }
        }
        const success = await writeSqlKey(key, finalData);
        if (success) {
            io.emit('data-change', { key });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: "PostgreSQL Persistence Failure" });
        }
    } else {
        const dbData = readDB();
        if (key.startsWith('pharma_bincard_')) {
            const pid = key.replace('pharma_bincard_', '');
            if (!dbData.bincards) dbData.bincards = {};
            dbData.bincards[pid] = incomingData;
        } else if (Array.isArray(incomingData) && Array.isArray(dbData[key])) {
            // Smart merge for list updates from multiple clients
            const map = new Map();
            dbData[key].forEach(item => { if(item?.id) map.set(item.id, item); });
            incomingData.forEach(item => { if(item?.id) map.set(item.id, item); });
            dbData[key] = Array.from(map.values());
        } else {
            dbData[key] = incomingData;
        }

        if (writeDB(dbData)) {
            // Broadcast to all other terminals
            io.emit('data-change', { key });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: "Persistence Failure" });
        }
    }
});

appExpress.post('/api/system/reset', async (req, res) => {
    if (isSqlActiveEffective) {
        try {
            const keys = [
                'pharma_products', 'pharma_sales', 'pharma_info', 'pharma_users_db', 
                'pharma_customers_db', 'pharma_suppliers', 'pharma_activity_logs', 
                'pharma_receipt_counter'
            ];
            for (const key of keys) {
                await sqlDb.delete(appData).where(eq(appData.key, key));
            }
            io.emit('data-change', { key: 'ALL' });
            res.json({ success: true });
        } catch (err) {
            console.error("SQL reset error:", err);
            res.status(500).json({ error: "Failed to reset PostgreSQL database" });
        }
    } else {
        if (writeDB(initialDB)) {
            io.emit('data-change', { key: 'ALL' });
            res.json({ success: true });
        } else {
            res.status(500).json({ error: "Failed to reset database" });
        }
    }
});

appExpress.post('/api/system/import', async (req, res) => {
    const { data, options } = req.body;
    if (!data || typeof data !== 'object') {
        return res.status(400).json({ error: "Invalid payload: 'data' is required and must be an object." });
    }

    const isItemsOnly = options?.itemsOnly || options?.scope === 'itemsOnly';
    const isBranchOnly = options?.scope === 'branch';

    try {
        if (isSqlActiveEffective) {
            for (const key of Object.keys(data)) {
                if (isItemsOnly && key !== 'pharma_products') continue;
                let importItems = data[key];

                if (isBranchOnly && options?.branch && Array.isArray(importItems) && key !== 'pharma_info') {
                    const branchItems = importItems.filter((item: any) => typeof item === 'object' && item !== null && item.branch === options.branch);
                    let existingData = await readSqlKey(key) || [];
                    if (!Array.isArray(existingData)) existingData = [];
                    existingData = existingData.filter((item: any) => typeof item === 'object' && item !== null && item.branch !== options.branch);
                    importItems = [...existingData, ...branchItems];
                } else if (options?.branch && Array.isArray(importItems) && key !== 'pharma_info' && !isBranchOnly) {
                    importItems = importItems.map((item: any) => typeof item === 'object' && item !== null ? { ...item, branch: options.branch } : item);
                }

                await writeSqlKey(key, importItems);
            }
        } else {
            const dbData = readDB();
            
            if (!isItemsOnly && !isBranchOnly) {
                for (const key of Object.keys(dbData)) {
                    if (key !== 'bincards') {
                        delete dbData[key];
                    }
                }
                dbData.bincards = {};
            }

            for (const key of Object.keys(data)) {
                if (isItemsOnly && key !== 'pharma_products') continue;
                let importItems = data[key];

                if (key.startsWith('pharma_bincard_')) {
                    const pid = key.replace('pharma_bincard_', '');
                    if (!dbData.bincards) dbData.bincards = {};
                    dbData.bincards[pid] = importItems;
                    continue;
                }

                if (isBranchOnly && options?.branch && Array.isArray(importItems) && key !== 'pharma_info') {
                    const branchItems = importItems.filter((item: any) => typeof item === 'object' && item !== null && item.branch === options.branch);
                    let existingData = dbData[key] || [];
                    if (!Array.isArray(existingData)) existingData = [];
                    existingData = existingData.filter((item: any) => typeof item === 'object' && item !== null && item.branch !== options.branch);
                    importItems = [...existingData, ...branchItems];
                } else if (options?.branch && Array.isArray(importItems) && key !== 'pharma_info' && !isBranchOnly) {
                    importItems = importItems.map((item: any) => typeof item === 'object' && item !== null ? { ...item, branch: options.branch } : item);
                }

                dbData[key] = importItems;
            }

            writeDB(dbData);
        }

        io.emit('data-change', { key: 'ALL' });
        res.json({ success: true });
    } catch (err: any) {
        console.error("Bulk restoration failure:", err);
        res.status(500).json({ error: "Restoration failure: " + err.message });
    }
});

appExpress.post('/api/log', (req, res) => {
    console.log('[CLIENT ERROR]', req.body);
    res.json({ok: true});
});

appExpress.post('/api/system/send-passcode', async (req, res) => {
    const { username, deviceId } = req.body;
    if (!username || !deviceId) {
        return res.status(400).json({ error: "Missing username or deviceId" });
    }
    
    try {
        let approvals: any[] = [];
        let info: any = null;
        
        if (isSqlActiveEffective) {
            approvals = await readSqlKey('pharma_device_approvals') || [];
            info = await readSqlKey('pharma_info');
        } else {
            const dbData = readDB();
            approvals = dbData.pharma_device_approvals || [];
            info = dbData.pharma_info;
        }
        
        let deviceRecord = approvals.find((a: any) => a.username === username && a.deviceId === deviceId);
        
        if (!deviceRecord) {
            const authCode = Math.floor(100000 + Math.random() * 900000).toString();
            deviceRecord = {
                id: Date.now().toString(36) + Math.random().toString(36).substring(2),
                username,
                deviceId,
                approved: false,
                authCode,
                requestedAt: new Date().toISOString()
            };
            approvals.push(deviceRecord);
            if (isSqlActiveEffective) {
                await writeSqlKey('pharma_device_approvals', approvals);
            } else {
                const dbData = readDB();
                dbData.pharma_device_approvals = approvals;
                writeDB(dbData);
            }
        }
        
        const authCode = deviceRecord.authCode;
        const primaryEmail = info?.email;
        const notificationEmail = info?.notificationEmail;
        const targetEmail = primaryEmail || notificationEmail || 'sonanpharmacy@gmail.com';
        
        const smtpHost = process.env.SMTP_HOST;
        const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
        const smtpUser = process.env.SMTP_USER;
        const smtpPass = process.env.SMTP_PASS;
        const smtpFrom = process.env.SMTP_FROM || 'no-reply@pharmacysuper.et';
        
        let sent = false;
        let mocked = true;
        let mailError = '';
        
        if (smtpHost && smtpUser && smtpPass) {
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: smtpHost,
                    port: smtpPort,
                    secure: smtpPort === 465,
                    auth: {
                        user: smtpUser,
                        pass: smtpPass
                    }
                });
                
                await transporter.sendMail({
                    from: smtpFrom,
                    to: targetEmail,
                    subject: `[APSMS Security] Device Approval Passcode`,
                    text: `Hello,\n\nAn unrecognized device is trying to access your Pharmacy Management System.\n\nApproval Passcode: ${authCode}\nDevice ID: ${deviceId}\nRequested At: ${new Date().toLocaleString()}\n\nIf you did not request this, please secure your administrative system credentials.\n\nBest regards,\nAPSMS Control`,
                    html: `
                        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px;">
                            <h2 style="color: #0d9488; text-transform: uppercase; letter-spacing: 1px;">APSMS Device Approval</h2>
                            <p>An unrecognized device requested access to your Pharmacy Management System.</p>
                            <div style="background-color: #f0fdfa; border: 1px solid #ccfbf1; padding: 15px; border-radius: 8px; text-align: center; margin: 20px 0;">
                                <span style="font-size: 12px; font-weight: bold; text-transform: uppercase; color: #0f766e; letter-spacing: 2px; display: block; margin-bottom: 5px;">One-Time Passcode</span>
                                <strong style="font-size: 32px; font-family: monospace; letter-spacing: 5px; color: #0d9488;">${authCode}</strong>
                            </div>
                            <p style="font-size: 12px; color: #64748b;">
                                <strong>Device ID:</strong> ${deviceId}<br>
                                <strong>Requested At:</strong> ${new Date().toLocaleString()}<br>
                                <strong>Recipient:</strong> ${targetEmail}
                            </p>
                            <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 20px 0;">
                            <p style="font-size: 11px; color: #94a3b8; line-height: 1.4;">This is an automated operational security report. If you did not make this login attempt, please secure your administrative credentials immediately.</p>
                        </div>
                    `
                });
                sent = true;
                mocked = false;
            } catch (err: any) {
                console.error("[MAIL EXCEPTION]", err);
                mailError = err.message || 'SMTP Transport Error';
            }
        }
        
        if (!sent) {
            try {
                console.log(`[PASSCODE DISPATCH] SMTP not configured. Attempting high-reliability web-relay to ${targetEmail}...`);
                const response = await fetch(`https://formsubmit.co/ajax/${targetEmail}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        _subject: "[APSMS Security] Device Approval Passcode",
                        _captcha: "false",
                        "Security Passcode": authCode,
                        "Device ID": deviceId,
                        "Login Username": username,
                        "Requested At": new Date().toLocaleString(),
                        "Bypass Action Required": "If FormSubmit asks you to verify your email, click the verification button in the email to activate future instant passcodes."
                    })
                });
                if (response.ok) {
                    const result = await response.json();
                    if (result.success === "true" || result.success === true) {
                        sent = true;
                        mocked = false;
                        console.log(`[PASSCODE DISPATCH] Real email successfully sent to ${targetEmail} via high-reliability web-relay!`);
                    } else {
                        console.warn("[PASSCODE DISPATCH] Web-relay non-success:", result);
                        mailError = `Relay: ${JSON.stringify(result)}`;
                    }
                } else {
                    const text = await response.text();
                    console.warn(`[PASSCODE DISPATCH] Web-relay connection error ${response.status}:`, text);
                    mailError = `Web-relay status ${response.status}`;
                }
            } catch (relayErr: any) {
                console.error("[PASSCODE DISPATCH] Web-relay failed:", relayErr);
                mailError = `Web-relay error: ${relayErr.message}`;
            }
        }
        
        console.log(`\n==================================================`);
        console.log(`[PASSCODE DISPATCH] TO: ${targetEmail}`);
        console.log(`[PASSCODE DISPATCH] PASSCODE: ${authCode}`);
        console.log(`[PASSCODE DISPATCH] STATUS: ${sent ? 'SENT REAL EMAIL' : 'SIMULATED / SANDBOX MODE'}`);
        if (mailError) console.log(`[PASSCODE DISPATCH] ERROR DETAILS: ${mailError}`);
        console.log(`==================================================\n`);
        
        res.json({
            success: true,
            email: targetEmail,
            mocked,
            code: mocked ? authCode : undefined
        });
    } catch (err: any) {
        console.error("Failed to send passcode:", err);
        res.status(500).json({ error: err.message || "Failed to process passcode dispatch" });
    }
});

appExpress.get('/api/system/smtp-status', async (req, res) => {
    try {
        const host = process.env.SMTP_HOST || '';
        const port = process.env.SMTP_PORT || '';
        const user = process.env.SMTP_USER || '';
        const hasPass = !!process.env.SMTP_PASS;
        const from = process.env.SMTP_FROM || '';

        res.json({
            host: host || null,
            port: port || null,
            user: user || null,
            hasPass,
            from: from || null,
            isFullyConfigured: !!(host && port && user && hasPass)
        });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

appExpress.post('/api/system/test-smtp', async (req, res) => {
    const { testEmail } = req.body;
    const recipient = testEmail || 'sonanpharmacy@gmail.com';

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;
    const smtpFrom = process.env.SMTP_FROM || 'no-reply@pharmacysuper.et';

    if (!smtpHost || !smtpUser || !smtpPass) {
        return res.status(400).json({
            success: false,
            error: "SMTP configuration is incomplete. Please set SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS in your environment setup.",
            variables: {
                SMTP_HOST: !!smtpHost,
                SMTP_PORT: !!process.env.SMTP_PORT,
                SMTP_USER: !!smtpUser,
                SMTP_PASS: !!smtpPass
            }
        });
    }

    try {
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass
            },
            connectionTimeout: 10000
        });

        await transporter.verify();

        const info = await transporter.sendMail({
            from: smtpFrom,
            to: recipient,
            subject: `[APSMS Integration] SMTP Connection Success!`,
            text: `Hello!\n\nThis is a verification email from your APSMS Control Terminal.\n\nYour SMTP integration is working flawlessly.\n\nHost: ${smtpHost}\nPort: ${smtpPort}\nUser: ${smtpUser}\nSend Time: ${new Date().toLocaleString()}`,
            html: `
                <div style="font-family: inherit; padding: 24px; background-color: #fafafa; border: 1px solid #eaeaea; border-radius: 16px; max-width: 600px; color: #333333;">
                    <h2 style="color: #0d9488; margin-bottom: 8px; font-weight: 800;">SMTP Connected Successfully!</h2>
                    <p style="font-size: 14px; margin-bottom: 16px; color: #666;">This is a test notification confirming your mail infrastructure is correctly wired for passcode delivery & system alerts.</p>
                    <div style="background-color: #ffffff; padding: 16px; border-radius: 8px; border: 1px solid #eaeaea;">
                        <span style="font-size: 11px; font-weight: bold; text-transform: uppercase; color: #999; display: block; margin-bottom: 8px;">Active SMTP Configuration</span>
                        <table style="width: 100%; font-size: 13px; text-align: left; border-collapse: collapse;">
                            <tr>
                                <th style="padding: 4px 0; color: #555; width: 100px;">Host</th>
                                <td style="padding: 4px 0; font-family: monospace; color: #0d9488;">${smtpHost}</td>
                            </tr>
                            <tr>
                                <th style="padding: 4px 0; color: #555;">Port</th>
                                <td style="padding: 4px 0; font-family: monospace;">${smtpPort}</td>
                            </tr>
                            <tr>
                                <th style="padding: 4px 0; color: #555;">User</th>
                                <td style="padding: 4px 0; font-family: monospace;">${smtpUser}</td>
                            </tr>
                        </table>
                    </div>
                </div>
            `
        });

        res.json({
            success: true,
            message: `SMTP configuration is fully functional. Verification email sent successfully to ${recipient}!`,
            messageId: info.messageId
        });
    } catch (err: any) {
        console.error("[SMTP INTEGRATION TEST FAILED]", err);
        res.status(500).json({
            success: false,
            error: err.message || "An unexpected error occurred during the SMTP connection attempt.",
            code: err.code,
            command: err.command
        });
    }
});

appExpress.get('/api/system/next-receipt-number', async (req, res) => {
    if (isSqlActiveEffective) {
        const existing = await readSqlKey('pharma_receipt_counter');
        const nextVal = (Number(existing) || 0) + 1;
        const success = await writeSqlKey('pharma_receipt_counter', nextVal);
        if (success) {
            res.json({ receiptNumber: `R-${nextVal.toString().padStart(6, '0')}` });
        } else {
            res.status(500).json({ error: "Failed to allocate receipt number in PostgreSQL" });
        }
    } else {
        const dbData = readDB();
        dbData.pharma_receipt_counter = (dbData.pharma_receipt_counter || 0) + 1;
        writeDB(dbData);
        res.json({ receiptNumber: `R-${dbData.pharma_receipt_counter.toString().padStart(6, '0')}` });
    }
});

// Export full DB
appExpress.get('/api/system/export', async (req, res) => {
    let output = {};
    if (isSqlActiveEffective) {
        const allData = await sqlDb.select().from(appData);
        allData.forEach(row => {
            output[row.key] = row.value;
        });
    } else {
        output = readDB();
    }
    res.json({ data: output });
});

// Export backup list API
appExpress.get('/api/system/backups', (req, res) => {
    if (!fs.existsSync(BACKUPS_DIR)) {
        return res.json([]);
    }
    const files = fs.readdirSync(BACKUPS_DIR).filter(f => f.startsWith('pharma_db_'));
    res.json(files.map(f => ({
        filename: f,
        date: f.replace('pharma_db_', '').replace('.json', '')
    })).sort((a, b) => b.date.localeCompare(a.date)));
});

appExpress.get('/api/system/backups/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!filename.startsWith('pharma_db_') || !filename.endsWith('.json')) {
        return res.status(400).send('Invalid backup request');
    }
    const filePath = path.join(BACKUPS_DIR, filename);
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Backup not found');
    }
    res.download(filePath);
});

// Vite middleware for development
async function startServer() {
  // Run initial checks and background intervals
  performPeriodicBackup();
  setInterval(performPeriodicBackup, 60 * 60 * 1000);
  
  performNotificationsRuns();
  setInterval(performNotificationsRuns, 60 * 60 * 1000);

  // Initialize database bootstrap and probe in the background so it never blocks the server startup or port 3000 bind
  Promise.resolve().then(async () => {
    try {
      console.log("[BACKGROUND DB INIT] Starting database bootstrap and probe...");
      // Bootstrap the table structure in the database if connection parameters exist
      await bootstrapDatabaseSchema();

      // Probe database connection quality to determine storage mode
      await probeSql();

      if (isSqlActiveEffective) {
          try {
              const info = await readSqlKey('pharma_info');
              if (!info) {
                  console.log("[SEEDING] Database is empty. Migration from local JSON starting...");
                  const dbData = readDB();
                  
                  await writeSqlKey('pharma_info', dbData.pharma_info || null);
                  await writeSqlKey('pharma_products', dbData.pharma_products || []);
                  await writeSqlKey('pharma_sales', dbData.pharma_sales || []);
                  await writeSqlKey('pharma_users_db', dbData.pharma_users_db || []);
                  await writeSqlKey('pharma_customers_db', dbData.pharma_customers_db || []);
                  await writeSqlKey('pharma_suppliers', dbData.pharma_suppliers || []);
                  await writeSqlKey('pharma_activity_logs', dbData.pharma_activity_logs || []);
                  await writeSqlKey('pharma_receipt_counter', dbData.pharma_receipt_counter || 0);
                  
                  if (dbData.bincards) {
                      for (const pid of Object.keys(dbData.bincards)) {
                          await writeSqlKey(`pharma_bincard_${pid}`, dbData.bincards[pid]);
                      }
                  }
                  console.log("[SEEDING] Database seeded successfully from local JSON.");
              }
          } catch (err) {
              console.error("Failed to seed database from local JSON on startup:", err);
          }
      } else {
          console.log("[BACKGROUND DB INIT] Database is offline or probe failed. Smoothly using offline local JSON storage.");
      }
    } catch (dbInitErr: any) {
      console.error("[BACKGROUND DB INIT] Database initialization failed. Using safe offline local JSON storage fallback.", dbInitErr.message || dbInitErr);
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = require("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    appExpress.use(vite.middlewares);
  } else {
    // In production, server.cjs runs from inside 'dist' folder
    const distPath = __dirname;
    appExpress.use(express.static(distPath));
    appExpress.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`[MASTER SERVER] Active at: http://${getLocalIP()}:${PORT}`);
  });
}

startServer();
