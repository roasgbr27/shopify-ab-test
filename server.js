const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const fetch = require("node-fetch");
const session = require("express-session");
require("dotenv").config();

const app = express();
app.use(express.json());
app.use(cors());

// 📌 MongoDB Verbindung
mongoose.connect(process.env.MONGO_DB_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ MongoDB verbunden!"))
.catch(err => console.error("❌ MongoDB Fehler:", err));

// 📌 Shopify OAuth Setup
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const APP_URL = process.env.APP_URL;
const SCOPES = "read_products,write_products,read_orders,read_themes,write_themes";

// 📌 MongoDB Schema für Shopify-Shops
const ShopSchema = new mongoose.Schema({
  shop: String,
  accessToken: String,
});
const Shop = mongoose.model("Shop", ShopSchema);

// 📌 MongoDB Schema für A/B-Tests
const ABTestSchema = new mongoose.Schema({
  test_id: String,
  shop: String,
  product_id: String,
  start_time: Date,
  variant_a_visitors: { type: Number, default: 0 },
  variant_b_visitors: { type: Number, default: 0 },
  variant_a_clicks: { type: Number, default: 0 },
  variant_b_clicks: { type: Number, default: 0 },
  variant_a_conversions: { type: Number, default: 0 },
  variant_b_conversions: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
});
const ABTest = mongoose.model("ABTest", ABTestSchema);

// 📌 Express-Session für OAuth
app.use(session({ secret: "super_secret_key", resave: false, saveUninitialized: true }));

// 📌 Shopify OAuth Weiterleitung
app.get("/auth", async (req, res) => {
  const shop = req.query.shop;
  if (!shop) return res.status(400).send("Fehlender Shop-Parameter.");
  
  const redirectUri = `${APP_URL}/auth/callback`;
  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${redirectUri}`;

  res.redirect(installUrl);
});

// 📌 Shopify Callback (Zugriffstoken speichern)
app.get("/auth/callback", async (req, res) => {
  const { shop, code } = req.query;
  if (!shop || !code) return res.status(400).send("Fehlende Parameter.");

  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code,
    }),
  });

  const data = await response.json();
  if (!data.access_token) return res.status(400).send("OAuth fehlgeschlagen.");

  await Shop.findOneAndUpdate({ shop }, { shop, accessToken: data.access_token }, { upsert: true });

  res.redirect(`https://${shop}/admin/apps`);
});

// 📌 Besucher zufällig auf A oder B verteilen
app.get("/assign-test/:productId/:shop", async (req, res) => {
  const { productId, shop } = req.params;
  let test = await ABTest.findOne({ product_id: productId, shop, active: true });

  if (!test) {
    test = await ABTest.create({
      test_id: Math.random().toString(36).substring(7),
      shop,
      product_id: productId,
      start_time: new Date(),
      active: true,
    });
  }

  const variant = Math.random() < 0.5 ? "A" : "B";
  if (variant === "A") test.variant_a_visitors += 1;
  else test.variant_b_visitors += 1;
  await test.save();

  res.json({ variant, url: `https://${shop}/products/${productId}?view=${variant}` });
});

// 📌 Server starten
app.listen(3000, () => console.log("🚀 Shopify A/B-Testing Backend läuft!"));
