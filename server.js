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

let occupationsCollection,
  usersCollection,
  configCollection,
  stateCollection,
  damaCollection;

async function connectDB() {
  await client.connect();
  const db = client.db("ADMigartions");

  occupationsCollection = db.collection("Occupations");
  usersCollection = db.collection("Users");
  configCollection = db.collection("Config");

  // NEW COLLECTIONS
  stateCollection = db.collection("State");
  damaCollection = db.collection("DAMA");

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

    const newUser = {
      fullName,
      email,
      mobile,
      password,
      createdAt: new Date(),
    };
    await usersCollection.insertOne(newUser);

    res.json({ success: true, message: "Registration successful!" });
  } catch (err) {
    console.error("❌ Register error:", err);
    res.status(500).json({ message: "Server error during registration." });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res
        .status(400)
        .json({ message: "Email and password are required." });

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
// CONFIG ROUTES
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
// AUTOCOMPLETE FOR OCCUPATIONS
// ========================================================================
app.get("/api/occupations/suggest", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);

  const regex = new RegExp(q, "i");
  const data = await occupationsCollection
    .find({ $or: [{ title: regex }, { anzsco_code: regex }] })
    .project({ _id: 0, anzsco_code: 1, title: 1 })
    .limit(20)
    .toArray();

  res.json(data);
});

// ========================================================================
// SEARCH SINGLE OCCUPATION
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

    const { _id, ...rest } = occupation;
    res.json(rest);
  } catch (err) {
    console.error("❌ Occupation search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================================
// OCCUPATIONS ADMIN CRUD
// ========================================================================

// ➕ CREATE OCCUPATION
app.post("/api/occupations", async (req, res) => {
  try {
    const data = req.body;

    if (!data.anzsco_code || !data.title)
      return res.status(400).json({
        success: false,
        message: "ANZSCO code and title required.",
      });

    const exists = await occupationsCollection.findOne({
      anzsco_code: data.anzsco_code,
    });

    if (exists)
      return res.status(409).json({
        success: false,
        message: "Occupation with this code already exists.",
      });

    await occupationsCollection.insertOne({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({ success: true, message: "Occupation created successfully." });
  } catch (err) {
    console.error("❌ Create occupation error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✏️ UPDATE OCCUPATION
app.put("/api/occupations/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const update = req.body;

    const result = await occupationsCollection.updateOne(
      { anzsco_code: code },
      { $set: { ...update, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Occupation not found." });

    res.json({ success: true, message: "Occupation updated successfully." });
  } catch (err) {
    console.error("❌ Update occupation error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🗑 DELETE OCCUPATION
app.delete("/api/occupations/:code", async (req, res) => {
  try {
    const result = await occupationsCollection.deleteOne({
      anzsco_code: req.params.code,
    });

    if (result.deletedCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Occupation not found." });

    res.json({ success: true, message: "Occupation deleted." });
  } catch (err) {
    console.error("❌ Delete occupation error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 📋 PAGINATION + SEARCH
app.get("/api/occupations", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1"), 1);
    const limit = Math.min(parseInt(req.query.limit || "10"), 100);
    const q = (req.query.q || "").trim();

    const filter = q
      ? {
          $or: [
            { title: new RegExp(q, "i") },
            { anzsco_code: new RegExp(q, "i") },
          ],
        }
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
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ Fetch occupations error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Get ALL occupations
app.get("/api/occupations/all", async (req, res) => {
  const all = await occupationsCollection
    .find({})
    .project({ _id: 0 })
    .toArray();
  res.json(all);
});

// ========================================================================
// 🗺️ STATE MIGRATION CRUD + FILTERS
// ========================================================================

// ➕ CREATE state row (legacy single create)
app.post("/api/state", async (req, res) => {
  try {
    const data = req.body;

    if (!data.state || !data.anzsco_code)
      return res.status(400).json({
        success: false,
        message: "State & ANZSCO code required.",
      });

    const exists = await stateCollection.findOne({
      state: data.state,
      anzsco_code: String(data.anzsco_code),
    });

    if (exists)
      return res.status(409).json({
        success: false,
        message: "State migration entry already exists.",
      });

    await stateCollection.insertOne({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({ success: true, message: "State migration entry created." });
  } catch (err) {
    console.error("❌ State create error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✏️ UPDATE (legacy)
app.put("/api/state/update", async (req, res) => {
  try {
    const data = req.body;

    const result = await stateCollection.updateOne(
      { state: data.state, anzsco_code: String(data.anzsco_code) },
      { $set: { ...data, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Entry not found." });

    res.json({ success: true, message: "State migration updated." });
  } catch (err) {
    console.error("❌ State update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🗑 DELETE
app.delete("/api/state/:state/:code", async (req, res) => {
  try {
    const result = await stateCollection.deleteOne({
      state: req.params.state,
      anzsco_code: req.params.code,
    });

    if (result.deletedCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Entry not found." });

    res.json({ success: true, message: "State migration deleted." });
  } catch (err) {
    console.error("❌ State delete error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PAGINATION + SEARCH + FILTERS
// GET /api/state?q=&page=1&limit=10&state=&anzsco_code=&subclass_190=&subclass_491=
app.get("/api/state", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1"), 1);
    const limit = Math.min(parseInt(req.query.limit || "10"), 100);

    const q = (req.query.q || "").trim();
    const { state, anzsco_code, subclass_190, subclass_491 } = req.query;

    const filter = {};

    if (q) {
      filter.$or = [
        { state: new RegExp(q, "i") },
        { anzsco_name: new RegExp(q, "i") },
        { anzsco_code: new RegExp(q, "i") },
      ];
    }

    if (state) filter.state = state;
    if (anzsco_code) filter.anzsco_code = anzsco_code;
    if (subclass_190) filter.subclass_190 = subclass_190;
    if (subclass_491) filter.subclass_491 = subclass_491;

    const total = await stateCollection.countDocuments(filter);
    const items = await stateCollection
      .find(filter)
      .project({ _id: 0 })
      .sort({ state: 1, anzsco_code: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    res.json({
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ State fetch error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ALL
app.get("/api/state/all", async (req, res) => {
  const all = await stateCollection.find({}).project({ _id: 0 }).toArray();
  res.json(all);
});

// BULK (still available; not used by UI now)
app.post("/api/state/bulk", async (req, res) => {
  try {
    const rows = req.body;

    const ops = rows.map((r) => ({
      updateOne: {
        filter: { state: r.state, anzsco_code: String(r.anzsco_code) },
        update: { $set: { ...r, updatedAt: new Date() } },
        upsert: true,
      },
    }));

    await stateCollection.bulkWrite(ops);

    res.json({ success: true, message: "State bulk import complete." });
  } catch (err) {
    console.error("❌ State bulk import error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// DISTINCT FILTER VALUES FOR STATE
// GET /api/state/filters
app.get("/api/state/filters", async (req, res) => {
  try {
    const clean = (arr) =>
      (arr || [])
        .filter(
          (v) =>
            v !== null &&
            v !== undefined &&
            String(v).trim() !== "" &&
            String(v).trim().toLowerCase() !== "n/a"
        )
        .map((v) => String(v).trim())
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort();

    const states = clean(await stateCollection.distinct("state"));
    const anzscoCodes = clean(await stateCollection.distinct("anzsco_code"));
    const s190 = clean(await stateCollection.distinct("subclass_190"));
    const s491 = clean(await stateCollection.distinct("subclass_491"));

    res.json({
      states,
      anzscoCodes,
      subclass190Values: s190,
      subclass491Values: s491,
    });
  } catch (err) {
    console.error("❌ /api/state/filters error:", err);
    res.status(500).json({
      success: false,
      message: "Server error while fetching state filter values.",
    });
  }
});

// ===============================
// STATE: ROW-BY-ROW UPSERT IMPORT
// POST /api/state/upsert-row
// ===============================
app.post("/api/state/upsert-row", async (req, res) => {
  try {
    const body = req.body || {};

    // Normalize fields
    const state = (body.state || "").toString().trim();
    const anzsco_code = (body.anzsco_code || "").toString().trim();

    if (!state || !anzsco_code) {
      return res.status(400).json({
        success: false,
        message: "state and anzsco_code are required for import.",
      });
    }

    const doc = {
      state,
      anzsco_code,
      anzsco_name: body.anzsco_name || "",
      subclass_190: body.subclass_190 ?? "",
      subclass_491: body.subclass_491 ?? "",
      updatedAt: new Date(),
    };

    const result = await stateCollection.updateOne(
      { state, anzsco_code },
      {
        $set: doc,
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true }
    );

    const isInsert = result.upsertedCount && result.upsertedCount > 0;

    return res.json({
      success: true,
      mode: isInsert ? "insert" : "update",
      message: isInsert ? "State row inserted." : "State row updated.",
    });
  } catch (err) {
    console.error("❌ /api/state/upsert-row error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while importing a state row.",
    });
  }
});

// ========================================================================
// 🗺️ DAMA CRUD (unchanged from your working version, including row-by-row)
// ========================================================================

// ➕ CREATE
app.post("/api/dama", async (req, res) => {
  try {
    const data = req.body;

    if (!data.region || !data.anzsco)
      return res.status(400).json({
        success: false,
        message: "Region & ANZSCO code required.",
      });

    const exists = await damaCollection.findOne({
      region: data.region,
      anzsco: String(data.anzsco),
    });

    if (exists)
      return res.status(409).json({
        success: false,
        message: "DAMA entry already exists.",
      });

    await damaCollection.insertOne({
      ...data,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    res.json({ success: true, message: "DAMA entry created." });
  } catch (err) {
    console.error("❌ DAMA create error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✏️ UPDATE
app.put("/api/dama/update", async (req, res) => {
  try {
    const data = req.body;

    const result = await damaCollection.updateOne(
      { region: data.region, anzsco: String(data.anzsco) },
      { $set: { ...data, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "DAMA entry not found." });

    res.json({ success: true, message: "DAMA updated." });
  } catch (err) {
    console.error("❌ DAMA update error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🗑 DELETE
app.delete("/api/dama/:region/:anzsco", async (req, res) => {
  try {
    const result = await damaCollection.deleteOne({
      region: req.params.region,
      anzsco: req.params.anzsco,
    });

    if (result.deletedCount === 0)
      return res
        .status(404)
        .json({ success: false, message: "Entry not found." });

    res.json({ success: true, message: "DAMA entry deleted." });
  } catch (err) {
    console.error("❌ DAMA delete error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// PAGINATION (DAMA)
app.get("/api/dama", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page || "1"), 1);
    const limit = Math.min(parseInt(req.query.limit || "10"), 100);
    const q = (req.query.q || "").trim();

    const filter = q
      ? {
          $or: [
            { region: new RegExp(q, "i") },
            { name: new RegExp(q, "i") },
            { anzsco: new RegExp(q, "i") },
          ],
        }
      : {};

    const total = await damaCollection.countDocuments(filter);

    const items = await damaCollection
      .find(filter)
      .project({ _id: 0 })
      .sort({ region: 1, anzsco: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .toArray();

    res.json({
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("❌ DAMA fetch error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ALL
app.get("/api/dama/all", async (req, res) => {
  const all = await damaCollection.find({}).project({ _id: 0 }).toArray();
  res.json(all);
});

// BULK (still kept, though UI uses row-by-row import)
app.post("/api/dama/bulk", async (req, res) => {
  try {
    const rows = req.body;

    const ops = rows.map((r) => ({
      updateOne: {
        filter: { region: r.region, anzsco: String(r.anzsco) },
        update: { $set: { ...r, updatedAt: new Date() } },
        upsert: true,
      },
    }));

    await damaCollection.bulkWrite(ops);

    res.json({ success: true, message: "DAMA bulk import complete." });
  } catch (err) {
    console.error("❌ DAMA bulk import error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ===========================================================
// DAMA DISTINCT FILTER VALUES
// GET /api/dama/distincts
// ===========================================================
app.get("/api/dama/distincts", async (req, res) => {
  try {
    const clean = (arr) =>
      (arr || [])
        .filter(
          (v) =>
            v !== null &&
            v !== undefined &&
            String(v).trim() !== "" &&
            String(v).trim().toLowerCase() !== "n/a"
        )
        .map((v) => String(v).trim())
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort();

    const regions = clean(await damaCollection.distinct("region"));
    const skill_levels = clean(await damaCollection.distinct("skill_level"));
    const english = clean(await damaCollection.distinct("english"));
    const pr_pathways = clean(await damaCollection.distinct("pr_pathway"));
    const ages = clean(await damaCollection.distinct("age"));
    const skills_experience = clean(
      await damaCollection.distinct("skills_experience")
    );
    const tsmit_csit = clean(await damaCollection.distinct("tsmit_csit"));

    res.json({
      regions,
      skill_levels,
      english,
      pr_pathways,
      ages,
      skills_experience,
      tsmit_csit,
    });
  } catch (err) {
    console.error("❌ /api/dama/distincts error:", err);
    res.status(500).json({
      success: false,
      message: "Server error fetching DAMA filter values.",
    });
  }
});


// ========================================================================
// START SERVER
// ========================================================================
connectDB().then(() => {
  app.listen(port, () =>
    console.log(`🚀 Server running at http://localhost:${port}`)
  );
});
