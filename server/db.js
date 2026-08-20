const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// Ensure data directory exists
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const DB_FILE = path.join(dataDir, 'triumphmart.json');

// ===== Simple JSON file database =====
let db = {
    users: [],
    products: [],
    orders: [],
    verification_codes: [],
    worker_codes: [],
    payment_verifications: [],
    carts: [],
    _nextId: {
        users: 1,
        products: 1,
        orders: 1,
        verification_codes: 1,
        worker_codes: 1,
        payment_verifications: 1,
        carts: 1
    }
};

// Load existing database
function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            db = { ...db, ...data };
        }
    } catch (err) {
        console.error('Failed to load database:', err);
    }
}

// Save database
function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (err) {
        console.error('Failed to save database:', err);
    }
}

// Get next ID for a collection
function nextId(collection) {
    const id = db._nextId[collection] || 1;
    db._nextId[collection] = id + 1;
    return id;
}

// ===== Collection helpers =====
function getAll(collection) {
    return db[collection] || [];
}

function getById(collection, id) {
    return (db[collection] || []).find(item => item.id === id);
}

function findBy(collection, predicate) {
    return (db[collection] || []).find(predicate);
}

function findAll(collection, predicate) {
    return (db[collection] || []).filter(predicate);
}

function insert(collection, data) {
    const item = { id: nextId(collection), ...data };
    if (!db[collection]) db[collection] = [];
    db[collection].push(item);
    saveDB();
    return item;
}

function update(collection, id, data) {
    const index = (db[collection] || []).findIndex(item => item.id === id);
    if (index === -1) return null;
    db[collection][index] = { ...db[collection][index], ...data };
    saveDB();
    return db[collection][index];
}

function remove(collection, id) {
    const index = (db[collection] || []).findIndex(item => item.id === id);
    if (index === -1) return false;
    db[collection].splice(index, 1);
    saveDB();
    return true;
}

function removeWhere(collection, predicate) {
    const before = (db[collection] || []).length;
    db[collection] = (db[collection] || []).filter(item => !predicate(item));
    saveDB();
    return before - db[collection].length;
}

// ===== Seed data =====
function seedData() {
    // Seed admin user
    const adminEmail = 'admin@triumphsmart.com';
    const adminExists = (db.users || []).find(u => u.email === adminEmail);
    if (!adminExists) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        insert('users', {
            name: 'Admin',
            email: adminEmail,
            password: hashedPassword,
            role: 'admin',
            is_verified: 1,
            profile_pic: null,
            created_at: new Date().toISOString()
        });
        console.log('✅ Admin user created: admin@triumphsmart.com / admin123');
    }

    // Seed products if empty
    if ((db.products || []).length === 0) {
        const seedProducts = [
            // Skin Care
            { name: "Vitamin C Brightening Serum", category: "Skin Care", price: 8500, rating: 4.8, description: "Powerful 20% Vitamin C serum that brightens skin, fades dark spots and evens tone for a radiant glow.", image: "🧴", featured: 1, stock: 50 },
            { name: "Hyaluronic Acid Moisturizer", category: "Skin Care", price: 12500, rating: 4.7, description: "Deep-hydrating gel cream with hyaluronic acid. Locks in moisture for 72 hours — all skin types.", image: "🧴", featured: 1, stock: 40 },
            { name: "Gentle Foaming Face Cleanser", category: "Skin Care", price: 6500, rating: 4.6, description: "Mild sulfate-free cleanser that removes makeup and impurities without stripping your skin barrier.", image: "🧼", featured: 0, stock: 60 },
            { name: "SPF 50 Sunscreen Lotion", category: "Skin Care", price: 9800, rating: 4.9, description: "Broad-spectrum UVA/UVB protection. Lightweight, non-greasy and perfect for daily wear.", image: "☀️", featured: 1, stock: 35 },
            { name: "Toning & Brightening Toner", category: "Skin Care", price: 7200, rating: 4.4, description: "Alcohol-free facial toner with witch hazel and niacinamide to tighten pores and refresh skin.", image: "💧", featured: 0, stock: 45 },
            { name: "Raw African Shea Butter", category: "Skin Care", price: 4500, rating: 4.9, description: "100% pure unrefined shea butter. Deeply nourishes skin and hair, great for stretch marks and eczema.", image: "🧈", featured: 1, stock: 80 },
            { name: "Nourishing Body Lotion Cocoa", category: "Skin Care", price: 5500, rating: 4.5, description: "Rich cocoa butter body lotion that moisturises and repairs dry, ashy skin all day.", image: "🧴", featured: 0, stock: 55 },
            { name: "Retinol Anti-Aging Cream", category: "Skin Care", price: 15800, rating: 4.6, description: "Night cream with retinol and collagen to reduce fine lines, wrinkles and firm the skin.", image: "🌙", featured: 0, stock: 25 },
            { name: "Charcoal Pore Face Mask", category: "Skin Care", price: 5200, rating: 4.3, description: "Detoxifying black charcoal mask that unclogs pores and absorbs excess oil.", image: "🖤", featured: 0, stock: 70 },
            { name: "Coconut Hair & Skin Oil", category: "Skin Care", price: 3900, rating: 4.5, description: "Cold-pressed coconut oil for shiny hair and soft, supple skin. 100% natural.", image: "🥥", featured: 0, stock: 65 },
            // Provisions
            { name: "Indomie Instant Noodles (Carton)", category: "Provisions", price: 18500, rating: 4.8, description: "Carton of 40 packs of the classic chicken flavour — a Nigerian household favourite.", image: "🍜", featured: 1, stock: 30 },
            { name: "Long Grain Parboiled Rice 50kg", category: "Provisions", price: 78500, rating: 4.9, description: "Premium 50kg bag of long-grain parboiled rice — perfect for jollof, fried rice and more.", image: "🍚", featured: 1, stock: 20 },
            { name: "Pure Vegetable Oil 5L", category: "Provisions", price: 16500, rating: 4.7, description: "Refined 5-litre vegetable oil, cholesterol-free, great for frying and cooking.", image: "🛢️", featured: 1, stock: 40 },
            { name: "Granulated White Sugar 1kg", category: "Provisions", price: 3200, rating: 4.6, description: "Fine granulated sugar, perfect for sweetening tea, coffee, baking and drinks.", image: "🍬", featured: 0, stock: 100 },
            { name: "Evaporated Milk (Tin) 12-Pack", category: "Provisions", price: 12500, rating: 4.7, description: "Smooth creamy evaporated milk, ideal for tea, coffee, cereal and desserts. Pack of 12.", image: "🥛", featured: 1, stock: 50 },
            { name: "Tomato Paste 12-Pack", category: "Provisions", price: 9800, rating: 4.6, description: "Rich concentrated tomato paste for stews, sauces and jollof rice. Pack of 12 tins.", image: "🍅", featured: 0, stock: 60 },
            { name: "Golden Penny Spaghetti 1kg", category: "Provisions", price: 2800, rating: 4.5, description: "Premium durum wheat spaghetti — a staple for quick, tasty meals.", image: "🍝", featured: 1, stock: 90 },
            { name: "Instant Coffee 200g", category: "Provisions", price: 6200, rating: 4.4, description: "Bold, aromatic instant coffee granules for a rich cup anytime.", image: "☕", featured: 0, stock: 45 },
            { name: "Powdered Milk 500g", category: "Provisions", price: 5800, rating: 4.7, description: "Full-cream powdered milk, rich in calcium and vitamins for the whole family.", image: "🥛", featured: 0, stock: 55 },
            { name: "Sardines in Oil 6-Pack", category: "Provisions", price: 7600, rating: 4.5, description: "Tasty sardines in vegetable oil, packed with protein and omega-3. 6 tins.", image: "🐟", featured: 0, stock: 40 },
            { name: "Groundnut Oil 2L", category: "Provisions", price: 11500, rating: 4.8, description: "100% pure refined groundnut oil — rich, nutty flavour for authentic cooking.", image: "🥜", featured: 0, stock: 35 },
            { name: "Cornflakes 500g", category: "Provisions", price: 4200, rating: 4.4, description: "Crunchy toasted cornflakes, fortified with vitamins and iron. Great with milk.", image: "🥣", featured: 0, stock: 75 },
            { name: "Cream Crackers 250g", category: "Provisions", price: 2300, rating: 4.3, description: "Light, crispy cream crackers. Perfect with tea, cheese or on their own.", image: "🍘", featured: 0, stock: 85 },
            { name: "Malted Chocolate Drink 450g", category: "Provisions", price: 6900, rating: 4.6, description: "Rich malted chocolate drink for energy-packed breakfasts and snacks.", image: "🍫", featured: 1, stock: 50 }
        ];

        seedProducts.forEach(p => {
            insert('products', {
                ...p,
                gallery: null,
                created_at: new Date().toISOString()
            });
        });
        console.log(`✅ Seeded ${seedProducts.length} products`);
    }
}

// Load and seed
loadDB();
seedData();

module.exports = {
    getAll,
    getById,
    findBy,
    findAll,
    insert,
    update,
    remove,
    removeWhere,
    saveDB
};