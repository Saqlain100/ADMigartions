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

// === Global collection references ===
let occupationsCollection, visasCollection, usersCollection, configCollection;

async function connectDB() {
  await client.connect();
  const db = client.db("ADMigartions");
  occupationsCollection = db.collection("Occupations");
  visasCollection = db.collection("Visas");
  usersCollection = db.collection("Users");
  configCollection = db.collection("Config");
  console.log("✅ Connected to MongoDB Atlas");
}

// ========================================================================
// BASIC TEST ROUTE
// ========================================================================
app.get("/", (req, res) => res.send("Server running 🚀"));

// ========================================================================
// 🧩 AUTH ROUTES (REGISTER + LOGIN)
// ========================================================================
app.post("/api/register", async (req, res) => {
  try {
    const { fullName, email, mobile, password } = req.body;
    if (!fullName || !email || !mobile || !password) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const existing = await usersCollection.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email already registered." });
    }

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
// 🧩 OCCUPATION SEARCH ROUTES
// ========================================================================
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

// ========================================================================
// 🧩 MULTISEARCH ROUTE — Dynamic visa list from DB
// ========================================================================
app.post("/api/multisearch", async (req, res) => {
  try {
    const { occupations } = req.body;
    if (!occupations || occupations.length === 0) {
      return res.status(400).json({ error: "No occupations provided" });
    }

    // === 1️⃣ Fetch selected occupations
    const occDocs = await occupationsCollection
      .find({ anzsco_code: { $in: occupations } })
      .project({ anzsco_code: 1, visas: 1 })
      .toArray();

    // Normalize occupation visa codes to strings
    occDocs.forEach((occ) => {
      occ.visas = (occ.visas || []).map((v) => String(v).trim());
    });

    // === 2️⃣ Fetch all visa codes dynamically from DB
    const allVisaDocs = await visasCollection
      .find({})
      .project({
        _id: 0,
        visa_code: 1,
        visa_name: 1,
        legislative_instrument: 1,
        occupation_list_type: 1,
      })
      .toArray();

    // Normalize all visa codes to strings
    allVisaDocs.forEach((v) => {
      v.visa_code = String(v.visa_code).trim();
    });

    // Combine all visa codes found in DB and in occupations
    const foundVisaCodes = [
      ...new Set(occDocs.flatMap((occ) => occ.visas || [])),
    ];
    const allVisaCodes = Array.from(
      new Set([...allVisaDocs.map((v) => v.visa_code), ...foundVisaCodes])
    );

    // === 3️⃣ Build the final eligibility matrix
    const matrix = allVisaCodes.map((code) => {
      const visa = allVisaDocs.find((v) => v.visa_code === code) || {};
      const row = {
        visa_code: code,
        visa_name: visa.visa_name || `Subclass ${code}`,
        legislative_instrument: visa.legislative_instrument || "",
        occupation_list_type: visa.occupation_list_type || "",
        eligibility: {},
      };

      occupations.forEach((anzsco) => {
        const occ = occDocs.find((o) => o.anzsco_code === anzsco);
        row.eligibility[anzsco] = occ?.visas
          ?.map((v) => String(v))
          .includes(String(code));
      });

      return row;
    });

    // Sort numerically by visa_code (189 → 190 → 482 ...)
    matrix.sort((a, b) => Number(a.visa_code) - Number(b.visa_code));

    res.json(matrix);
  } catch (err) {
    console.error("❌ Multisearch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================================
// 🧩 STATE SEARCH (Visa by region)
// ========================================================================
app.get("/api/state/:code", async (req, res) => {
  try {
    const { code } = req.params;
    const { q = "", page = 1, limit = 10 } = req.query;

    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 10, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const ALL_VISA_CODES = ["189", "190", "482", "491", "494", "186", "485", "407"];

    const visaDocs = await visasCollection
      .find({ visa_code: { $in: ALL_VISA_CODES } })
      .project({ _id: 0, visa_code: 1, visa_name: 1 })
      .toArray();

    const visas = ALL_VISA_CODES.map((v) => {
      const doc = visaDocs.find((d) => d.visa_code === v);
      return { visa_code: v, visa_name: doc?.visa_name || `Subclass ${v}` };
    });

    const queryFilter = {
      regions: code,
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
          visas: 1,
          regions: 1,
        })
        .skip(skip)
        .limit(limitNum)
        .toArray(),
      occupationsCollection.countDocuments(queryFilter),
    ]);

    const rows = occupations.map((occ) => {
      const row = {
        anzsco_code: occ.anzsco_code,
        name: occ.title,
      };
      ALL_VISA_CODES.forEach((visaCode) => {
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
// 🧩 TASK SEARCH
// ========================================================================
app.get("/api/task/search", async (req, res) => {
  try {
    const { q = "", page = 1, limit = 10 } = req.query;
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit) || 10, 1), 50);
    const skip = (pageNum - 1) * limitNum;

    const query = q.trim().length > 0 ? { $text: { $search: q } } : {};

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

    res.json({ total, page: pageNum, limit: limitNum, results });
  } catch (err) {
    console.error("❌ Task search error:", err);
    res.status(500).json({ error: "Server error" });
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

app.get("/api/config/:key", async (req, res) => {
  try {
    const key = req.params.key;
    const config = await configCollection.findOne(
      { key },
      { projection: { _id: 0, value: 1 } }
    );
    if (!config) return res.status(404).json({ error: "Config not found" });
    res.json(config.value);
  } catch (err) {
    console.error("❌ Config key fetch error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================================
// 🧩 VISA KEYS FROM CONFIG (optional)
// ========================================================================
app.get("/api/config/visa_keys/:subclass", async (req, res) => {
  try {
    const { subclass } = req.params;
    const configDoc = await configCollection.findOne(
      { visa_keys: { $exists: true } },
      { projection: { _id: 0, visa_keys: 1 } }
    );

    if (!configDoc || !Array.isArray(configDoc.visa_keys)) {
      return res.status(404).json({ error: "Visa keys not found in config" });
    }

    const visa = configDoc.visa_keys.find(
      (v) => String(v.subclass) === String(subclass)
    );

    if (!visa) {
      return res
        .status(404)
        .json({ error: `Visa subclass ${subclass} not found in visa_keys` });
    }

    res.status(200).json(visa);
  } catch (err) {
    console.error("❌ Error fetching visa from config:", err);
    res.status(500).json({ error: "Server error while fetching visa details" });
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
