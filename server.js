const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const resend = new Resend(process.env.RESEND_API_KEY || 're_123'); // Fallback to prevent crash if not set

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files from current directory
app.use(express.static(__dirname));

// DB Path
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// --- DB Utility Functions ---
function readDB() {
    try {
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
app.post('/api/auth/register', (req, res) => {
    const { name, email, password } = req.body;
    if (!name || !password) return res.status(400).json({ error: "Name and password required" });

    const db = readDB();

    // Generate 11 digit meter
    let meter = "";
    do {
        meter = "";
        for (let i = 0; i < 11; i++) meter += Math.floor(Math.random() * 10);
    } while (db.users.find(u => u.meter === meter));

    const newUser = {
        id: Date.now(),
        name,
        email,
        meter,
        password, // In a prod app, this should be HASHED (e.g. bcrypt)
        role: 'customer',
        walletBalance: 0,
        registrationDate: new Date().toISOString()
    };

    db.users.push(newUser);
    if (writeDB(db)) {
        res.status(201).json({ success: true, user: { id: newUser.id, name: newUser.name, meter: newUser.meter, role: newUser.role } });
    } else {
        res.status(500).json({ error: "Failed to save user" });
    }
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { identifier, password } = req.body;
    const db = readDB();

    // Robust Match: Ignore spaces, underscores, and dashes
    const normalizedId = identifier.toLowerCase().replace(/[\s_-]/g, '');
    const user = db.users.find(u => 
        (u.meter.toLowerCase().replace(/[\s_-]/g, '') === normalizedId && u.password === password) || 
        (u.name.toLowerCase().replace(/[\s_-]/g, '') === normalizedId && u.password === password)
    );

    if (user) {
        // Return user object without password
        const authUser = { id: user.id, name: user.name, meter: user.meter, role: user.role, email: user.email };
        res.json({ success: true, user: authUser });
    } else {
        res.status(401).json({ error: "Invalid credentials" });
    }
});

// Get Current User Info
app.get('/api/users/:meter', (req, res) => {
    const db = readDB();
    const user = db.users.find(u => u.meter === req.params.meter);
    if (user) {
        const safeUser = { id: user.id, name: user.name, meter: user.meter, role: user.role, email: user.email, walletBalance: user.walletBalance };
        res.json(safeUser);
    } else {
        res.status(404).json({ error: "User not found" });
    }
});

// Get All Customers (For Admin Dropdown)
app.get('/api/users', (req, res) => {
    const db = readDB();
    const customers = db.users.filter(u => u.role === 'customer').map(u => ({
        id: u.id, name: u.name, meter: u.meter, email: u.email
    }));
    res.json(customers);
});

// Update Wallet Balance
app.post('/api/users/:meter/balance', (req, res) => {
    const { amount } = req.body;
    const db = readDB();
    const userIndex = db.users.findIndex(u => u.meter === req.params.meter);

    if (userIndex !== -1) {
        db.users[userIndex].walletBalance = (db.users[userIndex].walletBalance || 0) + parseInt(amount);
        writeDB(db);
        res.json({ success: true, newBalance: db.users[userIndex].walletBalance });
    } else {
        res.status(404).json({ error: "User not found" });
    }
});


// --- Token Orchestration Routes ---

// Vault List
app.get('/api/tokens/vault', (req, res) => {
    const db = readDB();
    // In production we would sort and paginate via DB queries
    const sortedTxs = db.transactions.sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json(sortedTxs);
});

// Delete Receipt
app.delete('/api/tokens/:id', (req, res) => {
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

    const db = readDB();
    const customer = db.users.find(u => u.meter === meter);

    // Core STS generation logic (simulated)
    const vat = amount * 0.16;
    const fuel = amount * 0.08;
    const base = amount - vat - fuel;
    const units = (base / 25).toFixed(2);

    const generateBlock = () => Math.floor(10000 + Math.random() * 90000);
    const token = `${generateBlock()} ${generateBlock()} ${generateBlock()} ${generateBlock()}`;
    const txnId = `TXN-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    const transaction = {
        id: txnId,
        date: new Date().toISOString(),
        meter: meter,
        token: token,
        amount: amount,
        units: units,
        base: base,
        vat: vat,
        fuel: fuel,
        customerName: customer ? customer.name : 'Unregistered Meter',
        notified: { sms: notifySms, email: notifyEmail }
    };

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
                            <tr><td style="padding: 5px 0;">Amount Paid:</td><td style="text-align: right;">KES ${parseInt(amount).toLocaleString()}</td></tr>
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
    const db = readDB();
    const transaction = db.transactions.find(t => t.id === req.params.id);

    if (!transaction) return res.status(404).json({ error: "Transaction not found" });

    const customer = db.users.find(u => u.meter === transaction.meter);

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

        transaction.notified = transaction.notified || {};
        transaction.notified.email = true;
        writeDB(db);

        res.json({ success: true, message: "Email sent successfully" });
    } catch (err) {
        console.error("Resend Email system error:", err);
        res.status(500).json({ error: "Failed to send email" });
    }
});

app.listen(PORT, () => {
    console.log(`Mykonos API Server running on http://localhost:${PORT}`);
});
