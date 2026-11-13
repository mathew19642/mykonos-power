const Auth = {
    register: async (name, email, password) => {
        try {
            const res = await fetch('http://localhost:3000/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password })
            });
            const data = await res.json();
            return data.success;
        } catch (error) {
            console.error("Registration failed:", error);
            return false;
        }
    },

    login: async (identifier, password) => {
        const ident = identifier.trim();

        try {
            const res = await fetch('http://localhost:3000/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier: ident, password })
            });

            const data = await res.json();

            if (data.success && data.user) {
                localStorage.setItem('mykonos_current_user', JSON.stringify(data.user));
                return { success: true, user: data.user };
            }
            return { success: false, error: 'INVALID_CREDENTIALS' };
        } catch (error) {
            console.error("Login failed:", error);
            return { success: false, error: 'NETWORK_ERROR' };
        }
    },

    updateBalance: async (amount) => {
        const currentUser = Auth.getCurrentUser();
        if (!currentUser) return false;

        try {
            const res = await fetch(`http://localhost:3000/api/users/${currentUser.meter}/balance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount })
            });

            const data = await res.json();

            if (data.success) {
                // Sync current session to reflect changes immediately
                currentUser.walletBalance = data.newBalance;
                localStorage.setItem('mykonos_current_user', JSON.stringify(currentUser));
                return true;
            }
            return false;
        } catch (error) {
            console.error("Balance update failed:", error);
            return false;
        }
    },

    isAdmin: () => {
        const user = Auth.getCurrentUser();
        if (!user) return false;
        // Dual verification: role must be admin AND meter must start with 'admin'
        return user.role === 'admin' && user.meter.toLowerCase().startsWith('admin');
    },

    logout: () => {
        localStorage.removeItem('mykonos_current_user');
        window.location.href = 'landing.html';
    },

    getCurrentUser: () => {
        // Technically we should fetch(), but keeping sync getter for simple UI elements
        return JSON.parse(localStorage.getItem('mykonos_current_user'));
    },

    getCurrentUserAsync: async () => {
        const sessionUser = JSON.parse(localStorage.getItem('mykonos_current_user'));
        if (!sessionUser) return null;

        try {
            const res = await fetch(`http://localhost:3000/api/users/${sessionUser.meter}`);
            if (res.ok) {
                const freshUser = await res.json();
                localStorage.setItem('mykonos_current_user', JSON.stringify(freshUser));
                return freshUser;
            }
        } catch (e) {
            console.error("Failed to sync user", e);
        }
        return sessionUser;
    },

    getAllUsers: async () => {
        try {
            const res = await fetch('http://localhost:3000/api/users');
            return await res.json();
        } catch (e) {
            console.error(e);
            return [];
        }
    },

    isAuthenticated: () => {
        return !!localStorage.getItem('mykonos_current_user');
    }
};
