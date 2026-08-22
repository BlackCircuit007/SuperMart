/* ============================================================
 *  TRIUMPHSMART — API Client
 *  Handles all communication with the backend server.
 *  Uses JWT tokens stored in localStorage for authentication.
 * ============================================================ */

const API_BASE = window.TRIUMPHSMART_API_BASE ||
    ((window.LordTempsDesktop && window.LordTempsDesktop.isDesktop)
        ? window.location.origin
        : ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port !== '3000'
            ? 'http://localhost:3000'
            : window.location.origin));

// ===== Token Management =====
function getToken() {
    return localStorage.getItem('tm_token');
}

function setToken(token) {
    localStorage.setItem('tm_token', token);
}

function clearToken() {
    localStorage.removeItem('tm_token');
}

function getCurrentUser() {
    try {
        return JSON.parse(localStorage.getItem('tm_user'));
    } catch (e) {
        return null;
    }
}

function setCurrentUser(user) {
    localStorage.setItem('tm_user', JSON.stringify(user));
}

function clearCurrentUser() {
    localStorage.removeItem('tm_user');
}

function isLoggedIn() {
    return !!getToken() && !!getCurrentUser();
}

function logout() {
    clearToken();
    clearCurrentUser();
    updateAuthUI();
    window.location.href = 'index.html';
}

// Give immediate feedback for every action that makes a server-side change.
// This stops accidental duplicate registrations, orders, product changes, and
// worker/admin actions while a slow request is still in progress.
function setRequestControlLoading(method) {
    if (method === 'GET' || method === 'HEAD') return function () {};

    const active = document.activeElement;
    const control = active && active.closest
        ? active.closest('button, input[type="submit"], a')
        : null;
    if (!control || control.dataset.requestPending === 'true') return function () {};

    const wasDisabled = 'disabled' in control ? control.disabled : false;
    const previousBusy = control.getAttribute('aria-busy');
    control.dataset.requestPending = 'true';
    control.classList.add('is-request-pending');
    control.setAttribute('aria-busy', 'true');
    if ('disabled' in control) control.disabled = true;

    return function () {
        delete control.dataset.requestPending;
        control.classList.remove('is-request-pending');
        if (previousBusy === null) control.removeAttribute('aria-busy');
        else control.setAttribute('aria-busy', previousBusy);
        if ('disabled' in control) control.disabled = wasDisabled;
    };
}

// ===== API Request Helper =====
async function apiRequest(endpoint, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const clearLoadingState = setRequestControlLoading(method);
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    const token = getToken();
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }

    try {
        const response = await fetch(API_BASE + endpoint, {
            ...options,
            headers
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            const error = new Error(data.error || 'Request failed');
            error.status = response.status;
            error.data = data;
            throw error;
        }

        return data;
    } finally {
        clearLoadingState();
    }
}

// ===== Auth API =====
async function apiRegister(name, email, password) {
    return apiRequest('/api/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
    });
}

async function apiVerify(email, code) {
    const data = await apiRequest('/api/verify', {
        method: 'POST',
        body: JSON.stringify({ email, code })
    });
    setToken(data.token);
    setCurrentUser(data.user);
    return data;
}

async function apiResendVerification(email) {
    return apiRequest('/api/verify/resend', {
        method: 'POST',
        body: JSON.stringify({ email })
    });
}

async function apiEmailLogin(token) {
    const data = await apiRequest('/api/auth/email-login', {
        method: 'POST',
        body: JSON.stringify({ token })
    });
    setToken(data.token);
    setCurrentUser(data.user);
    return data;
}

async function apiLogin(email, password, loginCode) {
    const data = await apiRequest('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, loginCode })
    });
    setToken(data.token);
    setCurrentUser(data.user);
    return data;
}

async function apiGetMe() {
    return apiRequest('/api/me');
}

// ===== Product API =====
async function apiGetProducts() {
    const data = await apiRequest('/api/products');
    return data.products;
}

async function apiGetProduct(id) {
    const data = await apiRequest('/api/products/' + id);
    return data.product;
}

async function apiAddProduct(product) {
    return apiRequest('/api/products', {
        method: 'POST',
        body: JSON.stringify(product)
    });
}

async function apiUpdateProduct(id, product) {
    return apiRequest('/api/products/' + id, {
        method: 'PUT',
        body: JSON.stringify(product)
    });
}

async function apiDeleteProduct(id) {
    return apiRequest('/api/products/' + id, {
        method: 'DELETE'
    });
}

// ===== Order API =====
async function apiPlaceOrder(order) {
    return apiRequest('/api/orders', {
        method: 'POST',
        body: JSON.stringify(order)
    });
}

async function apiGetMyOrders() {
    const data = await apiRequest('/api/orders');
    return data.orders;
}

async function apiGetAllOrders() {
    const data = await apiRequest('/api/admin/orders');
    return data.orders;
}

async function apiUpdateOrderStatus(id, status, paymentStatus) {
    return apiRequest('/api/admin/orders/' + id, {
        method: 'PUT',
        body: JSON.stringify({ status, payment_status: paymentStatus })
    });
}

// ===== Payment API =====
async function apiSubmitPaymentVerification(details) {
    return apiRequest('/api/payments/verify', {
        method: 'POST',
        body: JSON.stringify(details)
    });
}

// ===== Worker API (Admin only) =====
async function apiAddWorker(name, email) {
    return apiRequest('/api/admin/workers', {
        method: 'POST',
        body: JSON.stringify({ name, email })
    });
}

async function apiGetWorkers() {
    const data = await apiRequest('/api/admin/workers');
    return data.workers;
}

async function apiDeleteWorker(id) {
    return apiRequest('/api/admin/workers/' + id, {
        method: 'DELETE'
    });
}

// ===== Admin Stats & Reports =====
async function apiGetAdminStats() {
    return apiRequest('/api/admin/stats');
}

// ===== Cart API =====
async function apiSaveCart(items) {
    const normalizedItems = (items || []).map(function (item) {
        return {
            id: item.id,
            name: item.name,
            price: Number(item.price) || 0,
            quantity: Math.max(1, Number(item.quantity) || 1),
            image: item.image || '🛍️'
        };
    });
    return apiRequest('/api/cart', {
        method: 'POST',
        body: JSON.stringify({ items: normalizedItems })
    });
}

async function apiGetCart() {
    const data = await apiRequest('/api/cart');
    return data.items;
}

// ===== CSV Export =====
function exportOrdersCSV() {
    const token = getToken();
    if (!token) return;
    window.open(API_BASE + '/api/admin/export/orders?token=' + token, '_blank');
}

function exportProductsCSV() {
    const token = getToken();
    if (!token) return;
    window.open(API_BASE + '/api/admin/export/products?token=' + token, '_blank');
}

// ===== Auth UI Update =====
function updateAuthUI() {
    const user = getCurrentUser();
    const authAction = document.getElementById('authAction');
    const signupBtn = document.getElementById('signupBtn');
    const mobileLoginLink = document.getElementById('mobileLoginLink');
    const navActions = document.querySelector('.navbar .nav-actions');

    // Remove any existing profile trigger
    const existing = document.getElementById('profileContainer');
    if (existing) existing.remove();

    if (user) {
        if (authAction) authAction.style.display = 'none';
        if (signupBtn) signupBtn.style.display = 'none';
        // Role-aware home link: admins return to the admin panel, workers to
        // the worker portal, buyers to their dashboard.
        var dashHref = 'dashboard.html';
        if (user.role === 'worker') dashHref = 'worker.html';
        else if (user.role === 'admin') dashHref = 'admin.html';
        if (mobileLoginLink) {
            mobileLoginLink.href = dashHref;
            mobileLoginLink.textContent = 'My Dashboard';
        }
        // admin.html and worker.html render their own dedicated logout button
        // in the navbar — injecting a second one here caused duplicate Logout
        // buttons, so only inject logout on pages without one.
        var hasOwnLogout = !!(document.getElementById('adminLogoutBtn') || document.getElementById('workerLogoutBtn'));
        if (navActions) {
            const div = document.createElement('div');
            div.id = 'profileContainer';
            div.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
            const initials = (user.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
            var profileLabel = user.role === 'admin' ? 'Admin' : (user.name || 'User').split(' ')[0];
            var profileIcon = user.role === 'admin' ? '🛠️' : '👤';
            div.innerHTML =
                '<a href="' + dashHref + '" class="nav-action" title="' +
                (user.role === 'admin' ? 'Back to Admin Panel' : 'My Dashboard') + '">' +
                '<span class="action-icon">' + profileIcon + '</span>' +
                '<span>' + profileLabel + '</span>' +
                '</a>' +
                (hasOwnLogout ? '' :
                    '<a href="#" onclick="logout();return false;" class="nav-action" title="Logout">' +
                    '<span class="action-icon">🚪</span><span>Logout</span></a>');
            navActions.insertBefore(div, navActions.firstChild);
        }
    } else {
        if (authAction) {
            authAction.href = 'login.html';
            authAction.style.display = 'inline-flex';
        }
        if (signupBtn) signupBtn.style.display = 'inline-flex';
        if (mobileLoginLink) {
            mobileLoginLink.href = 'login.html';
            mobileLoginLink.textContent = 'Login';
        }
    }
    updateCartCount();
}

// ===== Cart Functions (server-backed) =====
async function getCartItems() {
    if (!isLoggedIn()) return [];
    const items = await apiGetCart();
    return (items || []).map(function (item) {
        return {
            id: item.id,
            name: item.name || 'Unknown product',
            price: Number(item.price) || 0,
            quantity: Math.max(1, Number(item.quantity) || 1),
            image: item.image || '🛍️'
        };
    });
}

async function addToCart(id) {
    const user = getCurrentUser();
    if (!user) {
        showToast('Please login first', 'error');
        setTimeout(function () { window.location.href = 'login.html'; }, 1200);
        return false;
    }
    try {
        const product = await apiGetProduct(id);
        if (!product) { showToast('Product not found', 'error'); return false; }

        const cart = await getCartItems();
        const existingItem = cart.find(item => String(item.id) === String(id));
        if (existingItem) {
            existingItem.quantity += 1;
        } else {
            cart.push({ id: id, name: product.name, price: product.price, quantity: 1, image: product.image });
        }
        await apiSaveCart(cart);
        await updateCartCount();
        showAddedToast(product.name);
        return true;
    } catch (err) {
        showToast(err.message || 'Could not add this item to your cart. Please try again.', 'error');
        return false;
    }
}

async function updateCartCount() {
    const count = document.getElementById('cart-count');
    if (!isLoggedIn()) {
        if (count) { count.textContent = 0; count.style.display = 'none'; }
        return;
    }
    try {
        const cart = await getCartItems();
        const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
        if (count) { count.textContent = totalItems; count.style.display = totalItems > 0 ? 'inline-flex' : 'none'; }
    } catch (err) {
        // A stale session must not break page rendering or product buttons.
        if (count) { count.textContent = 0; count.style.display = 'none'; }
    }
}

// ===== Toast Notifications =====
function showToast(message, type) {
    type = type || 'success';
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.className = 'toast-' + type;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    toast.style.display = 'flex';
    setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.display = 'none';
    }, 3000);
}

function showAddedToast(name) {
    let toast = document.getElementById('added-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'added-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = '✓ Added ' + name + ' to cart';
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    toast.style.display = 'flex';
    setTimeout(function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.display = 'none';
    }, 1600);
}

// ===== Theme =====
function initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = saved || (prefersDark ? 'dark' : 'light');
    applyTheme(theme);
}

function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const isDark = document.body.classList.contains('dark-mode');
    applyTheme(isDark ? 'light' : 'dark');
}

// ===== Back to Top =====
function initBackToTop() {
    let btn = document.getElementById('backToTop');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'backToTop';
        btn.className = 'back-to-top';
        btn.innerHTML = '↑';
        btn.title = 'Back to top';
        btn.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };
        document.body.appendChild(btn);
    }
    window.addEventListener('scroll', function () {
        if (window.scrollY > 300) btn.classList.add('visible');
        else btn.classList.remove('visible');
    });
}

// ===== Mobile Menu =====
(function setupMobileMenu() {
    const openBtn = document.getElementById('menuToggle');
    const closeBtn = document.getElementById('closeMenu');
    const menu = document.getElementById('mobileMenu');
    const overlay = document.getElementById('mobileOverlay');

    if (!openBtn || !menu) return;

    function toggleMenu(open) {
        if (open === undefined) {
            document.body.classList.toggle('menu-open');
            menu.classList.toggle('open');
            if (overlay) overlay.classList.toggle('active');
        } else if (open) {
            document.body.classList.add('menu-open');
            menu.classList.add('open');
            if (overlay) overlay.classList.add('active');
        } else {
            document.body.classList.remove('menu-open');
            menu.classList.remove('open');
            if (overlay) overlay.classList.remove('active');
        }
    }

    openBtn.addEventListener('click', function (e) {
        e.preventDefault();
        toggleMenu(true);
    });
    if (closeBtn) {
        closeBtn.addEventListener('click', function (e) {
            e.preventDefault();
            toggleMenu(false);
        });
    }
    if (overlay) {
        overlay.addEventListener('click', function () { toggleMenu(false); });
    }
    const mobileLinks = menu.querySelectorAll('a');
    mobileLinks.forEach(function (link) {
        link.addEventListener('click', function () { toggleMenu(false); });
    });
})();

// ===== PWA: one-click "Install app" (like YouTube / TikTok) =====
// Registers the service worker and shows a floating Install button whenever
// the browser allows installation. Once installed, the store opens in its
// own window from the Start Menu / desktop — no browser bars.
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js').catch(function () { /* offline shell unavailable — app still works online */ });
    });
}

var deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstallPrompt = e;
    showInstallButton();
});

window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    var btn = document.getElementById('pwa-install-btn');
    if (btn) btn.remove();
});

function showInstallButton() {
    if (document.getElementById('pwa-install-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'pwa-install-btn';
    btn.type = 'button';
    btn.innerHTML = '📲 Install App';
    btn.title = 'Install LordTempsMart as an app';
    btn.style.cssText =
        'position:fixed;left:16px;bottom:24px;z-index:9999;' +
        'background:#ff3b20;color:#fff;border:none;border-radius:26px;' +
        'padding:12px 22px;font-weight:700;font-size:14px;cursor:pointer;' +
        'box-shadow:0 4px 14px rgba(0,0,0,0.25);font-family:inherit;';
    btn.onclick = function () {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        deferredInstallPrompt.userChoice.then(function () {
            deferredInstallPrompt = null;
            btn.remove();
        });
    };
    document.body.appendChild(btn);
}

// ===== Desktop (Electron) update button =====
// When running inside the packaged desktop app, the Electron main process
// checks GitHub Releases and pushes an "update-available" event here. We show
// a floating "⬆️ Update Available" button that opens the release page so the
// user can download the new installer.
(function setupDesktopUpdate() {
    if (!window.LordTempsDesktop || !window.LordTempsDesktop.isDesktop) return;
    window.LordTempsDesktop.onUpdateAvailable(function (info) {
        if (document.getElementById('desktop-update-btn')) return;
        var btn = document.createElement('button');
        btn.id = 'desktop-update-btn';
        btn.type = 'button';
        btn.innerHTML = '⬆️ Update Available (v' + (info.version || '') + ')';
        btn.title = 'A new version of LordTempsMart is available';
        btn.style.cssText =
            'position:fixed;right:16px;bottom:24px;z-index:9999;' +
            'background:#2563eb;color:#fff;border:none;border-radius:26px;' +
            'padding:12px 22px;font-weight:700;font-size:14px;cursor:pointer;' +
            'box-shadow:0 4px 14px rgba(0,0,0,0.25);font-family:inherit;';
        btn.onclick = function () {
            if (info.url) window.LordTempsDesktop.openExternal(info.url);
        };
        document.body.appendChild(btn);
    });
})();
