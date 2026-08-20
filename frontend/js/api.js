/* ============================================================
 *  TRIUMPHSMART — API Client
 *  Handles all communication with the backend server.
 *  Uses JWT tokens stored in localStorage for authentication.
 * ============================================================ */

const API_BASE = window.location.origin; // Same origin as the server

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

// ===== API Request Helper =====
async function apiRequest(endpoint, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    const token = getToken();
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }

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
    return apiRequest('/api/cart', {
        method: 'POST',
        body: JSON.stringify({ items })
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
        if (mobileLoginLink) {
            mobileLoginLink.href = 'dashboard.html';
            mobileLoginLink.textContent = 'My Dashboard';
        }
        if (navActions) {
            const div = document.createElement('div');
            div.id = 'profileContainer';
            div.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
            const initials = (user.name || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
            div.innerHTML =
                '<a href="dashboard.html" class="nav-action">' +
                '<span class="action-icon">👤</span>' +
                '<span>' + (user.name || 'User').split(' ')[0] + '</span>' +
                '</a>' +
                '<a href="#" onclick="logout();return false;" class="nav-action" title="Logout">' +
                '<span class="action-icon">🚪</span><span>Logout</span></a>';
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
    try {
        return await apiGetCart();
    } catch (e) {
        console.warn('Failed to load cart:', e);
        return [];
    }
}

async function addToCart(id) {
    const user = getCurrentUser();
    if (!user) {
        showToast('Please login first', 'error');
        setTimeout(function () { window.location.href = 'login.html'; }, 1200);
        return;
    }
    const product = await apiGetProduct(id).catch(() => null);
    if (!product) { showToast('Product not found', 'error'); return; }

    const cart = await getCartItems();
    const existingItem = cart.find(item => item.id === id);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ id: id, name: product.name, price: product.price, quantity: 1, image: product.image });
    }
    await apiSaveCart(cart);
    updateCartCount();
    showAddedToast(product.name);
}

async function updateCartCount() {
    const count = document.getElementById('cart-count');
    if (!isLoggedIn()) {
        if (count) { count.textContent = 0; count.style.display = 'none'; }
        return;
    }
    const cart = await getCartItems();
    const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (count) { count.textContent = totalItems; count.style.display = totalItems > 0 ? 'inline-flex' : 'none'; }
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