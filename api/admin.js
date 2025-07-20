// api/admin.js
const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');
const supabase = require('../supabaseClient');

module.exports = function(wss) {
    const router = express.Router();

    // Basic Authentication Middleware
    const adminAuth = basicAuth({
        users: { [process.env.ADMIN_USER]: process.env.ADMIN_PASSWORD },
        challenge: true,
        realm: 'AdminArea',
    });

    // Serve the admin HTML page
    router.get('/', adminAuth, (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
    });

    // API to get initial chat history for the admin page
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
    
    // API for moderation actions
    router.post('/moderate', adminAuth, async (req, res) => {
        const { action, userId } = req.body;
        // Example: Mute a user. In a real app, you'd add a 'is_muted' column to your profiles table.
        console.log(`Admin action: ${action} on user ${userId}`);
        
        // const { error } = await supabase
        //     .from('profiles')
        //     .update({ is_muted: true }) // Example action
        //     .eq('id', userId);

        // if(error) return res.status(500).json({error: "Failed to moderate user."})

        res.status(200).json({ message: `Action '${action}' performed on user ${userId}.` });
    });


    return router;
};
