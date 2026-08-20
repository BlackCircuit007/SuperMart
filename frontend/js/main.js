/* ============================================================
 *  TRIUMPHSMART — Main Application Script
 *  Features:
 *    • Responsive mobile menu & category dropdown
 *    • Dynamic product rendering (from API database)
 *    • Search with debounce
 *    • Cart (add / inc / dec / remove / render / count)
 *    • Auth (register / verify / login) with real backend
 *    • Admin panel integration
 *    • User dashboard
 *    • Quick view modal
 *    • Toast notifications
 * ============================================================ */

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

/* ===== Cart ===== */
function incQty(index) {
    var user = getCurrentUser();
    if (!user) return;
    getCartItems().then(function (cart) {
        if (!cart[index]) return;
        cart[index].quantity += 1;
        apiSaveCart(cart).then(function () {
            renderCart();
            updateCartCount();
        });
    });
}

function decQty(index) {
    var user = getCurrentUser();
    if (!user) return;
    getCartItems().then(function (cart) {
        if (!cart[index]) return;
        cart[index].quantity -= 1;
        if (cart[index].quantity <= 0) cart.splice(index, 1);
        apiSaveCart(cart).then(function () {
            renderCart();
            updateCartCount();
        });
    });
}

function removeItem(index) {
    var user = getCurrentUser();
    if (!user) return;
    getCartItems().then(function (cart) {
        cart.splice(index, 1);
        apiSaveCart(cart).then(function () {
            renderCart();
            updateCartCount();
        });
    });
}

function renderCart() {
    updateCartCount();
}

/* ===== Product Rendering ===== */
async function renderFeaturedProducts() {
    var container = document.getElementById("featured-products");
    if (!container) return;
    var products = await loadProductsFromAPI();
    var featured = products.filter(function (p) { return p.featured; });
    if (featured.length === 0) featured = products.slice(0, 8);
    container.innerHTML = featured.map(productCardHtml).join("");
    bindSearch(container);
}

async function renderAllProducts() {
    var container = document.getElementById("all-products");
    if (!container) return;
    var products = await loadProductsFromAPI();
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
    window.location.href = "checkout.html";
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