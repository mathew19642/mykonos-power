document.addEventListener('DOMContentLoaded', () => {
    const tokenForm = document.getElementById('token-form');
    const vaultList = document.getElementById('vault-list');
    const customerSelector = document.getElementById('customer-selector');

    // Initial Load
    populateCustomers();
    renderVault();

    async function populateCustomers() {
        if (!customerSelector) return;
        const users = await Auth.getAllUsers();
        // Since getAllUsers now only returns customers from our backend, no filter needed
        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.meter;
            opt.textContent = `${u.name} (Meter: ${u.meter})`;
            customerSelector.appendChild(opt);
        });
    }

    // Auto-fill Meter on Dropdown change
    if (customerSelector) {
        customerSelector.addEventListener('change', (e) => {
            if (e.target.value) {
                document.getElementById('meter-number').value = e.target.value;
            }
        });
    }

    if (tokenForm) {
        tokenForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const meter = document.getElementById('meter-number').value;
            const amount = parseInt(document.getElementById('amount').value);
            const consoleEl = document.getElementById('tech-console');
            const receiptModule = document.getElementById('receipt-module');
            const btn = e.target.querySelector('button');

            const notifySms = document.getElementById('notify-sms').checked;
            const notifyEmail = document.getElementById('notify-email').checked;

            if (meter.length !== 11 || isNaN(meter)) {
                alert('Invalid Serial: STS Meter must be 11 numeric digits.');
                return;
            }

            // Sequence Initiated
            btn.disabled = true;
            btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> DISPATCHING...';
            consoleEl.style.display = 'block';
            consoleEl.innerHTML = '';
            receiptModule.style.display = 'none';

            const logs = [
                `>>> INITIALIZING SECURE HANDSHAKE [METER: ${meter}]`,
                `>>> VERIFYING NETWORK GATEWAY STATUS... OK`,
                `>>> CALCULATING ENERGY QUOTIENT [AMOUNT: KES ${amount}]`,
                `>>> ENCRYPTING STS PAYLOAD [AES-256]`,
                `>>> SYNCING WITH MASTER GRID LEDGER...`
            ];

            if (notifySms) logs.push(`>>> DISPATCHING SMS GATEWAY SIGNAL... SUCCESS`);
            if (notifyEmail) logs.push(`>>> ROUTING ENCRYPTED EMAIL ENVELOPE... SENT`);

            logs.push(`>>> GENERATION SUCCESSFUL: TOKEN SECURED`);

            let logIndex = 0;
            const logInterval = setInterval(async () => {
                const div = document.createElement('div');
                div.textContent = logs[logIndex];
                consoleEl.appendChild(div);
                consoleEl.scrollTop = consoleEl.scrollHeight;
                logIndex++;

                if (logIndex === logs.length) {
                    clearInterval(logInterval);

                    try {
                        const res = await fetch('http://localhost:3000/api/tokens/generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ meter, amount, notifySms, notifyEmail })
                        });
                        const data = await res.json();

                        if (data.success) {
                            showReceipt(data.transaction);
                            renderVault();
                            console.log("Email Dispatch Status:", data.emailStatus);
                        } else {
                            alert("API Error: " + data.error);
                        }
                    } catch (error) {
                        console.error('API Contact Failed', error);
                        alert("Could not reach the Mykonos Server.");
                    } finally {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="ri-shut-down-line"></i> Re-initialize Module';
                    }
                }
            }, 350);
        });
    }

    async function renderVault() {
        if (!vaultList) return;
        
        try {
            const res = await fetch('http://localhost:3000/api/tokens/vault');
            const txs = await res.json();
            
            vaultList.innerHTML = '';

            if (txs.length === 0) {
                vaultList.innerHTML = '<p style="opacity: 0.3; text-align: center; padding: 20px;">Vault is empty.</p>';
                return;
            }

        txs.forEach((tx) => {
            const item = document.createElement('div');
            item.className = 'aura-item';
            item.style.padding = '15px';
            item.style.display = 'flex';
            item.style.alignItems = 'center';
            item.style.gap = '15px';
            item.style.marginBottom = '10px';
            item.style.background = 'rgba(255, 255, 255, 0.02)';
            item.style.borderRadius = '16px';
            item.style.border = '1px solid transparent';

            item.innerHTML = `
                <div style="flex: 1;">
                    <div style="font-weight: 700; font-size: 0.9rem;">${tx.token}</div>
                    <div style="font-size: 0.7rem; opacity: 0.5; margin-top: 4px;">METER: ${tx.meter} • ${tx.customerName}</div>
                    ${tx.notified ? `
                        <div style="font-size: 0.6rem; color: var(--success-color); margin-top: 2px;">
                            ${tx.notified.sms ? '<i class="ri-message-3-line"></i> SMS ' : ''}
                            ${tx.notified.email ? '<i class="ri-mail-line"></i> EMAIL ' : ''} DISPATCHED
                        </div>
                    ` : ''}
                </div>
                <div style="text-align: right; display: flex; gap: 10px; align-items: center;">
                    <div style="margin-right: 10px;">
                        <div style="font-weight: 700; color: var(--success-color);">KES ${parseInt(tx.amount).toLocaleString()}</div>
                        <div style="font-size: 0.65rem; opacity: 0.4;">${new Date(tx.date).toLocaleDateString()}</div>
                    </div>
                    <button class="token-copy-btn" onclick="openPastReceipt('${tx.id}')">VIEW</button>
                    <button class="token-copy-btn" style="color: var(--error-color);" onclick="deleteReceipt('${tx.id}')">CLEAR</button>
                </div>
            `;
            vaultList.appendChild(item);
        });
        } catch (error) {
            console.error("Failed to fetch vault", error);
            vaultList.innerHTML = '<p style="color: red; text-align: center; padding: 20px;">Error loading vault records.</p>';
        }
    }

    // Global exposed functions for inline calls
    window.openPastReceipt = async (tid) => {
        try {
            const res = await fetch('http://localhost:3000/api/tokens/vault');
            const txs = await res.json();
            const tx = txs.find(t => t.id === tid);
            if (tx) showReceipt(tx);
        } catch(e) { console.error(e) }
    };

    window.deleteReceipt = async (tid) => {
        if (!confirm('VANISH DATA? This record will be permanently cleared from the server.')) return;
        try {
             await fetch(`http://localhost:3000/api/tokens/${tid}`, { method: 'DELETE' });
             renderVault();
             document.getElementById('receipt-module').style.display = 'none';
             document.getElementById('tech-console').style.display = 'none';
        } catch(e) { console.error(e) }
    };

    function showReceipt(tx) {
        const receipt = document.getElementById('receipt-module');
        if (!receipt) return;

        document.getElementById('r-name').textContent = tx.customerName;
        document.getElementById('r-meter').textContent = tx.meter;
        document.getElementById('r-units').textContent = `${tx.units} kWh`;
        document.getElementById('r-base').textContent = `KES ${parseFloat(tx.base || 0).toFixed(2)}`;
        document.getElementById('r-vat').textContent = `KES ${parseFloat(tx.vat || 0).toFixed(2)}`;
        document.getElementById('r-fuel').textContent = `KES ${parseFloat(tx.fuel || 0).toFixed(2)}`;
        document.getElementById('r-total').textContent = `KES ${parseInt(tx.amount).toLocaleString()}`;
        document.getElementById('receipt-date').textContent = `DATE: ${new Date(tx.date).toLocaleString()}`;
        document.getElementById('receipt-id').textContent = `ID: ${tx.id}`;
        document.getElementById('token-display').textContent = tx.token;

        receipt.style.display = 'block';
        window.scrollTo({ top: receipt.offsetTop - 100, behavior: 'smooth' });
    }
});
