const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// ===== CockroachDB (PostgreSQL-compatible) connection =====
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('cockroachlabs.cloud')
        ? { rejectUnauthorized: false }
        : false
});

// ===== Table creation =====
async function createTables() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'buyer',
                is_verified INTEGER NOT NULL DEFAULT 0,
                profile_pic TEXT,
                created_at TEXT NOT NULL
            )
        `);

        // Products table
        await client.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                price NUMERIC NOT NULL,
                rating NUMERIC DEFAULT 4.5,
                description TEXT DEFAULT '',
                image TEXT DEFAULT '🛍️',
                gallery TEXT,
                featured INTEGER DEFAULT 0,
                stock INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
        `);

        // Orders table
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                order_ref TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                customer_name TEXT NOT NULL,
                customer_email TEXT NOT NULL,
                customer_phone TEXT NOT NULL,
                shipping_address TEXT NOT NULL,
                payment_method TEXT NOT NULL,
                payment_status TEXT NOT NULL DEFAULT 'pending',
                total NUMERIC NOT NULL,
                items TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                delivered INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
        `);

        // Existing databases need this migration too.
        await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered INTEGER NOT NULL DEFAULT 0`);

        // Verification codes table
        await client.query(`
            CREATE TABLE IF NOT EXISTS verification_codes (
                id SERIAL PRIMARY KEY,
                email TEXT NOT NULL,
                code TEXT NOT NULL,
                purpose TEXT NOT NULL DEFAULT 'register',
                expires_at TEXT NOT NULL,
                used INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
        `);

        // Worker codes table
        await client.query(`
            CREATE TABLE IF NOT EXISTS worker_codes (
                id SERIAL PRIMARY KEY,
                worker_id INTEGER NOT NULL,
                login_code TEXT NOT NULL,
                is_used INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            )
        `);

        // Payment verifications table
        await client.query(`
            CREATE TABLE IF NOT EXISTS payment_verifications (
                id SERIAL PRIMARY KEY,
                order_ref TEXT NOT NULL,
                payer_name TEXT,
                payer_phone TEXT NOT NULL,
                payer_email TEXT,
                amount NUMERIC NOT NULL,
                transaction_ref TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL
            )
        `);

        // Carts table
        await client.query(`
            CREATE TABLE IF NOT EXISTS carts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL UNIQUE,
                items TEXT NOT NULL DEFAULT '[]',
                updated_at TEXT NOT NULL
            )
        `);

        await client.query('COMMIT');
        console.log('✅ Database tables ready');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

// ===== Collection helpers (async) =====
async function getAll(collection) {
    const table = collection;
    const result = await pool.query(`SELECT * FROM ${table} ORDER BY id`);
    return result.rows;
}

async function getById(collection, id) {
    const table = collection;
    const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
    return result.rows[0] || null;
}

async function findBy(collection, predicate) {
    const rows = await getAll(collection);
    return rows.find(predicate) || null;
}

async function findAll(collection, predicate) {
    const rows = await getAll(collection);
    return rows.filter(predicate);
}

async function insert(collection, data) {
    const table = collection;
    const keys = Object.keys(data);
    const values = keys.map(k => data[k]);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(
        `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders}) RETURNING *`,
        values
    );
    return result.rows[0];
}

async function update(collection, id, data) {
    const table = collection;
    const keys = Object.keys(data);
    const values = keys.map(k => data[k]);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const result = await pool.query(
        `UPDATE ${table} SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
        [...values, id]
    );
    return result.rows[0] || null;
}

async function remove(collection, id) {
    const table = collection;
    const result = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return result.rowCount > 0;
}

async function removeWhere(collection, predicate) {
    const rows = await getAll(collection);
    const toRemove = rows.filter(predicate);
    for (const row of toRemove) {
        await remove(collection, row.id);
    }
    return toRemove.length;
}

// ===== Seed data =====
async function seedData() {
    // Seed admin user
    const adminEmail = 'admin';
    const adminExists = await findBy('users', u => u.email === adminEmail);
    if (!adminExists) {
        const hashedPassword = bcrypt.hashSync('admin', 10);
        await insert('users', {
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
//     const productCount = await pool.query('SELECT COUNT(*) FROM products');
//     if (parseInt(productCount.rows[0].count) === 0) {
//         const seedProducts = [
//             // Skin Care
//             { name: "Vitamin C Brightening Serum", category: "Skin Care", price: 8500, rating: 4.8, description: "Powerful 20% Vitamin C serum that brightens skin, fades dark spots and evens tone for a radiant glow.", image: "🧴", featured: 1, stock: 50 },
//             { name: "Hyaluronic Acid Moisturizer", category: "Skin Care", price: 12500, rating: 4.7, description: "Deep-hydrating gel cream with hyaluronic acid. Locks in moisture for 72 hours — all skin types.", image: "🧴", featured: 1, stock: 40 },
//             { name: "Gentle Foaming Face Cleanser", category: "Skin Care", price: 6500, rating: 4.6, description: "Mild sulfate-free cleanser that removes makeup and impurities without stripping your skin barrier.", image: "🧼", featured: 0, stock: 60 },
//             { name: "SPF 50 Sunscreen Lotion", category: "Skin Care", price: 9800, rating: 4.9, description: "Broad-spectrum UVA/UVB protection. Lightweight, non-greasy and perfect for daily wear.", image: "☀️", featured: 1, stock: 35 },
//             { name: "Toning & Brightening Toner", category: "Skin Care", price: 7200, rating: 4.4, description: "Alcohol-free facial toner with witch hazel and niacinamide to tighten pores and refresh skin.", image: "💧", featured: 0, stock: 45 },
//             { name: "Raw African Shea Butter", category: "Skin Care", price: 4500, rating: 4.9, description: "100% pure unrefined shea butter. Deeply nourishes skin and hair, great for stretch marks and eczema.", image: "🧈", featured: 1, stock: 80 },
//             { name: "Nourishing Body Lotion Cocoa", category: "Skin Care", price: 5500, rating: 4.5, description: "Rich cocoa butter body lotion that moisturises and repairs dry, ashy skin all day.", image: "🧴", featured: 0, stock: 55 },
//             { name: "Retinol Anti-Aging Cream", category: "Skin Care", price: 15800, rating: 4.6, description: "Night cream with retinol and collagen to reduce fine lines, wrinkles and firm the skin.", image: "🌙", featured: 0, stock: 25 },
//             { name: "Charcoal Pore Face Mask", category: "Skin Care", price: 5200, rating: 4.3, description: "Detoxifying black charcoal mask that unclogs pores and absorbs excess oil.", image: "🖤", featured: 0, stock: 70 },
//             { name: "Coconut Hair & Skin Oil", category: "Skin Care", price: 3900, rating: 4.5, description: "Cold-pressed coconut oil for shiny hair and soft, supple skin. 100% natural.", image: "🥥", featured: 0, stock: 65 },
//             // Provisions
//             { name: "Indomie Instant Noodles (Carton)", category: "Provisions", price: 18500, rating: 4.8, description: "Carton of 40 packs of the classic chicken flavour — a Nigerian household favourite.", image: "🍜", featured: 1, stock: 30 },
//             { name: "Long Grain Parboiled Rice 50kg", category: "Provisions", price: 78500, rating: 4.9, description: "Premium 50kg bag of long-grain parboiled rice — perfect for jollof, fried rice and more.", image: "🍚", featured: 1, stock: 20 },
//             { name: "Pure Vegetable Oil 5L", category: "Provisions", price: 16500, rating: 4.7, description: "Refined 5-litre vegetable oil, cholesterol-free, great for frying and cooking.", image: "🛢️", featured: 1, stock: 40 },
//             { name: "Granulated White Sugar 1kg", category: "Provisions", price: 3200, rating: 4.6, description: "Fine granulated sugar, perfect for sweetening tea, coffee, baking and drinks.", image: "🍬", featured: 0, stock: 100 },
//             { name: "Evaporated Milk (Tin) 12-Pack", category: "Provisions", price: 12500, rating: 4.7, description: "Smooth creamy evaporated milk, ideal for tea, coffee, cereal and desserts. Pack of 12.", image: "🥛", featured: 1, stock: 50 },
//             { name: "Tomato Paste 12-Pack", category: "Provisions", price: 9800, rating: 4.6, description: "Rich concentrated tomato paste for stews, sauces and jollof rice. Pack of 12 tins.", image: "🍅", featured: 0, stock: 60 },
//             { name: "Golden Penny Spaghetti 1kg", category: "Provisions", price: 2800, rating: 4.5, description: "Premium durum wheat spaghetti — a staple for quick, tasty meals.", image: "🍝", featured: 1, stock: 90 },
//             { name: "Instant Coffee 200g", category: "Provisions", price: 6200, rating: 4.4, description: "Bold, aromatic instant coffee granules for a rich cup anytime.", image: "☕", featured: 0, stock: 45 },
//             { name: "Powdered Milk 500g", category: "Provisions", price: 5800, rating: 4.7, description: "Full-cream powdered milk, rich in calcium and vitamins for the whole family.", image: "🥛", featured: 0, stock: 55 },
//             { name: "Sardines in Oil 6-Pack", category: "Provisions", price: 7600, rating: 4.5, description: "Tasty sardines in vegetable oil, packed with protein and omega-3. 6 tins.", image: "🐟", featured: 0, stock: 40 },
//             { name: "Groundnut Oil 2L", category: "Provisions", price: 11500, rating: 4.8, description: "100% pure refined groundnut oil — rich, nutty flavour for authentic cooking.", image: "🥜", featured: 0, stock: 35 },
//             { name: "Cornflakes 500g", category: "Provisions", price: 4200, rating: 4.4, description: "Crunchy toasted cornflakes, fortified with vitamins and iron. Great with milk.", image: "🥣", featured: 0, stock: 75 },
//             { name: "Cream Crackers 250g", category: "Provisions", price: 2300, rating: 4.3, description: "Light, crispy cream crackers. Perfect with tea, cheese or on their own.", image: "🍘", featured: 0, stock: 85 },
//             { name: "Malted Chocolate Drink 450g", category: "Provisions", price: 6900, rating: 4.6, description: "Rich malted chocolate drink for energy-packed breakfasts and snacks.", image: "🍫", featured: 1, stock: 50 }
//         ];

//         for (const p of seedProducts) {
//             await insert('products', {
//                 ...p,
//                 gallery: null,
//                 created_at: new Date().toISOString()
//             });
//         }
//         console.log(`✅ Seeded ${seedProducts.length} products`);
//     }
}  

// ===== Init =====
async function init() {
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL not set. Add your CockroachDB connection string to .env');
        process.exit(1);
    }
    await createTables();
    await seedData();
}

module.exports = {
    pool,
    init,
    getAll,
    getById,
    findBy,
    findAll,
    insert,
    update,
    remove,
    removeWhere
};
