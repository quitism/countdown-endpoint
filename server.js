// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const authRoutes = require('./api/auth');
const adminRoutes = require('./api/admin');
const supabase = require('./supabaseClient');

// --- Middleware ---
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve frontend files

// --- API Routes ---
app.use('/api/auth', authRoutes);
app.use('/admin', adminRoutes(wss)); // Pass WebSocket server to admin routes

// --- WebSocket Connection Handling ---
const clients = new Map(); // Stores client data (ws, user, etc.)
const userCooldowns = new Map(); // Stores user message timestamps

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
        }
    });
}

function broadcastViewerCount() {
    broadcast({ type: 'viewer_count', count: wss.clients.size });
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    
    // Send initial viewer count to the new client
    ws.send(JSON.stringify({ type: 'viewer_count', count: wss.clients.size }));
    // Broadcast updated count to all clients
    broadcastViewerCount();

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);

            // Associate user with WebSocket connection
            if (data.type === 'authenticate') {
                const { data: { user } } = await supabase.auth.getUser(data.token);
                if (user) {
                    const { data: profile } = await supabase
                        .from('profiles')
                        .select('id, username, is_admin')
                        .eq('id', user.id)
                        .single();
                    
                    if (profile) {
                        clients.set(ws, { user: profile });
                        console.log(`User ${profile.username} authenticated.`);
                    }
                }
            }
            
            // Handle chat messages
            if (data.type === 'chat_message') {
                const clientData = clients.get(ws);
                if (!clientData || !clientData.user) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated.' }));
                    return;
                }

                const { user } = clientData;
                const now = Date.now();
                const lastMessageTime = userCooldowns.get(user.id) || 0;

                // Enforce 3-second slow mode
                if (now - lastMessageTime < 3000) {
                    ws.send(JSON.stringify({ type: 'error', message: 'You are sending messages too quickly.' }));
                    return;
                }
                
                // Enforce 100-character limit
                const content = data.content.trim().slice(0, 100);
                if (!content) return;

                userCooldowns.set(user.id, now);

                const messageData = {
                    type: 'chat_message',
                    payload: {
                        user_id: user.id,
                        username: user.username,
                        is_admin: user.is_admin,
                        content: content,
                        timestamp: new Date().toISOString()
                    }
                };
                
                // Store message in database
                await supabase.from('messages').insert({
                    user_id: user.id,
                    content: content
                });

                broadcast(messageData);
            }

        } catch (err) {
            console.error('Failed to process message:', err);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clients.delete(ws);
        broadcastViewerCount();
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// --- Server Listening ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
