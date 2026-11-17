const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const resend = new Resend(process.env.RESEND_API_KEY || 're_123');

// Supabase Cloud Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;
if (supabase) {
    console.log("Connected to Supabase Cloud Database:", supabaseUrl);
} else {
    console.log("Running in Local File-Database mode (data/db.json)");
}

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));
app.use(express.static(__dirname));

// Route root to index.html explicitly
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Dynamic route to serve any HTML page (e.g., /portal.html, /login.html, /portal, /login)
app.get('/:page', (req, res, next) => {
    if (req.params.page.startsWith('api')) return next();
    const pageName = req.params.page.replace(/\.html$/i, '');
    const htmlFile = path.join(__dirname, `${pageName}.html`);
    if (fs.existsSync(htmlFile)) {
        return res.sendFile(htmlFile);
    }
    next();
});

// DB Path (Fallback for offline/local use)
const DB_PATH = process.env.VERCEL
    ? path.join('/tmp', 'db.json')
    : path.join(__dirname, 'data', 'db.json');

// --- DB Utility Functions (Fallback) ---
function readDB() {
    try {
        if (process.env.VERCEL && !fs.existsSync(DB_PATH)) {
            const seedPath = path.join(__dirname, 'data', 'db.json');
            if (fs.existsSync(seedPath)) {
                fs.copyFileSync(seedPath, DB_PATH);
            }
        }
        const data = fs.readFileSync(DB_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Error reading DB:", err);
        return { users: [], transactions: [] };
    }
}

function writeDB(data) {
    try {
        fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 4));
        return true;
    } catch (err) {
        console.error("Error writing DB:", err);
        return false;
    }
}

// Ensure Admin shadow user exists on boot
const setupInitialDB = () => {
    const db = readDB();
    if (!db.users.find(u => u.role === 'admin')) {
        db.users.push({
            id: Date.now(),
            name: "System Admin",
            meter: "admin_boss",
            role: "admin",
            password: "admin"
        });
        writeDB(db);
    }
};
setupInitialDB();

// --- Auth Routes ---

// Register
app.post('/api/auth/register', async (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: "Name and password required" });

    // Generate 11 digit meter
    let meter = "";
    for (let i = 0; i < 11; i++) meter += Math.floor(Math.random() * 10);

    const newUser = {
        id: Date.now(),
        name,
        email: email || null,
        meter,
        password,
        role: 'customer',
        wallet_balance: 0,
        registration_date: new Date().toISOString()
    };

    if (supabase) {
        try {
            const { data, error } = await supabase.from('users').insert([newUser]).select().single();
            if (error) {
                console.error("Supabase registration error:", error);
                return res.status(500).json({ error: error.message });
            }
            return res.status(201).json({
                success: true,
                user: { id: data.id, name: data.name, meter: data.meter, role: data.role }
            });
        } catch (e) {
            console.error("Supabase exception on register:", e);
        }
    }

    // Fallback to local DB
    const db = readDB();
    const localUser = { ...newUser, walletBalance: 0, registrationDate: newUser.registration_date };
    db.users.push(localUser);
    if (writeDB(db)) {
        res.status(201).json({ success: true, user: { id: localUser.id, name: localUser.name, meter: localUser.meter, role: localUser.role } });
    } else {
        res.status(500).json({ error: "Failed to save user" });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { identifier, password } = req.body;
    const normalizedId = identifier.trim().toLowerCase().replace(/[\s_-]/g, '');

    if (supabase) {
        try {
            const { data: users, error } = await supabase.from('users').select('*');
            if (!error && users) {
                const user = users.find(u => 
                    (u.meter.toLowerCase().replace(/[\s_-]/g, '') === normalizedId && u.password === password) || 
                    (u.name.toLowerCase().replace(/[\s_-]/g, '') === normalizedId && u.password === password)
                );
                if (user) {
                    const authUser = {
                        id: user.id,
                        name: user.name,
                        meter: user.meter,
                        role: user.role,
                        email: user.email,
                        walletBalance: Number(user.wallet_balance || 0)
                    };
                    return res.json({ success: true, user: authUser });
                }
                return res.status(401).json({ error: "Invalid credentials" });
            }
        } catch (e) {
            console.error("Supabase login exception:", e);
        }
    }

    // Fallback to local DB
    const db = readDB();
    const user = db.users.find(u => 
        (u.meter.toLowerCase().replace(/[\s_-]/g, '') === normalizedId && u.password === password) || 
        (u.name.toLowerCase().replace(/[\s_-]/g, '') === normalizedId && u.password === password)
    );

    if (user) {
        const authUser = { id: user.id, name: user.name, meter: user.meter, role: user.role, email: user.email, walletBalance: user.walletBalance || 0 };
        res.json({ success: true, user: authUser });
    } else {
        res.status(401).json({ error: "Invalid credentials" });
    }
});

// Get Current User Info
app.get('/api/users/:meter', async (req, res) => {
    if (supabase) {
        try {
            const { data: user, error } = await supabase
                .from('users')
                .select('*')
                .eq('meter', req.params.meter)
                .maybeSingle();

            if (user) {
                return res.json({
                    id: user.id,
                    name: user.name,
                    meter: user.meter,
                    role: user.role,
                    email: user.email,
                    walletBalance: Number(user.wallet_balance || 0)
                });
            }
        } catch (e) {
            console.error("Supabase get user exception:", e);
        }
    }

    const db = readDB();
    const user = db.users.find(u => u.meter === req.params.meter);
    if (user) {
        res.json({ id: user.id, name: user.name, meter: user.meter, role: user.role, email: user.email, walletBalance: user.walletBalance });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

// Get All Customers (For Admin Dropdown)
app.get('/api/users', async (req, res) => {
    if (supabase) {
        try {
            const { data: users, error } = await supabase
                .from('users')
                .select('id, name, meter, email, role')
                .eq('role', 'customer');

            if (!error && users) {
                return res.json(users);
            }
        } catch (e) {
            console.error("Supabase get all users exception:", e);
        }
    }

    const db = readDB();
    const customers = db.users.filter(u => u.role === 'customer').map(u => ({
        id: u.id, name: u.name, meter: u.meter, email: u.email
    }));
    res.json(customers);
});

// Update Wallet Balance
app.post('/api/users/:meter/balance', async (req, res) => {
    const { amount, user } = req.body;
    const delta = parseInt(amount) || 0;

    if (supabase) {
        try {
            const { data: existingUser } = await supabase
                .from('users')
                .select('*')
                .eq('meter', req.params.meter)
                .maybeSingle();

            if (existingUser) {
                const newBalance = Math.max(0, Number(existingUser.wallet_balance || 0) + delta);
                const { error } = await supabase
                    .from('users')
                    .update({ wallet_balance: newBalance })
                    .eq('meter', req.params.meter);

                if (!error) {
                    return res.json({ success: true, newBalance });
                }
            } else if (user) {
                const newBalance = Math.max(0, delta);
                const { error } = await supabase.from('users').insert([{
                    id: user.id || Date.now(),
                    name: user.name || "Customer",
                    email: user.email || null,
                    meter: req.params.meter,
                    password: user.password || "customer123",
                    role: user.role || 'customer',
                    wallet_balance: newBalance,
                    registration_date: new Date().toISOString()
                }]);
                if (!error) {
                    return res.json({ success: true, newBalance });
                }
            }
        } catch (e) {
            console.error("Supabase balance exception:", e);
        }
    }

    // Fallback to local DB
    const db = readDB();
    let userIndex = db.users.findIndex(u => u.meter === req.params.meter);

    if (userIndex === -1) {
        const restoredUser = {
            id: user?.id || Date.now(),
            name: user?.name || "Customer",
            email: user?.email || "",
            meter: req.params.meter,
            password: user?.password || "customer123",
            role: user?.role || 'customer',
            walletBalance: Math.max(0, delta),
            registrationDate: new Date().toISOString()
        };
        db.users.push(restoredUser);
        writeDB(db);
        return res.json({ success: true, newBalance: restoredUser.walletBalance });
    }

    db.users[userIndex].walletBalance = Math.max(0, (db.users[userIndex].walletBalance || 0) + delta);
    writeDB(db);
    res.json({ success: true, newBalance: db.users[userIndex].walletBalance });
});


// --- Token Orchestration Routes ---

// Vault List
app.get('/api/tokens/vault', async (req, res) => {
    if (supabase) {
        try {
            const { data: txs, error } = await supabase
                .from('transactions')
                .select('*')
                .order('date', { ascending: false });

            if (!error && txs) {
                const mapped = txs.map(t => ({
                    id: t.id,
                    date: t.date,
                    meter: t.meter,
                    token: t.token,
                    amount: Number(t.amount),
                    units: t.units,
                    base: Number(t.base),
                    vat: Number(t.vat),
                    fuel: Number(t.fuel),
                    customerName: t.customer_name,
                    notified: { sms: t.notified_sms, email: t.notified_email }
                }));
                return res.json(mapped);
            }
        } catch (e) {
            console.error("Supabase token vault exception:", e);
        }
    }

    const db = readDB();
    const sortedTxs = db.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(sortedTxs);
});

// Delete Receipt
app.delete('/api/tokens/:id', async (req, res) => {
    if (supabase) {
        try {
            await supabase.from('transactions').delete().eq('id', req.params.id);
        } catch (e) {
            console.error("Supabase delete token exception:", e);
        }
    }
    const db = readDB();
    db.transactions = db.transactions.filter(t => t.id !== req.params.id);
    writeDB(db);
    res.json({ success: true });
});

// Generate Token & Dispatch Email
app.post('/api/tokens/generate', async (req, res) => {
    const { meter, amount, notifySms, notifyEmail } = req.body;

    if (!meter || !amount) {
        return res.status(400).json({ error: "Meter and amount required" });
    }

    let customer = null;
    if (supabase) {
        try {
            const { data } = await supabase.from('users').select('*').eq('meter', meter).maybeSingle();
            customer = data;
        } catch (e) {
            console.error("Supabase fetch customer exception:", e);
        }
    }
    if (!customer) {
        const db = readDB();
        customer = db.users.find(u => u.meter === meter);
    }

    const numAmount = Number(amount);
    const vat = numAmount * 0.16;
    const fuel = numAmount * 0.08;
    const base = numAmount - vat - fuel;
    const units = (base / 25).toFixed(2);

    const generateBlock = () => Math.floor(10000 + Math.random() * 90000);
    const token = `${generateBlock()} ${generateBlock()} ${generateBlock()} ${generateBlock()}`;
    const txnId = `TXN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const customerName = customer ? customer.name : (req.body.customerName || 'Customer');

    const transaction = {
        id: txnId,
        date: new Date().toISOString(),
        meter: meter,
        token: token,
        amount: numAmount,
        units: units,
        base: Number(base.toFixed(2)),
        vat: Number(vat.toFixed(2)),
        fuel: Number(fuel.toFixed(2)),
        customerName: customerName,
        notified: { sms: !!notifySms, email: !!notifyEmail }
    };

    if (supabase) {
        try {
            await supabase.from('transactions').insert([{
                id: txnId,
                date: transaction.date,
                meter: meter,
                token: token,
                amount: numAmount,
                units: units,
                base: transaction.base,
                vat: transaction.vat,
                fuel: transaction.fuel,
                customer_name: customerName,
                notified_sms: !!notifySms,
                notified_email: !!notifyEmail
            }]);
        } catch (e) {
            console.error("Supabase insert transaction exception:", e);
        }
    }

    // Local DB backup
    const db = readDB();
    db.transactions.push(transaction);
    writeDB(db);

    // If Email requested, dispatch via Resend
    let emailStatus = "Not Sent";
    if (notifyEmail && customer && customer.email) {
        try {
            const { data, error } = await resend.emails.send({
                from: 'Mykonos Power <onboarding@resend.dev>',
                to: [customer.email],
                subject: 'Mykonos Power: Token Receipt',
                html: `
                    <div style="font-family: Arial, sans-serif; padding: 20px; background: #0c0032; color: #fff; max-width: 600px; margin: 0 auto; border-radius: 8px;">
                        <h2 style="color: #00fa9a; text-align: center;">Mykonos Power Transcript</h2>
                        <hr style="border-color: rgba(255,255,255,0.1)">
                        <p>Hello <strong>${customer.name}</strong>,</p>
                        <p>Your secure energy token has been generated:</p>
                        <div style="background: rgba(0,0,0,0.5); padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
                            <span style="font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #00fa9a;">${token}</span>
                        </div>
                        <table style="width: 100%; color: #ccc;">
                            <tr><td style="padding: 5px 0;">Meter:</td><td style="text-align: right;">${meter}</td></tr>
                            <tr><td style="padding: 5px 0;">Amount Paid:</td><td style="text-align: right;">KES ${parseInt(numAmount).toLocaleString()}</td></tr>
                            <tr><td style="padding: 5px 0;">Energy Units:</td><td style="text-align: right;">${units} kWh</td></tr>
                            <tr><td style="padding: 5px 0;">Transaction ID:</td><td style="text-align: right;">${txnId}</td></tr>
                        </table>
                        <p style="text-align: center; margin-top: 30px; font-size: 12px; color: #666;">This is an automated system receipt.</p>
                    </div>
                `
            });
            if (error) {
                console.error("Resend Email failed:", error);
                emailStatus = "Failed: " + error.message;
            } else {
                emailStatus = "Sent";
                console.log("Resend Email dispatched:", data);
            }
        } catch (err) {
            console.error("Resend Email system error:", err);
            emailStatus = "Failed";
        }
    }

    res.json({
        success: true,
        transaction,
        emailStatus
    });
});

// Resend Email Receipt
app.post('/api/tokens/:id/email', async (req, res) => {
    let transaction = null;
    let customer = null;

    if (supabase) {
        try {
            const { data: t } = await supabase.from('transactions').select('*').eq('id', req.params.id).maybeSingle();
            if (t) {
                transaction = {
                    ...t,
                    customerName: t.customer_name,
                    notified: { sms: t.notified_sms, email: t.notified_email }
                };
                const { data: u } = await supabase.from('users').select('*').eq('meter', t.meter).maybeSingle();
                customer = u;
            }
        } catch (e) {
            console.error("Supabase resend email query exception:", e);
        }
    }

    if (!transaction) {
        const db = readDB();
        transaction = db.transactions.find(t => t.id === req.params.id);
        if (transaction) {
            customer = db.users.find(u => u.meter === transaction.meter);
        }
    }

    if (!transaction) return res.status(404).json({ error: "Transaction not found" });
    if (!customer || !customer.email) {
        return res.status(400).json({ error: "Customer email not found on file" });
    }

    try {
        const { data, error } = await resend.emails.send({
            from: 'Mykonos Power <onboarding@resend.dev>',
            to: [customer.email],
            subject: 'Mykonos Power: Token Receipt Copy',
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; background: #0c0032; color: #fff; max-width: 600px; margin: 0 auto; border-radius: 8px;">
                    <h2 style="color: #00fa9a; text-align: center;">Mykonos Power Transcript</h2>
                    <hr style="border-color: rgba(255,255,255,0.1)">
                    <p>Hello <strong>${customer.name}</strong>,</p>
                    <p>Here is a copy of your secure energy token:</p>
                    <div style="background: rgba(0,0,0,0.5); padding: 15px; text-align: center; border-radius: 8px; margin: 20px 0;">
                        <span style="font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #00fa9a;">${transaction.token}</span>
                    </div>
                    <table style="width: 100%; color: #ccc;">
                        <tr><td style="padding: 5px 0;">Meter:</td><td style="text-align: right;">${transaction.meter}</td></tr>
                        <tr><td style="padding: 5px 0;">Amount Paid:</td><td style="text-align: right;">KES ${parseInt(transaction.amount).toLocaleString()}</td></tr>
                        <tr><td style="padding: 5px 0;">Energy Units:</td><td style="text-align: right;">${transaction.units} kWh</td></tr>
                        <tr><td style="padding: 5px 0;">Transaction ID:</td><td style="text-align: right;">${transaction.id}</td></tr>
                    </table>
                    <p style="text-align: center; margin-top: 30px; font-size: 12px; color: #666;">This is an automated system receipt.</p>
                </div>
            `
        });

        if (error) {
            console.error("Resend Email failed:", error);
            return res.status(400).json({ error: error.message });
        }

        console.log("Resend Email Copy dispatched successfully:", data);

        if (supabase) {
            await supabase.from('transactions').update({ notified_email: true }).eq('id', transaction.id);
        }

        const db = readDB();
        const localTx = db.transactions.find(t => t.id === transaction.id);
        if (localTx) {
            localTx.notified = localTx.notified || {};
            localTx.notified.email = true;
            writeDB(db);
        }

        res.json({ success: true, message: "Email sent successfully" });
    } catch (err) {
        console.error("Resend Email system error:", err);
        res.status(500).json({ error: "Failed to send email" });
    }
});

if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Mykonos API Server running on http://localhost:${PORT}`);
    });
}

module.exports = app;
