document.addEventListener('DOMContentLoaded', () => {
    // Shared Logic (e.g., active state, mocking data if empty)

    // Initialize Mock Data if empty
    // Initialize Mock Data if empty
    // Mock data removed for clean state
    if (!localStorage.getItem('transactions')) {
        localStorage.setItem('transactions', JSON.stringify([]));
    }

    // Update Dashboard Stats if on dashboard
    const totalRevenueEl = document.getElementById('total-revenue');
    if (totalRevenueEl) {
        // Fetch from API instead of localStorage
        fetch('/api/tokens/vault')
            .then(res => res.json())
            .then(transactions => {
                const total = transactions.reduce((sum, tx) => sum + parseInt(tx.amount), 0);
                totalRevenueEl.textContent = `KES ${total.toLocaleString()}`;

                const tokensIssuedEl = document.getElementById('tokens-issued');
                if (tokensIssuedEl) tokensIssuedEl.textContent = transactions.length;

                // Recent Activity population
                const activityList = document.getElementById('recent-activity-list');
                if (activityList) {
                    activityList.innerHTML = '';
                    transactions.slice(0, 5).forEach(tx => {
                        const item = document.createElement('div');
                        item.className = 'activity-item';
                        item.innerHTML = `
                            <div style="display: flex; justify-content: space-between; width: 100%;">
                                <span>Meter: ${tx.meter}</span>
                                <span class="activity-amount">+KES ${tx.amount}</span>
                            </div>
                        `;
                        activityList.appendChild(item);
                    });
                }
            })
            .catch(err => console.error("Failed to load dashboard stats", err));
    }

    // Load User Profile Name from Auth or LocalStorage
    const currentUser = Auth.getCurrentUser();
    const profileEl = document.querySelector('.user-profile');

    if (profileEl) {
        if (currentUser) {
            const nameEl = profileEl.querySelector('span') || profileEl;
            nameEl.textContent = currentUser.name;
            profileEl.style.cursor = 'pointer';
            profileEl.onclick = () => { if (confirm('Logout?')) Auth.logout(); };

            // Add logout icon if missing
            if (!profileEl.querySelector('.ri-logout-box-r-line')) {
                const logoutIcon = document.createElement('i');
                logoutIcon.className = 'ri-logout-box-r-line';
                logoutIcon.style.marginLeft = '10px';
                logoutIcon.style.opacity = '0.7';
                profileEl.appendChild(logoutIcon);
            }
        }
    }

    // Role-Based Routing Guard
    const path = window.location.pathname;
    const adminPages = ['index.html', 'generate.html', 'history.html', 'settings.html'];
    const authPages = ['login.html', 'register.html', 'landing.html'];

    // Skip guards for auth-related pages (including landing)
    if (!authPages.some(p => path.includes(p))) {
        if (!Auth.isAuthenticated()) {
            window.location.href = 'landing.html';
            return;
        }

        const isTryingAdmin = adminPages.some(p => path.includes(p)) || path === '/' || path.endsWith('/mykonos/');
        if (isTryingAdmin && !Auth.isAdmin()) {
            alert('Access Denied: Administrative Credentials Required');
            window.location.href = 'portal.html';
            return;
        }
    }

    // Admin Dashboard Specific Logic
    if (path.includes('index.html') || path === '/' || path.endsWith('/mykonos/')) {
        const usersCountEl = document.getElementById('total-customers');
        const revenueEl = document.getElementById('total-revenue');
        const tokensCountEl = document.getElementById('tokens-issued');
        const activityList = document.getElementById('recent-activity-list');

        // Fetch users to get count
        Auth.getAllUsers().then(users => {
            if (usersCountEl) usersCountEl.textContent = users.length.toLocaleString();
        });

        // Let the fetch block above handle the revenue and tokens, this block is somewhat redundant 
        // in the original code, but keeping structure to prevent breaking other elements if they rely on it.
    }

    // View Switcher logic (detect current page)
    const isPortal = path.includes('portal.html');
    if (isPortal) {
        document.body.classList.add('customer-view');
        const portalLink = document.querySelector('nav a[href="portal.html"]');
        if (portalLink) portalLink.classList.add('active');

        // Hide Admin elements for standard customers
        if (!Auth.isAdmin()) {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
            const portalLink = document.querySelector('nav a[href="portal.html"]');
            if (portalLink) portalLink.classList.add('active');
        }
    } else {
        document.body.classList.add('admin-view');
    }
});

