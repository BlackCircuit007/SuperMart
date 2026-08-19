/* ============================================================
 *  TRIUMPHSMART — Product Database (localStorage backed)
 *  All products are stored in localStorage. The admin can add
 *  or remove products and changes persist on every page.
 *  Seed products: SKIN CARE + PROVISIONS only.
 * ============================================================ */

var STORE_KEY = "tm_products_v1";

/* ---- Default seed products --------------------------------- */
var SEED_PRODUCTS = [
    // ===== SKIN CARE =====
    { id: 1, name: "Vitamin C Brightening Serum", category: "Skin Care", price: 8500, rating: 4.8, description: "Powerful 20% Vitamin C serum that brightens skin, fades dark spots and evens tone for a radiant glow.", image: "🧴", featured: true },
    { id: 2, name: "Hyaluronic Acid Moisturizer", category: "Skin Care", price: 12500, rating: 4.7, description: "Deep-hydrating gel cream with hyaluronic acid. Locks in moisture for 72 hours — all skin types.", image: "🧴", featured: true },
    { id: 3, name: "Gentle Foaming Face Cleanser", category: "Skin Care", price: 6500, rating: 4.6, description: "Mild sulfate-free cleanser that removes makeup and impurities without stripping your skin barrier.", image: "🧼", featured: false },
    { id: 4, name: "SPF 50 Sunscreen Lotion", category: "Skin Care", price: 9800, rating: 4.9, description: "Broad-spectrum UVA/UVB protection. Lightweight, non-greasy and perfect for daily wear.", image: "☀️", featured: true },
    { id: 5, name: "Toning & Brightening Toner", category: "Skin Care", price: 7200, rating: 4.4, description: "Alcohol-free facial toner with witch hazel and niacinamide to tighten pores and refresh skin.", image: "💧", featured: false },
    { id: 6, name: "Raw African Shea Butter", category: "Skin Care", price: 4500, rating: 4.9, description: "100% pure unrefined shea butter. Deeply nourishes skin and hair, great for stretch marks and eczema.", image: "🧈", featured: true },
    { id: 7, name: "Nourishing Body Lotion Cocoa", category: "Skin Care", price: 5500, rating: 4.5, description: "Rich cocoa butter body lotion that moisturises and repairs dry, ashy skin all day.", image: "🧴", featured: false },
    { id: 8, name: "Retinol Anti-Aging Cream", category: "Skin Care", price: 15800, rating: 4.6, description: "Night cream with retinol and collagen to reduce fine lines, wrinkles and firm the skin.", image: "🌙", featured: false },
    { id: 9, name: "Charcoal Pore Face Mask", category: "Skin Care", price: 5200, rating: 4.3, description: "Detoxifying black charcoal mask that unclogs pores and absorbs excess oil.", image: "🖤", featured: false },
    { id: 10, name: "Coconut Hair & Skin Oil", category: "Skin Care", price: 3900, rating: 4.5, description: "Cold-pressed coconut oil for shiny hair and soft, supple skin. 100% natural.", image: "🥥", featured: false },

    // ===== PROVISIONS =====
    { id: 11, name: "Indomie Instant Noodles (Carton)", category: "Provisions", price: 18500, rating: 4.8, description: "Carton of 40 packs of the classic chicken flavour — a Nigerian household favourite.", image: "🍜", featured: true },
    { id: 12, name: "Long Grain Parboiled Rice 50kg", category: "Provisions", price: 78500, rating: 4.9, description: "Premium 50kg bag of long-grain parboiled rice — perfect for jollof, fried rice and more.", image: "🍚", featured: true },
    { id: 13, name: "Pure Vegetable Oil 5L", category: "Provisions", price: 16500, rating: 4.7, description: "Refined 5-litre vegetable oil, cholesterol-free, great for frying and cooking.", image: "🛢️", featured: true },
    { id: 14, name: "Granulated White Sugar 1kg", category: "Provisions", price: 3200, rating: 4.6, description: "Fine granulated sugar, perfect for sweetening tea, coffee, baking and drinks.", image: "🍬", featured: false },
    { id: 15, name: "Evaporated Milk (Tin) 12-Pack", category: "Provisions", price: 12500, rating: 4.7, description: "Smooth creamy evaporated milk, ideal for tea, coffee, cereal and desserts. Pack of 12.", image: "🥛", featured: true },
    { id: 16, name: "Tomato Paste 12-Pack", category: "Provisions", price: 9800, rating: 4.6, description: "Rich concentrated tomato paste for stews, sauces and jollof rice. Pack of 12 tins.", image: "🍅", featured: false },
    { id: 17, name: "Golden Penny Spaghetti 1kg", category: "Provisions", price: 2800, rating: 4.5, description: "Premium durum wheat spaghetti — a staple for quick, tasty meals.", image: "🍝", featured: true },
    { id: 18, name: "Instant Coffee 200g", category: "Provisions", price: 6200, rating: 4.4, description: "Bold, aromatic instant coffee granules for a rich cup anytime.", image: "☕", featured: false },
    { id: 19, name: "Powdered Milk 500g", category: "Provisions", price: 5800, rating: 4.7, description: "Full-cream powdered milk, rich in calcium and vitamins for the whole family.", image: "🥛", featured: false },
    { id: 20, name: "Sardines in Oil 6-Pack", category: "Provisions", price: 7600, rating: 4.5, description: "Tasty sardines in vegetable oil, packed with protein and omega-3. 6 tins.", image: "🐟", featured: false },
    { id: 21, name: "Groundnut Oil 2L", category: "Provisions", price: 11500, rating: 4.8, description: "100% pure refined groundnut oil — rich, nutty flavour for authentic cooking.", image: "🥜", featured: false },
    { id: 22, name: "Cornflakes 500g", category: "Provisions", price: 4200, rating: 4.4, description: "Crunchy toasted cornflakes, fortified with vitamins and iron. Great with milk.", image: "🥣", featured: false },
    { id: 23, name: "Cream Crackers 250g", category: "Provisions", price: 2300, rating: 4.3, description: "Light, crispy cream crackers. Perfect with tea, cheese or on their own.", image: "🍘", featured: false },
    { id: 24, name: "Malted Chocolate Drink 450g", category: "Provisions", price: 6900, rating: 4.6, description: "Rich malted chocolate drink for energy-packed breakfasts and snacks.", image: "🍫", featured: true }
];

/* ---- Persistence helpers ----------------------------------- */
function getProducts() {
    var stored = localStorage.getItem(STORE_KEY);
    if (stored) {
        try { return JSON.parse(stored); } catch (e) { /* fall through */ }
    }
    // First run: seed the database
    localStorage.setItem(STORE_KEY, JSON.stringify(SEED_PRODUCTS));
    return JSON.parse(JSON.stringify(SEED_PRODUCTS));
}

function saveProducts(products) {
    localStorage.setItem(STORE_KEY, JSON.stringify(products));
}

function nextProductId(products) {
    return products.reduce(function (max, p) { return Math.max(max, p.id); }, 0) + 1;
}

/* ---- Category helpers -------------------------------------- */
function getCategories() {
    var cats = ["All"];
    getProducts().forEach(function (p) {
        if (cats.indexOf(p.category) === -1) cats.push(p.category);
    });
    return cats;
}

/* ---- Product lookup ---------------------------------------- */
function findProductById(id) {
    return getProducts().find(function (p) { return p.id === id; });
}

/* ---- Admin: add / remove ----------------------------------- */
function adminAddProduct(product) {
    var products = getProducts();
    product.id = nextProductId(products);
    products.push(product);
    saveProducts(products);
    return product;
}

function adminRemoveProduct(id) {
    var products = getProducts();
    var filtered = products.filter(function (p) { return p.id !== id; });
    saveProducts(filtered);
    // Also scrub it from every user's cart
    var users = JSON.parse(localStorage.getItem("users")) || [];
    users.forEach(function (u) {
        var key = "cart_" + u.email;
        var cart = JSON.parse(localStorage.getItem(key)) || [];
        cart = cart.filter(function (item) { return item.id !== id; });
        localStorage.setItem(key, JSON.stringify(cart));
    });
    return true;
}

/* ---- Render helpers ---------------------------------------- */
function price(n) {
    return "\u20A6" + Number(n).toLocaleString();
}

function ratingStars(r) {
    var full = Math.round(Number(r) || 0);
    var out = "";
    for (var i = 0; i < 5; i++) {
        out += i < full ? "★" : "☆";
    }
    return out;
}

function productCardHtml(p) {
    var imgHtml = p.image && (String(p.image).indexOf("data:") === 0 || String(p.image).indexOf("http") === 0)
        ? '<img src="' + p.image + '" alt="' + p.name + '">'
        : '<span class="card-icon">' + (p.image || "🛍️") + "</span>";
    return (
        '<div class="card" data-search="' + (p.name + " " + p.category + " " + p.description).toLowerCase() + '" data-category="' + p.category + '" data-id="' + p.id + '">' +
        '<div class="card-image">' +
        (p.featured ? '<span class="card-badge diamond">Featured</span>' : "") +
        '<button class="quickview-btn-img" onclick="event.stopPropagation();openQuickView(' + p.id + ')" title="Quick view">👁</button>' +
        imgHtml +
        "</div>" +
        '<div class="card-body">' +
        '<span class="card-category">' + p.category + "</span>" +
        "<h3>" + p.name + "</h3>" +
        "<p>" + p.description + "</p>" +
        '<div class="card-meta">' +
        '<span class="card-rating"><span class="star">★</span> ' + p.rating + "</span>" +
        "</div>" +
        '<div class="price-row"><span class="price">' + price(p.price) + "</span></div>" +
        '<div class="card-actions">' +
        '<button class="add-cart-btn" onclick="addToCart(' + p.id + ')">Add to Cart</button>' +
        '<button class="quickview-btn" onclick="openQuickView(' + p.id + ')">Quick View</button>' +
        "</div>" +
        "</div>" +
        "</div>"
    );
}