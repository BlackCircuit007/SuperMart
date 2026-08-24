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
    return getProducts().find(function (p) { return String(p.id) === String(id); });
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

// Stock availability badge — reads the inventory-derived fields (p.in_stock,
// p.stock_available, p.low_stock) with a fallback to the legacy p.stock mirror.
function stockBadgeHtml(p) {
    var inStock = p.in_stock !== undefined ? !!p.in_stock : Number(p.stock) > 0;
    var qty = Number(p.stock_available !== undefined ? p.stock_available : p.stock) || 0;
    var low = !!p.low_stock && inStock;
    if (!inStock) return '<span class="stock-badge out">Out of Stock</span>';
    return '<span class="stock-badge ' + (low ? 'low' : 'in') + '">' +
        (low ? "Low Stock" : "In Stock") +
        (qty > 0 && qty <= 5 ? ' — ' + qty + ' left' : '') + '</span>';
}

// Add-to-cart button — disabled and relabelled when the product is out of stock.
function addCartButtonHtml(p, productId) {
    var inStock = p.in_stock !== undefined ? !!p.in_stock : Number(p.stock) > 0;
    if (!inStock) {
        return '<button type="button" class="add-cart-btn" disabled title="This product is currently out of stock">Out of Stock</button>';
    }
    return '<button type="button" class="add-cart-btn" data-product-action="add-cart" data-product-id=' + productId + '>Add to Cart</button>';
}
function productCardHtml(p) {
    var productId = JSON.stringify(String(p.id));
    var imgHtml = p.image && (String(p.image).indexOf("data:") === 0 || String(p.image).indexOf("http") === 0)
        ? '<img src="' + p.image + '" alt="' + p.name + '">'
        : '<span class="card-icon">' + (p.image || "🛍️") + "</span>";
    return (
        '<div class="card" data-search="' + (p.name + " " + p.category + " " + p.description).toLowerCase() + '" data-category="' + p.category + '" data-id="' + p.id + '">' +
        '<div class="card-image">' +
        (p.featured ? '<span class="card-badge diamond">Featured</span>' : "") +
        '<button type="button" class="quickview-btn-img" data-product-action="quick-view" data-product-id=' + productId + ' title="Quick view">👁</button>' +
        imgHtml +
        "</div>" +
        '<div class="card-body">' +
        '<span class="card-category">' + p.category + "</span>" +
        stockBadgeHtml(p) +
        "<h3>" + p.name + "</h3>" +
        "<p>" + p.description + "</p>" +
        '<div class="card-meta">' +
        '<span class="card-rating"><span class="star">★</span> ' + p.rating + "</span>" +
        "</div>" +
        '<div class="price-row"><span class="price">' + price(p.price) + "</span>" +
        (p.carton_enabled ? '<small class="carton-summary">Carton: ' + price(p.carton_price) + ' (' + p.units_per_carton + ' pieces)</small>' : '') +
        '</div>' +
        '<div class="card-actions">' +
        addCartButtonHtml(p, productId) +
        '<button type="button" class="quickview-btn" data-product-action="quick-view" data-product-id=' + productId + '>Quick View</button>' +
        "</div>" +
        "</div>" +
        "</div>"
    );
}
