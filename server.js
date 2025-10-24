// === server.js ===
const express = require("express");
const cors = require("cors");
const { MongoClient } = require("mongodb");

const app = express();
const port = 8080;

// === Middleware ===
app.use(cors({ origin: "*" }));
app.use(express.json());

// === MongoDB Connection ===
const uri =
  "mongodb+srv://saqlainmubarik10_db_user:MLjYzAAndgMb1FP8@cluster0.be1wphn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

const client = new MongoClient(uri);
let occupationsCollection, visasCollection, usersCollection;

async function connectDB() {
  await client.connect();
  const db = client.db("ADMigartions"); // ✅ make sure spelling matches your Atlas DB name
  occupationsCollection = db.collection("Occupations");
  visasCollection = db.collection("Visas");
  usersCollection = db.collection("Users");
  console.log("✅ Connected to MongoDB Atlas");
}

// === BASIC TEST ROUTE ===
app.get("/", (req, res) => res.send("Server running 🚀"));

// ========================================================================
// 🧩 AUTH ROUTES (REGISTER + LOGIN)
// ========================================================================

// === REGISTER ===
app.post("/api/register", async (req, res) => {
  try {
    const { fullName, email, mobile, password } = req.body;

    if (!fullName || !email || !mobile || !password) {
      return res
        .status(400)
        .json({ success: false, message: "All fields are required." });
    }

    const existing = await usersCollection.findOne({ email });
    if (existing) {
      return res
        .status(409)
        .json({ success: false, message: "Email already registered." });
    }

    const newUser = {
      fullName,
      email,
      mobile,
      password, // ⚠️ plain for now — for production use bcrypt
      createdAt: new Date(),
    };

    await usersCollection.insertOne(newUser);
    res.json({ success: true, message: "Registration successful!" });
  } catch (err) {
    console.error("❌ Register error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during registration." });
  }
});

// === LOGIN ===
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ success: false, message: "Email and password are required." });
    }

    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found. Please register first." });
    }

    if (user.password !== password) {
      return res
        .status(401)
        .json({ success: false, message: "Incorrect password." });
    }

    res.json({ success: true, message: "Login successful!", user });
  } catch (err) {
    console.error("❌ Login error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error during login." });
  }
});

// ========================================================================
// 🧩 OCCUPATION SEARCH ROUTES
// ========================================================================

// Search occupations by text/code
app.get("/api/occupations/search", async (req, res) => {
  const { q } = req.query;
  try {
    const query = {
      $or: [
        { title: { $regex: q, $options: "i" } },
        { anzsco_code: { $regex: q, $options: "i" } },
      ],
    };
    const data = await occupationsCollection
      .find(query)
      .project({ anzsco_code: 1, title: 1, skill_level: 1, _id: 0 })
      .limit(20)
      .toArray();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

// === MULTISEARCH ===
app.post("/api/multisearch", async (req, res) => {
  try {
    const { occupations } = req.body;
    if (!occupations || occupations.length === 0) {
      return res.status(400).json({ error: "No occupations provided" });
    }

    // Fetch occupations (and their visa arrays)
    const occDocs = await occupationsCollection
      .find({ anzsco_code: { $in: occupations } })
      .project({ anzsco_code: 1, visas: 1 })
      .toArray();

    // Collect all unique visa codes
    const visaCodes = [
      ...new Set(occDocs.flatMap((occ) => occ.visas || [])),
    ];

    // Fetch visa documents for those codes
    const visas = await visasCollection
      .find({ visa_code: { $in: visaCodes } })
      .project({
        _id: 0,
        visa_code: 1,
        visa_name: 1,
        legislative_instrument: 1,
        occupation_list_type: 1,
      })
      .toArray();

    // Build matrix
    const matrix = visas.map((visa) => {
      const row = {
        visa_code: visa.visa_code,
        visa_name: visa.visa_name,
        legislative_instrument: visa.legislative_instrument,
        occupation_list_type: visa.occupation_list_type,
        eligibility: {},
      };
      occupations.forEach((code) => {
        const occ = occDocs.find((o) => o.anzsco_code === code);
        row.eligibility[code] = occ?.visas?.includes(visa.visa_code) || false;
      });
      return row;
    });

    res.json(matrix);
  } catch (err) {
    console.error("❌ Multisearch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================================
// 🧩 STATIC PAGE BY SUBCLASS
// ========================================================================
app.get("/api/visas/:subclass", async (req, res) => {
  try {
    const subclass = req.params.subclass;
    const page = await client
      .db("ADMigartions")
      .collection("StaticPages")
      .findOne({ subclass }, { projection: { _id: 0 } });

    if (!page) return res.status(404).json({ error: "Visa page not found" });

    res.json(page);
  } catch (err) {
    console.error("❌ Error fetching static page:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================================
// 🧩 STATE SEARCH (Show all visa types, mark eligibility by region)
// ========================================================================
// === STATE SEARCH (Show ALL visa types; ✔/✖ depends on region) ===
// === STATE SEARCH (Show all visa columns, only occupations belonging to the region) ===
app.get("/api/state/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const { q = "", page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    // 🧱 Always show these visa subclasses as columns
    const ALL_VISA_CODES = ["189", "190", "482", "491", "494", "186", "485", "407"];

    // === Step 1: Fetch visa metadata (for header display)
    const visaDocs = await visasCollection
      .find({ visa_code: { $in: ALL_VISA_CODES } })
      .project({ _id: 0, visa_code: 1, visa_name: 1 })
      .toArray();

    const visas = ALL_VISA_CODES.map((v) => {
      const doc = visaDocs.find((d) => d.visa_code === v);
      return { visa_code: v, visa_name: doc?.visa_name || `Subclass ${v}` };
    });

    // === Step 2: Occupation query (only those tagged for this region)
    const queryFilter = {
      regions: code, // strictly belongs to this region
      ...(q
        ? {
            $or: [
              { title: { $regex: q, $options: "i" } },
              { anzsco_code: { $regex: q, $options: "i" } },
            ],
          }
        : {}),
    };

    const [occupations, total] = await Promise.all([
      occupationsCollection
        .find(queryFilter)
        .project({
          _id: 0,
          anzsco_code: 1,
          title: 1,
          visas: 1, // we’ll use this for ✔ and ✖
          regions: 1,
        })
        .skip(skip)
        .limit(limitNum)
        .toArray(),
      occupationsCollection.countDocuments(queryFilter),
    ]);

    // === Step 3: Build table rows
    const rows = occupations.map((occ) => {
      const row = {
        anzsco_code: occ.anzsco_code,
        name: occ.title,
      };

      ALL_VISA_CODES.forEach((visaCode) => {
        // ✔ if this occupation includes that visa *and* region matches
        const eligible =
          (occ.visas || []).includes(visaCode) &&
          (occ.regions || []).includes(code);

        row[`Subclass ${visaCode}`] = !!eligible;
      });

      return row;
    });

    res.json({
      region: code,
      total,
      page: pageNum,
      limit: limitNum,
      visas,
      rows,
    });
  } catch (err) {
    console.error("❌ State search error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================================
// 🧩 TASK SEARCH (Full-text search)
// ========================================================================
app.get("/api/task/search", async (req, res) => {
  try {
    const { q = "", page = 1, limit = 10 } = req.query;
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 10, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const query =
      q.trim().length > 0 ? { $text: { $search: q } } : {};

    const total = await occupationsCollection.countDocuments(query);

    const results = await occupationsCollection
      .find(query, q ? { score: { $meta: "textScore" } } : {})
      .project({
        _id: 0,
        anzsco_code: 1,
        title: 1,
        description: 1,
        assessment_authorities: 1,
        unit_group: 1,
        major_group: 1,
        visas: 1,
        regions: 1,
        score: q ? { $meta: "textScore" } : undefined,
      })
      .sort(q ? { score: { $meta: "textScore" } } : { title: 1 })
      .skip(skip)
      .limit(limitNum)
      .toArray();

    res.json({
      total,
      page: pageNum,
      limit: limitNum,
      results,
    });
  } catch (err) {
    console.error("❌ Task search error:", err);
    res.status(500).json({ error: "Server error" });
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
