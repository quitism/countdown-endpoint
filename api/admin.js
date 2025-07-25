// this is pretty much unmaintained and does nothing
const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');
const supabase = require('../supabaseClient');

module.exports = function(wss) {
    const router = express.Router();
    const adminAuth = basicAuth({
        users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASSWORD },
        challenge: true,
        realm: 'AdminArea',
    });

    router.get('/', adminAuth, (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
    });

    router.get('/chat-history', adminAuth, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('messages')
                .select(`
                    id,
                    created_at,
                    content,
                    profiles (id, username, is_admin)
                `)
                .order('created_at', { ascending: false })
                .limit(50);
            
            if (error) throw error;
            res.json(data.reverse());

        } catch (error) {
            console.error('Error fetching chat history:', error);
            res.status(500).json({ error: 'Failed to fetch chat history.' });
        }
    });

    router.post('/moderate', adminAuth, async (req, res) => {
        const { action, userId } = req.body;
        console.log(`Admin action: ${action} on user ${userId}`);
        res.status(200).json({ message: `Action '${action}' performed on user ${userId}.` });
    });


    return router;
};
