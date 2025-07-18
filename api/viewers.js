const express = require('express');
const router  = express.Router();

const sessions = new Map();

// Cleanup old sessions
function cleanupSessions() {
  const now = Date.now();
  for (const [id, lastSeen] of sessions) {
    if (now - lastSeen > 40_000) { sessions.delete(id) ; console.log("Cleaned up inactive session " + id) };
  }
}
setInterval(cleanupSessions, 15_000);

router.get('/', (req, res) => {
  cleanupSessions();
  console.log("Returned " + sessions.size)
  res.json({ count: sessions.size });
});

router.post('/', (req, res) => {
  const { action, sessionId } = req.body;

  if (!sessionId || !['join', 'heartbeat', 'leave'].includes(action)) {
    console.log("Invalid input");
    return res.status(400).json({ error: 'Invalid input' });
  }

  if (action === 'join' || action === 'heartbeat') {
    const isNew = !sessions.has(sessionId);
    sessions.set(sessionId, Date.now());
    if (isNew) {
      console.log("Session " + sessionId + " registered");
    }
  } else {
    console.log("Session " + sessionId + " removed");
    sessions.delete(sessionId);
  }

  cleanupSessions();
  res.json({ count: sessions.size });
});


module.exports = router;
