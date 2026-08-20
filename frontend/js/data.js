/* ============================================================
 *  TRIUMPHSMART — Product Data (API backed)
 *  All products are fetched from the backend database.
 * ============================================================ */

var STORE_KEY = "tm_products_v1";

/* ---- Product helpers ----------------------------------- */
function getProducts() {
    // Synchronous wrapper - returns cached or empty
    return JSON.parse(localStorage.getItem(STORE_KEY)) || [];
}

function saveProducts(products) {
    localStorage.setItem(STORE_KEY, JSON.stringify(products));
}

async function loadProductsFromAPI() {
    try {
        const products = await apiGetProducts();
        saveProducts(products);
        return products;
    } catch (err) {
        console.error('Failed to load products from API:', err);
        return getProducts();
    }
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

/* ---- Admin: add / remove (via API) ------------------------ */
async function adminAddProduct(product) {
    const result = await apiAddProduct(product);
    await loadProductsFromAPI();
    return result.product;
}

async function adminRemoveProduct(id) {
    await apiDeleteProduct(id);
    await loadProductsFromAPI();
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