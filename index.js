const express = require('express');
const app = express();
const viewers = require('./api/viewers');

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*'); // Allow all origins, change if needed
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');

    // Handle OPTIONS preflight
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204); // No Content
    }

    next();
});

app.use(express.json());
app.use('/api/viewers', viewers);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Viewer API running on port ${PORT}`);
});
