const express = require('express');
const router = express.Router();

const sessions = new Map();

function cleanupSessions() {
    const now = Date.now();
    for (const [sessionId, lastSeen] of sessions) {
        if (now - lastSeen > 90_000) {
            sessions.delete(sessionId);
        }
    }
}

// Auto-clean sessions every 30 seconds
setInterval(cleanupSessions, 30_000);

router.get('/', (req, res) => {
    cleanupSessions();
    res.json({ count: sessions.size });
});

router.post('/', (req, res) => {
    const { action, sessionId } = req.body;

    if (!sessionId || !['join', 'heartbeat', 'leave'].includes(action)) {
        return res.status(400).json({ error: 'Invalid input' });
    }

    if (action === 'join' || action === 'heartbeat') {
        sessions.set(sessionId, Date.now());
    } else if (action === 'leave') {
        sessions.delete(sessionId);
    }

    cleanupSessions();
    res.json({ count: sessions.size });
});

module.exports = router;
