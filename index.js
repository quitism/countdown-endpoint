const express = require('express');
const app = express();
const viewers = require('./api/viewers');

app.use(express.json());
app.use('/api/viewers', viewers);

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Viewer API running on port ${PORT}`);
});
