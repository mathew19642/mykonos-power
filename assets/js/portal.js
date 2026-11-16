document.addEventListener('DOMContentLoaded', () => {
    // UI Elements - State Managed
    const elements = {
        mainView: document.getElementById('portal-main-view'),
        guestView: document.getElementById('portal-guest-view'),
        welcomeMsg: document.getElementById('welcome-msg'),
        headerName: document.getElementById('header-username'),
        headerBalance: document.getElementById('header-balance'),
        idName: document.getElementById('id-full-name'),
        idMeter: document.getElementById('id-meter-number'),
        walletBalance: document.getElementById('main-wallet-balance'),
        tokenList: document.getElementById('token-list-container'),
        communityList: document.getElementById('community-list-container'),
        usageChart: document.getElementById('usageChart')
    };

    // Forms
    const topupForm = document.getElementById('overlay-topup-form');
    const buyForm = document.getElementById('overlay-buy-form');

    let usageChart = null;

    // Direct Boot
    render();
    window.addEventListener('focus', render);

    async function pullFreshUserData() {
        const sessionUser = Auth.getCurrentUser();
        if (!sessionUser) return;
        return await Auth.getCurrentUserAsync();
    }

    async function render() {
        // Fetch fresh user data from API instead of local storage mirror
        const sessionUser = Auth.getCurrentUser();
        
        if (!sessionUser) {
            elements.mainView.style.display = 'none';
            elements.guestView.style.display = 'block';
            return;
        }

        const user = await Auth.getCurrentUserAsync();

        if (!user) {
            elements.mainView.style.display = 'none';
            elements.guestView.style.display = 'block';
            return;
        }

        elements.guestView.style.display = 'none';
        elements.mainView.style.display = 'grid';

        // Profile & Header
        const first = user.name.split(' ')[0];
        elements.welcomeMsg.textContent = `Hello, ${first}`;
        elements.headerName.textContent = first;
        elements.idName.textContent = user.name;
        elements.idMeter.textContent = `METER: ${user.meter.replace(/(\d{4})(\d{4})(\d{3})/, '$1 $2 $3')}`;

        // Balances
        const bal = `KES ${(user.walletBalance || 0).toLocaleString()}`;
        elements.walletBalance.textContent = bal;
        elements.headerBalance.textContent = bal;

        // Sub-systems
        renderTokens(user.meter);
        renderChart();
    }

    async function renderTokens(meter) {
        try {
            const res = await fetch('/api/tokens/vault');
            const txs = await res.json();
            const myTxs = txs.filter(t => t.meter === meter).slice(0, 4);

            elements.tokenList.innerHTML = '';
            if (myTxs.length === 0) {
                elements.tokenList.innerHTML = '<p style="opacity:0.3; font-size:0.8rem; padding:10px;">Token vault empty.</p>';
                return;
            }

            myTxs.forEach(tx => {
                const row = document.createElement('div');
                row.className = 'token-pill';
                row.innerHTML = `
                    <div>
                        <div style="font-family:monospace; letter-spacing:2px; font-weight:700; color:var(--success-color); font-size:1.1rem;">${tx.token}</div>
                        <div style="font-size:0.65rem; opacity:0.5; margin-top:5px;">KES ${parseInt(tx.amount).toLocaleString()} • ${new Date(tx.date).toLocaleDateString()}</div>
                    </div>
                    <button class="token-copy-btn" onclick="copyToClipboard('${tx.token}', this)">COPY</button>
                `;
                elements.tokenList.appendChild(row);
            });
        } catch (error) {
            console.error("Failed to load tokens:", error);
            elements.tokenList.innerHTML = '<p style="color:red; font-size:0.8rem; padding:10px;">Error loading tokens.</p>';
        }
    }


    function renderChart() {
        if (!elements.usageChart) return;
        const ctx = elements.usageChart.getContext('2d');
        if (usageChart) usageChart.destroy();

        usageChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                datasets: [{
                    data: [120, 150, 110, 180, 190, 140, 160],
                    borderColor: '#3500d3',
                    borderWidth: 3,
                    tension: 0.4,
                    pointRadius: 0,
                    fill: true,
                    backgroundColor: 'rgba(53, 0, 211, 0.1)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { display: false },
                    y: { display: false }
                }
            }
        });
    }

    // Handlers
    topupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amtInput = document.getElementById('overlay-wallet-amount');
        const amount = parseInt(amtInput.value);
        
        const btn = e.target.querySelector('button');
        btn.innerHTML = 'Syncing...';
        btn.disabled = true;

        if (await Auth.updateBalance(amount)) {
            alert(`CREDIT SYNC SUCCESSFUL: KES ${amount.toLocaleString()} added to vault.`);
            await pullFreshUserData(); // Ask the server for the new Balance before we re-draw the screen
            render();
            amtInput.value = '';
            document.getElementById('topup-overlay').style.display = 'none';
        } else {
            alert('SYSTEM ERROR: Handshake with wallet failed. Please re-authenticate.');
        }
        btn.innerHTML = 'Add Credits to Vault';
        btn.disabled = false;
    });

    const withdrawForm = document.getElementById('overlay-withdraw-form');
    if (withdrawForm) {
        withdrawForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const amtInput = document.getElementById('overlay-withdraw-amount');
            const amount = parseInt(amtInput.value);
            const user = Auth.getCurrentUser();

            if (user.walletBalance < amount) {
                alert('INSUFFICIENT FUNDS: Withdrawal amount exceeds available balance.');
                return;
            }

            const btn = e.target.querySelector('button');
            btn.innerHTML = 'Processing...';
            btn.disabled = true;

            if (await Auth.updateBalance(-amount)) {
                alert(`WITHDRAWAL SUCCESSFUL: KES ${amount.toLocaleString()} removed from vault.`);
                await pullFreshUserData(); // Ask the server for the new Balance before we re-draw the screen
                render();
                amtInput.value = '';
                document.getElementById('withdraw-overlay').style.display = 'none';
            } else {
                alert('SYSTEM ERROR: Withdrawal processing failed.');
            }
            btn.innerHTML = 'Withdraw Funds';
            btn.disabled = false;
        });
    }

    buyForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const amtInput = document.getElementById('overlay-token-amount');
        const amount = parseInt(amtInput.value);
        const user = Auth.getCurrentUser();

        if (user.walletBalance < amount) {
            alert('Vault Insufficient. Please add credits.');
            return;
        }

        const btn = e.target.querySelector('button');
        btn.innerHTML = 'Generating...';
        btn.disabled = true;

        // Note: For a real production app we would want this generation API call
        // to handle the balance deduction atomically against the database 
        // rather than splitting it up.
        await Auth.updateBalance(-amount);

        try {
            const res = await fetch('/api/tokens/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meter: user.meter, amount, notifySms: false, notifyEmail: false, customerName: user.name }) // self-buy notifications
            });
            const data = await res.json();

            if (data.success) {
                alert(`CRYPTOGRAPHIC TOKEN SECURED: ${data.transaction.token}`);
                render();
                amtInput.value = '';
                document.getElementById('buy-overlay').style.display = 'none';
            } else {
                alert('API Error: ' + data.error);
                // Refund them if generation fails
                await Auth.updateBalance(amount); 
            }
        } catch (error) {
            console.error('API Contact Failed', error);
            alert("Could not reach the Mykonos Server.");
            // Refund them if generation fails
            await Auth.updateBalance(amount); 
        } finally {
            btn.innerHTML = 'Generate Secure Token';
            btn.disabled = false;
        }
    });
});

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        const old = btn.textContent;
        btn.textContent = 'SAVED';
        setTimeout(() => btn.textContent = old, 1500);
    });
}
