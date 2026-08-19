// ============================================================
//  FRESHMART — Enhanced main.js (root copy — kept in sync)
//  Features:
//    • Mobile menu & category dropdown
//    • Flash-sale countdown timer
//    • Search with debounce
//    • Cart (add / inc / dec / remove / render / count)
//    • Wishlist (localStorage, persists per user)
//    • Auth (register / verify / login) with EmailJS
//    • Password strength indicator
//    • Dark / light mode toggle (persists in localStorage)
//    • Back-to-top button
//    • Toast notifications
//    • Quick view modal
//    • Profile picture upload
// ============================================================

// ===== Mobile menu toggle =====
(function setupMobileMenu() {
    var openBtn = document.getElementById("menuToggle");
    var closeBtn = document.getElementById("closeMenu");
    var menu = document.getElementById("mobileMenu");
    var overlay = document.getElementById("mobileOverlay");

    if (!openBtn || !menu) return;

    function toggleMenu(open) {
        if (open === undefined) {
            document.body.classList.toggle("menu-open");
            menu.classList.toggle("open");
            if (overlay) overlay.classList.toggle("active");
        } else if (open) {
            document.body.classList.add("menu-open");
            menu.classList.add("open");
            if (overlay) overlay.classList.add("active");
        } else {
            document.body.classList.remove("menu-open");
            menu.classList.remove("open");
            if (overlay) overlay.classList.remove("active");
        }
    }

    openBtn.addEventListener("click", function (e) {
        e.preventDefault();
        toggleMenu(true);
    });
    if (closeBtn) {
        closeBtn.addEventListener("click", function (e) {
            e.preventDefault();
            toggleMenu(false);
        });
    }
    if (overlay) {
        overlay.addEventListener("click", function () {
            toggleMenu(false);
        });
    }
    var mobileLinks = menu.querySelectorAll("a");
    mobileLinks.forEach(function (link) {
        link.addEventListener("click", function () {
            toggleMenu(false);
        });
    });
})();

// ===== Category dropdown close on outside click =====
(function setupCategoryDropdown() {
    var catBtn = document.getElementById("categoryBtn");
    var dropdown = document.getElementById("categoryDropdown");
    if (!catBtn || !dropdown) return;

    catBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropdown.classList.toggle("open");
        catBtn.classList.toggle("open");
    });

    dropdown.addEventListener("click", function (e) {
        e.stopPropagation();
    });

    document.addEventListener("click", function () {
        dropdown.classList.remove("open");
        catBtn.classList.remove("open");
    });

    if (window.matchMedia("(hover: hover)").matches) {
        catBtn.addEventListener("mouseenter", function () {
            dropdown.classList.add("open");
            catBtn.classList.add("open");
        });
        dropdown.addEventListener("mouseleave", function () {
            dropdown.classList.remove("open");
            catBtn.classList.remove("open");
        });
    }
})();

// ===== Flash sale countdown timer =====
(function setupCountdown() {
    var timers = document.querySelectorAll(".countdown");
    if (!timers.length) return;

    function updateCountdown() {
        var now = new Date();
        var deadline = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
            now.getHours() + 2, 0, 0);
        var diff = Math.max(0, deadline - now);
        var h = Math.floor(diff / (1000 * 60 * 60));
        var m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        var s = Math.floor((diff % (1000 * 60)) / 1000);
        var timeStr = "\u23F0 " +
            String(h).padStart(2, "0") + ":" +
            String(m).padStart(2, "0") + ":" +
            String(s).padStart(2, "0");

        timers.forEach(function (t) {
            if (t) {
                t.textContent = timeStr;
                t.style.color = (h === 0 && m < 5) ? "#ff3b20" : "";
            }
        });
    }

    updateCountdown();
    setInterval(updateCountdown, 1000);
})();

// ===== User Management =====
function getUsers() {
    return JSON.parse(localStorage.getItem("users")) || [];
}

function saveUser(user) {
    let users = getUsers();
    let index = users.findIndex(u => u.email === user.email);
    if (index !== -1) {
        users[index] = user;
    } else {
        users.push(user);
    }
    localStorage.setItem("users", JSON.stringify(users));
}

function setCurrentUser(user) {
    localStorage.setItem("currentUser", JSON.stringify(user));
}

function getCurrentUser() {
    return JSON.parse(localStorage.getItem("currentUser"));
}

function logout() {
    localStorage.removeItem("currentUser");
    updateAuthUI();
    window.location.href = "login.html";
}

function generateProfilePic(name) {
    let parts = (name || "User").trim().split(" ");
    let initials = parts[0][0].toUpperCase() +
        (parts[1] ? parts[1][0].toUpperCase() : "");
    let colors = ["#5D4037", "#3b2f2f", "#6d4c41", "#8D6E63", "#A1887F"];
    return {
        initials: initials,
        color: colors[Math.floor(Math.random() * colors.length)],
        image: null
    };
}

function uploadProfilePicture(input) {
    let file = input.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = function (e) {
        let user = getCurrentUser();
        if (!user) return;
        user.profilePic.image = e.target.result;
        setCurrentUser(user);
        let users = getUsers();
        let index = users.findIndex(u => u.email === user.email);
        if (index !== -1) {
            users[index] = user;
            localStorage.setItem("users", JSON.stringify(users));
        }
        location.reload();
    };
    reader.readAsDataURL(file);
}

// ===== Auth UI Updates =====
function updateAuthUI() {
    var user = getCurrentUser();
    var authAction = document.getElementById("authAction");
    var signupBtn = document.getElementById("signupBtn");
    var mobileLoginLink = document.getElementById("mobileLoginLink");
    var nav = document.querySelector(".navbar .nav-links");

    if (user) {
        if (authAction) authAction.style.display = "none";
        if (signupBtn) signupBtn.style.display = "none";
        if (mobileLoginLink) {
            mobileLoginLink.href = "#";
            mobileLoginLink.textContent = "Logout";
            mobileLoginLink.onclick = function (e) { e.preventDefault(); logout(); };
        }
        if (nav) {
            nav.innerHTML += '<a href="#" class="nav-link nav-link--active" onclick="logout()">Logout</a>';
            nav.innerHTML += '<a href="#" class="nav-link"><b>' + user.name + "</b></a>";
        }
    } else {
        if (authAction) {
            authAction.href = "login.html";
            authAction.style.display = "inline-flex";
        }
        if (signupBtn) signupBtn.style.display = "inline-flex";
        if (mobileLoginLink) {
            mobileLoginLink.href = "login.html";
            mobileLoginLink.textContent = "Login";
            mobileLoginLink.onclick = null;
        }
    }
    updateCartCount();
    updateWishlistCount();
}

// ===== Password Strength Check =====
function checkPasswordStrength(password) {
    let strength = 0;
    let messages = [];
    if (password.length >= 8) { strength += 1; messages.push("At least 8 characters"); }
    if (/[A-Z]/.test(password)) { strength += 1; messages.push("Contains uppercase letter"); }
    if (/[a-z]/.test(password)) { strength += 1; messages.push("Contains lowercase letter"); }
    if (/[0-9]/.test(password)) { strength += 1; messages.push("Contains number"); }
    if (/[^A-Za-z0-9]/.test(password)) { strength += 1; messages.push("Contains special character"); }
    let level = "weak";
    if (strength >= 4) level = "strong";
    else if (strength === 3) level = "medium";
    return { strength: strength, level: level, messages: messages };
}

function setupPasswordStrength() {
    var pwdInput = document.getElementById("password");
    if (!pwdInput) return;
    var wrapper = pwdInput.parentElement;
    var strengthBar = document.createElement("div");
    strengthBar.className = "password-strength";
    strengthBar.innerHTML =
        '<div class="strength-meter"><div class="strength-fill" id="strengthFill"></div></div>' +
        '<div class="strength-text" id="strengthText"></div>';
    wrapper.appendChild(strengthBar);
    pwdInput.addEventListener("input", function () {
        var pwd = this.value;
        if (!pwd) { strengthBar.style.display = "none"; return; }
        strengthBar.style.display = "block";
        var result = checkPasswordStrength(pwd);
        var fill = document.getElementById("strengthFill");
        var text = document.getElementById("strengthText");
        var colors = ["#ff3b20", "#ff9800", "#4caf50"];
        var color = result.strength <= 2 ? colors[0] : result.strength === 3 ? colors[1] : colors[2];
        fill.style.width = (result.strength / 5 * 100) + "%";
        fill.style.background = color;
        text.textContent = result.level.charAt(0).toUpperCase() + result.level.slice(1) +
            " password (" + result.strength + "/5)";
        text.style.color = color;
    });
}

// ===== Wishlist Management =====
function getWishlist() {
    var user = getCurrentUser();
    if (!user) return [];
    var key = "wishlist_" + user.email;
    return JSON.parse(localStorage.getItem(key)) || [];
}

function addToWishlist(id, name, price) {
    var user = getCurrentUser();
    if (!user) {
        showToast("Please login to save to wishlist", "error");
        window.location.href = "login.html";
        return;
    }
    var key = "wishlist_" + user.email;
    var wishlist = getWishlist();
    if (wishlist.find(item => item.id === id)) {
        wishlist = wishlist.filter(item => item.id !== id);
        localStorage.setItem(key, JSON.stringify(wishlist));
        updateWishlistCount();
        showToast(name + " removed from wishlist");
    } else {
        wishlist.push({ id, name, price });
        localStorage.setItem(key, JSON.stringify(wishlist));
        updateWishlistCount();
        showToast(name + " added to wishlist");
    }
    updateWishlistButtons();
}

function updateWishlistCount() {
    var user = getCurrentUser();
    var badge = document.getElementById("wishlist-count");
    if (!badge) return;
    if (!user) { badge.textContent = 0; badge.style.display = "none"; return; }
    var wishlist = getWishlist();
    badge.textContent = wishlist.length;
    badge.style.display = wishlist.length > 0 ? "inline-flex" : "none";
}

function updateWishlistButtons() {
    var user = getCurrentUser();
    if (!user) return;
    var wishlist = getWishlist();
    var buttons = document.querySelectorAll(".wishlist-btn");
    buttons.forEach(function (btn) {
        var id = parseInt(btn.dataset.productId);
        if (wishlist.find(item => item.id === id)) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

// ===== Cart =====
function addToCart(id, name, price) {
    var user = getCurrentUser();
    if (!user) {
        showToast("Please login first", "error");
        setTimeout(function () { window.location.href = "login.html"; }, 1500);
        return;
    }
    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    var existingItem = cart.find(item => item.id === id);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ id: id, name: name, price: price, quantity: 1, image: null });
    }
    localStorage.setItem(key, JSON.stringify(cart));
    updateCartCount();
    showAddedToast(name);
}

function incQty(index) {
    var user = getCurrentUser();
    if (!user) return;
    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    if (!cart[index]) return;
    cart[index].quantity += 1;
    localStorage.setItem(key, JSON.stringify(cart));
    renderCart();
    updateCartCount();
}

function decQty(index) {
    var user = getCurrentUser();
    if (!user) return;
    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    if (!cart[index]) return;
    cart[index].quantity -= 1;
    if (cart[index].quantity <= 0) cart.splice(index, 1);
    localStorage.setItem(key, JSON.stringify(cart));
    renderCart();
    updateCartCount();
}

function removeItem(index) {
    var user = getCurrentUser();
    if (!user) return;
    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    cart.splice(index, 1);
    localStorage.setItem(key, JSON.stringify(cart));
    renderCart();
    updateCartCount();
}

function updateCartCount() {
    var user = getCurrentUser();
    var count = document.getElementById("cart-count");
    var inlineCount = document.getElementById("cart-count-inline");
    if (!user) {
        if (count) { count.textContent = 0; count.style.display = "none"; }
        if (inlineCount) inlineCount.textContent = 0;
        return;
    }
    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    var totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
    if (count) { count.textContent = totalItems; count.style.display = totalItems > 0 ? "inline-flex" : "none"; }
    if (inlineCount) inlineCount.textContent = totalItems;
}

function renderCart() {
    updateCartCount();
    updateWishlistButtons();
}

// ===== Quick View =====
var quickViewProduct = null;
var PRODUCTS_DATA = {
    1: { name: "Chocolate Cake", price: 18000, originalPrice: 22500, rating: 4.8, revCount: 128, desc: "Rich chocolate layers with premium cocoa, perfect for birthdays, anniversaries, and celebrations.", icon: "\uD83C\uDF55" },
    2: { name: "Butter Buns", price: 1500, originalPrice: 1700, rating: 4.5, revCount: 92, desc: "Soft and fluffy buns baked fresh daily with premium butter. Perfect for breakfast, tea time, or as burger buns.", icon: "\uD83E\uDD50" },
    3: { name: "Puff Puff", price: 2000, originalPrice: 2670, rating: 4.3, revCount: 64, desc: "Golden, bite-sized dough balls that are quick and satisfying. A beloved West African street snack.", icon: "\uD83C\uDF69" },
    4: { name: "Fresh Milk", price: 2500, originalPrice: null, rating: 4.6, revCount: 210, desc: "Pure, fresh dairy milk from grass-fed cows. Essential for your breakfast table, coffee, and cooking.", icon: "\uD83C\uDDD7\uFE0F" },
    5: { name: "Rice Bag", price: 18500, originalPrice: 21765, rating: 4.7, revCount: 156, desc: "Premium long-grain parboiled rice, perfect for everyday family meals. 50kg family pack.", icon: "\uD83C\uDF73" },
    6: { name: "Water Pack", price: 1200, originalPrice: 1710, rating: 4.4, revCount: 88, desc: "Refreshing purified bottled water. Stay hydrated at home, in the office, or on the go.", icon: "\uD83D\uDDFF" }
};

function openQuickView(id) {
    var product = PRODUCTS_DATA[id];
    if (!product) return;
    quickViewProduct = { id: id, name: product.name, price: product.price };
    var overlay = document.getElementById("quickviewOverlay");
    if (!overlay) return;
    document.getElementById("qvImage").textContent = product.icon;
    document.getElementById("qvTitle").textContent = product.name;
    document.getElementById("qvPrice").textContent = "\u20A6" + product.price.toLocaleString();
    var delEl = document.getElementById("qvPriceDel");
    delEl.textContent = product.originalPrice ? "\u20A6" + product.originalPrice.toLocaleString() : "";
    document.getElementById("qvRating").textContent = "\u2605 " + product.rating + " (" + product.revCount + ")";
    document.getElementById("qvDesc").textContent = product.desc;
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
}

function closeQuickView() {
    var overlay = document.getElementById("quickviewOverlay");
    if (overlay) overlay.classList.remove("active");
    document.body.style.overflow = "";
    quickViewProduct = null;
}

function quickViewAddToCart() {
    if (!quickViewProduct) return;
    addToCart(quickViewProduct.id, quickViewProduct.name, quickViewProduct.price);
    closeQuickView();
}

// ===== Checkout / Place Order =====
function checkout() {
    var user = getCurrentUser();
    if (!user) { showToast("Please login first", "error"); window.location.href = "login.html"; return; }
    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    if (cart.length === 0) { showToast("Your cart is empty", "error"); return; }
    window.location.href = "checkout.html";
}

function placeOrder() {
    var user = getCurrentUser();
    if (!user) { showToast("Please login first", "error"); window.location.href = "login.html"; return; }
    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    if (cart.length === 0) { showToast("Your cart is empty", "error"); return; }
    var orderDetails = cart.map(item =>
        item.name + " x " + item.quantity + " = \u20A6" + (item.price * item.quantity).toLocaleString()
    ).join("\n");
    var total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    var subject = "New Order from " + user.name;
    var body = "Hello FreshMart,\n\nI would like to place an order:\n\n" +
        orderDetails + "\n\nTotal: \u20A6" + total.toLocaleString() + "\n\n" +
        "Delivery Location: [Please fill in your address here]\n\nThank you,\n" + user.name;
    window.open("https://mail.google.com/mail/?view=cm&fs=1&to=sweetcrumbs@gmail.com" +
        "&su=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body));
    localStorage.removeItem(key);
    updateCartCount();
    window.location.href = "finally.html";
}

// ===== Search with Debounce =====
function filterCards(inputId, containerId) {
    var input = document.getElementById(inputId);
    var container = document.getElementById(containerId);
    if (!input || !container) return;
    var query = input.value.trim().toLowerCase();
    var cards = container.querySelectorAll(".card");
    cards.forEach(card => {
        var searchableText = (card.dataset.search || card.textContent).toLowerCase();
        card.classList.toggle("hidden", query && !searchableText.includes(query));
    });
}

function setupSearch(inputId, containerId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var debounceTimer;
    input.addEventListener("input", function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () { filterCards(inputId, containerId); }, 300);
    });
    var btn = input.parentElement.querySelector(".search-btn");
    if (btn) {
        btn.addEventListener("click", function () { filterCards(inputId, containerId); });
    }
}

// ===== Dark Mode =====
function initTheme() {
    var saved = localStorage.getItem("theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = saved || (prefersDark ? "dark" : "light");
    applyTheme(theme);
}

function applyTheme(theme) {
    if (theme === "dark") {
        document.body.classList.add("dark-mode");
    } else {
        document.body.classList.remove("dark-mode");
    }
    localStorage.setItem("theme", theme);
    var toggle = document.getElementById("themeToggle");
    if (toggle) {
        toggle.textContent = theme === "dark" ? "\uD83C\xDF19" : "\uD83C\xDF1E";
        toggle.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
}

function toggleTheme() {
    var isDark = document.body.classList.contains("dark-mode");
    applyTheme(isDark ? "light" : "dark");
}

// ===== Back to Top Button =====
function initBackToTop() {
    var btn = document.getElementById("backToTop");
    if (!btn) {
        btn = document.createElement("button");
        btn.id = "backToTop";
        btn.className = "back-to-top";
        btn.innerHTML = "\u2191";
        btn.title = "Back to top";
        btn.onclick = function () { window.scrollTo({ top: 0, behavior: "smooth" }); };
        document.body.appendChild(btn);
    }
    window.addEventListener("scroll", function () {
        if (window.scrollY > 300) btn.classList.add("visible");
        else btn.classList.remove("visible");
    });
}

// ===== Toast Notifications =====
function showToast(message, type) {
    type = type || "success";
    var toast = document.getElementById("toast");
    if (!toast) { toast = document.createElement("div"); toast.id = "toast"; document.body.appendChild(toast); }
    toast.textContent = message;
    toast.className = "toast-" + type;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    setTimeout(function () { toast.style.opacity = "0"; toast.style.transform = "translateY(10px)"; }, 3000);
}

function showAddedToast(name) {
    var toast = document.getElementById("added-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "added-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = "\u2713 Added " + name + " to cart";
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    setTimeout(function () { toast.style.opacity = "0"; toast.style.transform = "translateY(10px)"; }, 1600);
}

// ===== Register =====
async function registerUser() {
    var nameInput = document.getElementById("full_name");
    var emailInput = document.getElementById("email");
    var passwordInput = document.getElementById("password");
    var termsInput = document.getElementById("terms");
    var name = nameInput ? nameInput.value.trim() : "";
    var email = emailInput ? emailInput.value.trim() : "";
    var password = passwordInput ? passwordInput.value.trim() : "";

    if (!name || !email || !password) { showToast("Please fill in all fields", "error"); return; }
    if (!termsInput || !termsInput.checked) { showToast("Please agree to the Terms and Privacy Policy", "error"); return; }
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) { showToast("Please enter a valid email address", "error"); return; }
    var strength = checkPasswordStrength(password);
    if (strength.strength < 3) { showToast("Password is too weak. Use at least 8 chars with upper, lower, and numbers.", "error"); return; }

    var users = getUsers();
    if (users.find(u => u.email === email)) {
        showToast("This email is already registered. Please log in.", "error");
        setTimeout(function () { window.location.href = "login.html"; }, 1500);
        return;
    }

    var code = generateVerificationCode();
    var profilePic = generateProfilePic(name);
    localStorage.setItem("pendingUser", JSON.stringify({ name: name, email: email, password: password, profilePic: profilePic }));
    storeVerificationCode(email, code);

    var submitBtn = document.querySelector("#registerForm button[type=\"submit\"]");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending verification code..."; }

    var success = await sendVerificationEmail(email, code, name);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Create Account"; }

    if (success) {
        showToast("Verification code sent to your email!", "success");
        setTimeout(function () { window.location.href = "verify.html"; }, 1500);
    } else {
        showToast("Could not send verification email. Please try again.", "error");
    }
}

// ===== Verify =====
async function verifyCode() {
    var codeInput = document.getElementById("verification_code");
    var enteredCode = codeInput ? codeInput.value.trim() : "";
    if (!enteredCode || enteredCode.length !== 6) { showToast("Please enter the 6-digit verification code", "error"); return; }
    var pendingUser = JSON.parse(localStorage.getItem("pendingUser"));
    if (!pendingUser) { showToast("No pending registration found. Please register again.", "error"); setTimeout(function () { window.location.href = "register.html"; }, 1500); return; }

    var submitBtn = document.querySelector("#verifyForm button[type=\"submit\"]");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Verifying..."; }

    var isValid = await verifyCodeRemotely(pendingUser.email, enteredCode);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Verify Account"; }

    if (isValid) {
        saveUser(pendingUser);
        setCurrentUser(pendingUser);
        localStorage.removeItem("pendingUser");
        localStorage.removeItem("verification_code_" + pendingUser.email);
        showToast("Account verified successfully! Welcome " + pendingUser.name + "!", "success");
        setTimeout(function () { window.location.href = "index.html"; }, 1500);
    } else {
        showToast("Wrong verification code. Please try again.", "error");
    }
}

// ===== Login =====
async function loginUser() {
    var emailInput = document.getElementById("login_email");
    var passwordInput = document.getElementById("login_password");
    var email = emailInput ? emailInput.value.trim() : "";
    var password = passwordInput ? passwordInput.value.trim() : "";
    if (!email || !password) { showToast("Please fill in all fields", "error"); return; }
    var users = getUsers();
    var user = users.find(u => u.email === email && u.password === password);
    if (!user) { showToast("Invalid credentials. Check your email and password.", "error"); return; }
    setCurrentUser(user);
    sendLoginNotification(email, user.name).catch(function (err) { console.warn("Login notification failed:", err); });
    showToast("Welcome back " + user.name + "!", "success");
    setTimeout(function () { window.location.href = "index.html"; }, 1500);
}

// ===== DOM ready =====
window.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initBackToTop();
    updateAuthUI();
    setupSearch("home-search", "featured-products");
    setupSearch("product-search", "all-products");
    setupSearch("product-search-top", "all-products");
    setupPasswordStrength();
    updateWishlistButtons();

    var overlay = document.getElementById("quickviewOverlay");
    if (overlay) {
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) closeQuickView();
        });
    }
});
