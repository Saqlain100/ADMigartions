/**
 * 🌏 Eibeyon Immigration Backend (Admin + Search + Pagination)
 */
const XLSX = require("xlsx");
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
const port = process.env.PORT || 8080;

app.use(cors({ origin: "*" }));
app.use(express.json());

// === MongoDB Connection ===
const uri =
  "mongodb+srv://saqlainmubarik10_db_user:MLjYzAAndgMb1FP8@cluster0.be1wphn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const client = new MongoClient(uri);

let occupationsCollection, usersCollection, configCollection;

async function connectDB() {
  await client.connect();
  const db = client.db("ADMigartions");
  occupationsCollection = db.collection("Occupations");
  usersCollection = db.collection("Users");
  configCollection = db.collection("Config");
  console.log("✅ Connected to MongoDB Atlas");
}

// ========================================================================
// BASIC TEST ROUTE
// ========================================================================
app.get("/", (req, res) => res.send("🌍 Eibeyon Server Running 🚀"));

// ========================================================================
// 🧩 AUTH ROUTES
// ========================================================================
app.post("/api/register", async (req, res) => {
  try {
    const { fullName, email, mobile, password } = req.body;
    if (!fullName || !email || !mobile || !password)
      return res.status(400).json({ message: "All fields are required." });

    const existing = await usersCollection.findOne({ email });
    if (existing)
      return res.status(409).json({ message: "Email already registered." });

    const newUser = { fullName, email, mobile, password, createdAt: new Date() };
    await usersCollection.insertOne(newUser);
    res.json({ success: true, message: "Registration successful!" });
  } catch (err) {
    console.error("❌ Register error:", err);
    res.status(500).json({ message: "Server error during registration." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Email and password are required." });

    const user = await usersCollection.findOne({ email });
    if (!user) return res.status(404).json({ message: "User not found." });
    if (user.password !== password)
      return res.status(401).json({ message: "Incorrect password." });

    res.json({ success: true, message: "Login successful!", user });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ message: "Server error during login." });
  }
});

// ========================================================================
// 🧩 CONFIG ROUTES
// ========================================================================
app.get("/api/config", async (req, res) => {
  try {
    const all = await configCollection.find({}).project({ _id: 0 }).toArray();
    res.json(all);
  } catch (err) {
    console.error("❌ Config fetch error:", err);
    res.status(500).json({ error: "Server error while fetching config" });
  }
});

// ========================================================================
// 🧩 AUTOCOMPLETE SUGGESTIONS (title/code contains `q`)
// ========================================================================
app.get("/api/occupations/suggest", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  const regex = new RegExp(q, "i"); // substring match
  const data = await occupationsCollection
    .find({ $or: [{ title: regex }, { anzsco_code: regex }] })
    .project({ _id: 0, anzsco_code: 1, title: 1 })
    .limit(20)
    .toArray();
  res.json(data);
});

// ========================================================================
// 🧩 NORMAL SEARCH (single occupation)
// ========================================================================
app.get("/api/occupations/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Missing query parameter" });

    const regex = new RegExp(q, "i");
    const occupation = await occupationsCollection.findOne({
      $or: [{ anzsco_code: regex }, { title: regex }],
    });

    if (!occupation)
      return res.status(404).json({ error: "Occupation not found" });

    const { _id, ...data } = occupation;
    res.json(data);
  } catch (err) {
    console.error("❌ Occupation search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================================
// 🧩 ADMIN CRUD
// ========================================================================

// ➕ CREATE
app.post("/api/occupations", async (req, res) => {
  try {
    const data = req.body;
    if (!data.anzsco_code || !data.title) {
      return res.status(400).json({ success: false, message: "ANZSCO code and title required." });
    }
    const existing = await occupationsCollection.findOne({ anzsco_code: data.anzsco_code });
    if (existing)
      return res.status(409).json({ success: false, message: "Occupation with this code already exists." });

    await occupationsCollection.insertOne({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    res.json({ success: true, message: "Occupation created successfully." });
  } catch (err) {
    console.error("❌ Error creating occupation:", err);
    res.status(500).json({ success: false, message: "Server error while creating occupation." });
  }
});

// ✏️ UPDATE (partial OK)
app.put("/api/occupations/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const update = req.body;
    const result = await occupationsCollection.updateOne(
      { anzsco_code: code },
      { $set: { ...update, updatedAt: new Date() } }
    );
    if (result.matchedCount === 0)
      return res.status(404).json({ success: false, message: "Occupation not found." });

    res.json({ success: true, message: "Occupation updated successfully." });
  } catch (err) {
    console.error("❌ Error updating occupation:", err);
    res.status(500).json({ success: false, message: "Server error while updating occupation." });
  }
});

// 🗑 DELETE
app.delete("/api/occupations/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const result = await occupationsCollection.deleteOne({ anzsco_code: code });
    if (result.deletedCount === 0)
      return res.status(404).json({ success: false, message: "Occupation not found." });

    res.json({ success: true, message: "Occupation deleted successfully." });
  } catch (err) {
    console.error("❌ Error deleting occupation:", err);
    res.status(500).json({ success: false, message: "Server error while deleting occupation." });
  }
});

// 📋 PAGINATED LIST for Admin table
// GET /api/occupations?q=&page=1&limit=10
app.get("/api/occupations", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1"), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10"), 1), 100);
    const q = (req.query.q || "").trim();

    const filter = q
      ? { $or: [{ title: new RegExp(q, "i") }, { anzsco_code: new RegExp(q, "i") }] }
      : {};

    const total = await occupationsCollection.countDocuments(filter);
    const items = await occupationsCollection
      .find(filter)
      .project({ _id: 0 })
      .sort({ title: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    res.json({
      items,
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Error fetching occupations:", err);
    res.status(500).json({ success: false, message: "Server error while fetching occupations." });
  }
});

// (Legacy) fetch all — keep if you still need it
app.get("/api/occupations/all", async (req, res) => {
  try {
    const all = await occupationsCollection.find({}).project({ _id: 0 }).toArray();
    res.json(all);
  } catch (err) {
    console.error("❌ Error fetching occupations:", err);
    res.status(500).json({ success: false, message: "Server error while fetching occupations." });
  }
});

// 🧩 BULK IMPORT (optional but recommended)
app.post("/api/occupations/bulk", async (req, res) => {
  try {
    const occupations = req.body;
    if (!Array.isArray(occupations))
      return res.status(400).json({ success: false, message: "Expected array" });

    const ops = occupations.map(o => ({
      updateOne: {
        filter: { anzsco_code: o.anzsco_code },
        update: { $set: { ...o, updatedAt: new Date() } },
        upsert: true
      }
    }));

    await occupationsCollection.bulkWrite(ops);
    res.json({ success: true, message: "Bulk import completed successfully." });
  } catch (err) {
    console.error("❌ Bulk import error:", err);
    res.status(500).json({ success: false, message: "Server error during bulk import." });
  }
});


// ========================================================================
// 🚀 START SERVER
// ========================================================================
connectDB().then(() => {
  app.listen(port, () =>
    console.log(`🚀 Server running at http://localhost:${port}`)
  );
});
