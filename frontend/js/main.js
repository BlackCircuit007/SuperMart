/* ============================================================
 *  TRIUMPHSMART — Main Application Script
 *  Features:
 *    • Responsive mobile menu & category dropdown
 *    • Dynamic product rendering (from localStorage DB)
 *    • Search with debounce
 *    • Cart (add / inc / dec / remove / render / count)
 *    • Auth (register / verify / login) with EmailJS
 *    • Admin panel integration (login: admin/admin)
 *    • User dashboard
 *    • Quick view modal
 *    • Toast notifications
 *    • Profile picture upload
 * ============================================================ */

/* ===== Admin Configuration ===== */
var ADMIN_USERNAME = "admin";
var ADMIN_PASSWORD = "admin";

/* ===== Mobile menu toggle ===== */
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
        overlay.addEventListener("click", function () { toggleMenu(false); });
    }
    var mobileLinks = menu.querySelectorAll("a");
    mobileLinks.forEach(function (link) {
        link.addEventListener("click", function () { toggleMenu(false); });
    });
})();

/* ===== Category dropdown ===== */
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

    dropdown.addEventListener("click", function (e) { e.stopPropagation(); });

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

/* ===== User Management ===== */
function getUsers() {
    return JSON.parse(localStorage.getItem("users")) || [];
}

function saveUser(user) {
    var users = getUsers();
    var index = users.findIndex(function (u) { return u.email === user.email; });
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
    window.location.href = "index.html";
}

function generateProfilePic(name) {
    var parts = (name || "User").trim().split(" ");
    var initials = parts[0][0].toUpperCase() +
        (parts[1] ? parts[1][0].toUpperCase() : "");
    var colors = ["#ff3b20", "#ff7a00", "#6d4c41", "#8D6E63", "#A1887F"];
    return {
        initials: initials,
        color: colors[Math.floor(Math.random() * colors.length)],
        image: null
    };
}

function uploadProfilePicture(input) {
    var file = input.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (e) {
        var user = getCurrentUser();
        if (!user) return;
        if (!user.profilePic) user.profilePic = { initials: "U", color: "#ff3b20", image: null };
        user.profilePic.image = e.target.result;
        setCurrentUser(user);
        var users = getUsers();
        var index = users.findIndex(function (u) { return u.email === user.email; });
        if (index !== -1) {
            users[index] = user;
            localStorage.setItem("users", JSON.stringify(users));
        }
        showToast("Profile picture updated!", "success");
        setTimeout(function () { location.reload(); }, 1000);
    };
    reader.readAsDataURL(file);
}

/* ===== Auth UI ===== */
function updateAuthUI() {
    var user = getCurrentUser();
    var authAction = document.getElementById("authAction");
    var signupBtn = document.getElementById("signupBtn");
    var mobileLoginLink = document.getElementById("mobileLoginLink");
    var navActions = document.querySelector(".navbar .nav-actions");

    // Remove any existing profile trigger
    var existing = document.getElementById("profileContainer");
    if (existing) existing.remove();

    if (user) {
        if (authAction) authAction.style.display = "none";
        if (signupBtn) signupBtn.style.display = "none";
        if (mobileLoginLink) {
            mobileLoginLink.href = "dashboard.html";
            mobileLoginLink.textContent = "My Dashboard";
        }
        // Add dashboard / profile link
        if (navActions) {
            var div = document.createElement("div");
            div.id = "profileContainer";
            div.style.cssText = "display:inline-flex;align-items:center;gap:6px;";
            var initials = (user.profilePic && user.profilePic.initials) || "U";
            var color = (user.profilePic && user.profilePic.color) || "#ff3b20";
            var imgHtml = (user.profilePic && user.profilePic.image)
                ? '<img src="' + user.profilePic.image + '" class="profile-pic-small" alt="Profile">'
                : '<span class="profile-initial-small" style="background:' + color + '">' + initials + "</span>";
            div.innerHTML =
                '<a href="dashboard.html" class="nav-action">' +
                '<span class="action-icon">' + imgHtml + "</span>" +
                "<span>" + user.name.split(" ")[0] + "</span>" +
                '</a>' +
                '<a href="#" onclick="logout();return false;" class="nav-action" title="Logout">' +
                '<span class="action-icon">🚪</span><span>Logout</span></a>';
            navActions.insertBefore(div, navActions.firstChild);
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
        }
    }
    updateCartCount();
}

/* ===== Cart ===== */
function addToCart(id) {
    var user = getCurrentUser();
    if (!user) {
        showToast("Please login first", "error");
        setTimeout(function () { window.location.href = "login.html"; }, 1200);
        return;
    }
    var product = findProductById(id);
    if (!product) { showToast("Product not found", "error"); return; }

    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    var existingItem = cart.find(function (item) { return item.id === id; });
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        cart.push({ id: id, name: product.name, price: product.price, quantity: 1, image: product.image });
    }
    localStorage.setItem(key, JSON.stringify(cart));
    updateCartCount();
    showAddedToast(product.name);
}

/* Legacy signature support: addToCart(id, name, price) */
var _origAddToCart = null;

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
    if (!user) {
        if (count) { count.textContent = 0; count.style.display = "none"; }
        return;
    }
    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    var totalItems = cart.reduce(function (sum, item) { return sum + item.quantity; }, 0);
    if (count) { count.textContent = totalItems; count.style.display = totalItems > 0 ? "inline-flex" : "none"; }
}

function renderCart() {
    updateCartCount();
}

/* ===== Product Rendering ===== */
function renderFeaturedProducts() {
    var container = document.getElementById("featured-products");
    if (!container) return;
    var featured = getProducts().filter(function (p) { return p.featured; });
    if (featured.length === 0) featured = getProducts().slice(0, 8);
    container.innerHTML = featured.map(productCardHtml).join("");
    bindSearch(container);
}

function renderAllProducts() {
    var container = document.getElementById("all-products");
    if (!container) return;
    var products = getProducts();
    container.innerHTML = products.map(productCardHtml).join("");
    // Update count label
    var countEl = document.getElementById("product-count");
    if (countEl) countEl.textContent = products.length + " items available";
    bindSearch(container);
}

function bindSearch(container) {
    if (!container) return;
    container.querySelectorAll(".card").forEach(function (card) {
        card.addEventListener("click", function (e) {
            var btn = e.target.closest("button");
            if (btn) return; // button clicks handled by onclick
            var id = parseInt(card.dataset.id);
            if (id) openQuickView(id);
        });
    });
}

/* ===== Search ===== */
function filterCards(inputId, containerId) {
    var input = document.getElementById(inputId);
    var container = document.getElementById(containerId);
    if (!input || !container) return;
    var query = input.value.trim().toLowerCase();
    var cards = container.querySelectorAll(".card");
    cards.forEach(function (card) {
        var searchableText = (card.dataset.search || card.textContent).toLowerCase();
        card.classList.toggle("hidden", query && searchableText.indexOf(query) === -1);
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
    var btn = input.parentElement ? input.parentElement.querySelector(".search-btn") : null;
    if (btn) {
        btn.addEventListener("click", function () { filterCards(inputId, containerId); });
    }
}

/* ===== Category Filtering ===== */
function filterByCategory(category) {
    var cards = document.querySelectorAll(".card");
    cards.forEach(function (card) {
        if (!category || category === "All") {
            card.classList.remove("hidden");
        } else {
            card.classList.toggle("hidden", (card.dataset.category || "") !== category);
        }
    });
}

function initCategoryButtons() {
    // Desktop category dropdown items
    var dropdown = document.getElementById("categoryDropdown");
    if (dropdown) {
        dropdown.innerHTML = "";
        getCategories().forEach(function (cat) {
            var a = document.createElement("a");
            a.href = "#";
            a.className = "cat-item";
            a.textContent = cat === "All" ? "All Products" : cat;
            a.addEventListener("click", function (e) {
                e.preventDefault();
                var catName = cat === "All" ? "" : cat;
                var hash = "#" + (cat === "All" ? "featured" : cat.replace(/\s+/g, "-").toLowerCase());
                window.location.href = "products.html" + hash;
            });
            dropdown.appendChild(a);
        });
    }

    // Category tile buttons (home page)
    document.querySelectorAll(".category-tile").forEach(function (tile) {
        tile.addEventListener("click", function () {
            var cat = tile.dataset.category || tile.textContent.trim();
            window.location.href = "products.html#" + cat.replace(/\s+/g, "-").toLowerCase();
        });
    });

    // Filter selects on products page
    var catSelect = document.getElementById("filter-category");
    var priceSelect = document.getElementById("filter-price");
    var ratingSelect = document.getElementById("filter-rating");

    if (catSelect) {
        getCategories().forEach(function (cat) {
            var opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat === "All" ? "All Categories" : cat;
            catSelect.appendChild(opt);
        });
        catSelect.addEventListener("change", applyFilters);
    }
    if (priceSelect) priceSelect.addEventListener("change", applyFilters);
    if (ratingSelect) ratingSelect.addEventListener("change", applyFilters);
}

function applyFilters() {
    var cat = document.getElementById("filter-category");
    var price = document.getElementById("filter-price");
    var rating = document.getElementById("filter-rating");
    var catVal = cat ? cat.value : "All";
    var priceVal = price ? price.value : "all";
    var ratingVal = rating ? rating.value : "all";

    document.querySelectorAll(".card").forEach(function (card) {
        var show = true;
        if (catVal && catVal !== "All" && card.dataset.category !== catVal) show = false;

        var priceText = card.querySelector(".price");
        var p = priceText ? parseFloat(priceText.textContent.replace(/[^\d]/g, "")) : 0;

        if (show && priceVal === "under5000" && p >= 5000) show = false;
        if (show && priceVal === "5000to20000" && (p < 5000 || p > 20000)) show = false;
        if (show && priceVal === "above20000" && p <= 20000) show = false;

        var ratingText = card.querySelector(".card-rating");
        var r = ratingText ? parseFloat(ratingText.textContent.replace("★", "")) : 0;
        if (show && ratingVal === "4up" && r < 4) show = false;
        if (show && ratingVal === "3up" && r < 3) show = false;

        card.classList.toggle("hidden", !show);
    });
}

/* ===== Quick View ===== */
var quickViewProduct = null;

function openQuickView(id) {
    var product = findProductById(id);
    if (!product) return;

    quickViewProduct = { id: id, name: product.name, price: product.price };

    var overlay = document.getElementById("quickviewOverlay");
    if (!overlay) return;

    var imgHtml = product.image && (String(product.image).indexOf("data:") === 0 || String(product.image).indexOf("http") === 0)
        ? '<img src="' + product.image + '" alt="' + product.name + '" style="max-width:120px;max-height:120px;border-radius:12px;">'
        : '<span style="font-size:80px;">' + (product.image || "🛍️") + "</span>";

    document.getElementById("qvImage").innerHTML = imgHtml;
    document.getElementById("qvTitle").textContent = product.name;
    document.getElementById("qvPrice").textContent = price(product.price);
    document.getElementById("qvRating").textContent = "★ " + product.rating;
    document.getElementById("qvDesc").textContent = product.description;

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
    addToCart(quickViewProduct.id);
    closeQuickView();
}

/* ===== Checkout / Place Order ===== */
function checkout() {
    var user = getCurrentUser();
    if (!user) { showToast("Please login first", "error"); window.location.href = "login.html"; return; }
    var key = "cart_" + user.email;
    var cart = JSON.parse(localStorage.getItem(key)) || [];
    if (cart.length === 0) { showToast("Your cart is empty", "error"); return; }
    window.location.href = "checkout.html";
}

/* ===== Toast Notifications ===== */
function showToast(message, type) {
    type = type || "success";
    var toast = document.getElementById("toast");
    if (!toast) { toast = document.createElement("div"); toast.id = "toast"; document.body.appendChild(toast); }
    toast.textContent = message;
    toast.className = "toast-" + type;
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    toast.style.display = "flex";
    setTimeout(function () { toast.style.opacity = "0"; toast.style.transform = "translateY(10px)"; toast.style.display = "none"; }, 3000);
}

function showAddedToast(name) {
    var toast = document.getElementById("added-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "added-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = "✓ Added " + name + " to cart";
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
    toast.style.display = "flex";
    setTimeout(function () { toast.style.opacity = "0"; toast.style.transform = "translateY(10px)"; toast.style.display = "none"; }, 1600);
}

/* ===== Password Strength ===== */
function checkPasswordStrength(password) {
    var strength = 0;
    var messages = [];
    if (password.length >= 8) { strength += 1; messages.push("At least 8 characters"); }
    if (/[A-Z]/.test(password)) { strength += 1; messages.push("Contains uppercase"); }
    if (/[a-z]/.test(password)) { strength += 1; messages.push("Contains lowercase"); }
    if (/[0-9]/.test(password)) { strength += 1; messages.push("Contains number"); }
    if (/[^A-Za-z0-9]/.test(password)) { strength += 1; messages.push("Contains special"); }
    var level = "weak";
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
        text.textContent = result.level.charAt(0).toUpperCase() + result.level.slice(1) + " password (" + result.strength + "/5)";
        text.style.color = color;
    });
}

/* ===== Register ===== */
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
    if (users.find(function (u) { return u.email === email; })) {
        showToast("This email is already registered. Please log in.", "error");
        setTimeout(function () { window.location.href = "login.html"; }, 1500);
        return;
    }

    var code = generateVerificationCode();
    var profilePic = generateProfilePic(name);
    localStorage.setItem("pendingUser", JSON.stringify({ name: name, email: email, password: password, profilePic: profilePic }));
    storeVerificationCode(email, code);

    var submitBtn = document.querySelector("#registerForm button[type='submit']");
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

/* ===== Verify ===== */
async function verifyCode() {
    var codeInput = document.getElementById("verification_code");
    var enteredCode = codeInput ? codeInput.value.trim() : "";
    if (!enteredCode || enteredCode.length !== 6) { showToast("Please enter the 6-digit verification code", "error"); return; }
    var pendingUser = JSON.parse(localStorage.getItem("pendingUser"));
    if (!pendingUser) { showToast("No pending registration found. Please register again.", "error"); setTimeout(function () { window.location.href = "register.html"; }, 1500); return; }

    var submitBtn = document.querySelector("#verifyForm button[type='submit']");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Verifying..."; }

    var isValid = await verifyCodeRemotely(pendingUser.email, enteredCode);
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Verify Account"; }

    if (isValid) {
        saveUser(pendingUser);
        setCurrentUser(pendingUser);
        localStorage.removeItem("pendingUser");
        localStorage.removeItem("verification_code_" + pendingUser.email);
        showToast("Account verified successfully! Welcome " + pendingUser.name + "!", "success");
        setTimeout(function () { window.location.href = "dashboard.html"; }, 1500);
    } else {
        showToast("Wrong verification code. Please try again.", "error");
    }
}

/* ===== Login ===== */
async function loginUser() {
    var emailInput = document.getElementById("login_email");
    var passwordInput = document.getElementById("login_password");
    var email = emailInput ? emailInput.value.trim() : "";
    var password = passwordInput ? passwordInput.value.trim() : "";
    if (!email || !password) { showToast("Please fill in all fields", "error"); return; }

    // Admin login check
    if (email === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        localStorage.setItem("adminLoggedIn", "true");
        showToast("Welcome Admin!", "success");
        setTimeout(function () { window.location.href = "admin.html"; }, 800);
        return;
    }

    var users = getUsers();
    var user = users.find(function (u) { return u.email === email && u.password === password; });
    if (!user) { showToast("Invalid credentials. Check your email and password.", "error"); return; }
    setCurrentUser(user);
    sendLoginNotification(email, user.name).catch(function (err) { console.warn("Login notification failed:", err); });
    showToast("Welcome back " + user.name + "!", "success");
    setTimeout(function () { window.location.href = "dashboard.html"; }, 1200);
}

function adminLogout() {
    localStorage.removeItem("adminLoggedIn");
    window.location.href = "login.html";
}

function isAdminLoggedIn() {
    return localStorage.getItem("adminLoggedIn") === "true";
}

/* ===== Admin Functions ===== */
function adminAddProductForm() {
    var name = document.getElementById("admin-name").value.trim();
    var category = document.getElementById("admin-category").value;
    var price = parseFloat(document.getElementById("admin-price").value);
    var rating = parseFloat(document.getElementById("admin-rating").value);
    var description = document.getElementById("admin-desc").value.trim();
    var featured = document.getElementById("admin-featured").checked;

    // Collect image files (up to 5)
    var imageInputs = document.querySelectorAll(".admin-image-input");
    var images = [];
    var pendingReads = [];

    if (!name || !price || !description) {
        showToast("Please fill in name, price, and description", "error");
        return;
    }
    if (isNaN(price) || price <= 0) { showToast("Please enter a valid price", "error"); return; }

    imageInputs.forEach(function (input) {
        if (input.files && input.files[0]) {
            pendingReads.push(new Promise(function (resolve) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    images.push(e.target.result);
                    resolve();
                };
                reader.readAsDataURL(input.files[0]);
            }));
        }
    });

    Promise.all(pendingReads).then(function () {
        var product = {
            name: name,
            category: category,
            price: price,
            rating: rating || 4.5,
            description: description,
            image: images[0] || "🛍️",
            gallery: images,
            featured: featured
        };
        adminAddProduct(product);
        showToast('Product "' + name + '" added successfully!', "success");
        setTimeout(function () { location.reload(); }, 1200);
    });
}

/* ===== DOM Ready ===== */
window.addEventListener("DOMContentLoaded", function () {
    initTheme();
    initBackToTop();
    updateAuthUI();
    initCategoryButtons();
    renderFeaturedProducts();
    renderAllProducts();
    setupSearch("home-search", "featured-products");
    setupSearch("product-search", "all-products");
    setupSearch("product-search-top", "all-products");
    setupPasswordStrength();

    var overlay = document.getElementById("quickviewOverlay");
    if (overlay) {
        overlay.addEventListener("click", function (e) {
            if (e.target === overlay) closeQuickView();
        });
    }

    // Handle URL hash for category filtering
    var hash = window.location.hash;
    if (hash && hash.length > 1) {
        var catName = hash.substring(1).replace(/-/g, " ");
        setTimeout(function () {
            var cards = document.querySelectorAll(".card");
            var matched = false;
            cards.forEach(function (card) {
                if ((card.dataset.category || "").toLowerCase() === catName.toLowerCase()) {
                    matched = true;
                    card.classList.remove("hidden");
                } else {
                    card.classList.add("hidden");
                }
            });
            if (matched) {
                var section = document.getElementById("all-products-section");
                if (section) section.scrollIntoView({ behavior: "smooth" });
            }
        }, 300);
    }
});

/* ===== Theme ===== */
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
}

function toggleTheme() {
    var isDark = document.body.classList.contains("dark-mode");
    applyTheme(isDark ? "light" : "dark");
}

/* ===== Back to Top ===== */
function initBackToTop() {
    var btn = document.getElementById("backToTop");
    if (!btn) {
        btn = document.createElement("button");
        btn.id = "backToTop";
        btn.className = "back-to-top";
        btn.innerHTML = "↑";
        btn.title = "Back to top";
        btn.onclick = function () { window.scrollTo({ top: 0, behavior: "smooth" }); };
        document.body.appendChild(btn);
    }
    window.addEventListener("scroll", function () {
        if (window.scrollY > 300) btn.classList.add("visible");
        else btn.classList.remove("visible");
    });
}

