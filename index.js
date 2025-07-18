const express   = require('express');
const path      = require('path');
const viewers   = require('./api/viewers'); // your router file

const app = express();

// 1️⃣ CORS middleware at the root
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// 2️⃣ JSON body parser
app.use(express.json());

// 3️⃣ Mount your viewers router
app.use('/api/viewers', viewers);

// 4️⃣ (Optional) Serve your static frontend
//    make sure this comes *after* your API mount
app.use(express.static(path.join(__dirname, 'public')));

// 5️⃣ Fallback 404 for any other routes
app.use((req, res) => {
  res.status(404).send(`Route not found: ${req.method} ${req.originalUrl}`);
});

// 6️⃣ Listen on the port Koyeb sets
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
