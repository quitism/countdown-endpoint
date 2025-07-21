// server.js
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const adminRoutes = require('./api/admin');
const supabase = require('./supabaseClient');

// Serve frontend & admin UI
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', adminRoutes(wss));

// Broadcast helpers
function broadcast(data) {
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data));
  });
}
function broadcastViewerCount() {
  broadcast({ type: 'viewer_count', count: wss.clients.size });
}

// On new WS connection
const clients = new Map();      // ws → { user }
const userCooldowns = new Map(); // userId → timestamp

wss.on('connection', (ws) => {
  console.log('Client connected');
  // Send initial viewer count
  ws.send(JSON.stringify({ type: 'viewer_count', count: wss.clients.size }));
  broadcastViewerCount();

  // Helper to load & send full chat history
  async function sendChatHistory() {
    try {
      const { data: rows, error } = await supabase
        .from('messages')
        .select(`
          content,
          timestamp:created_at,
          profiles ( id, username, is_admin )
        `)
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Transform rows into our payload shape
      const history = rows.map(r => ({
        username: r.profiles.username,
        is_admin: r.profiles.is_admin,
        content: r.content,
        timestamp: r.timestamp,
      }));
      ws.send(JSON.stringify({ type: 'chat_history', payload: history }));
    } catch (err) {
      console.error('Error fetching chat history:', err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to load chat history.'
      }));
    }
  }

  ws.on('message', async raw => {
    let data;
    try { data = JSON.parse(raw); }
    catch {
      return ws.send(JSON.stringify({
        type: 'auth_error',
        payload: { message: 'Invalid JSON' }
      }));
    }

    // ─── SIGNUP ───────────────────────────────────────────────
    if (data.type === 'signup') {
      const { username, password } = data.payload || {};
      if (!username || !password) {
        return ws.send(JSON.stringify({
          type: 'auth_error',
          payload: { message: 'Username and password required.' }
        }));
      }
      try {
        const { data: signData, error: signErr } = 
          await supabase.auth.signUp({
            email: `${username}@sytesn.netlify.app`,
            password
          });
        if (signErr) throw signErr;
        await supabase
          .from('profiles')
          .insert({ id: signData.user.id, username });
        ws.send(JSON.stringify({ type: 'signup_success' }));
      } catch (err) {
        console.error('WS signup error:', err);
        ws.send(JSON.stringify({
          type: 'auth_error',
          payload: { message: err.message || 'Signup failed' }
        }));
      }
      return;
    }

    // ─── LOGIN ────────────────────────────────────────────────
    if (data.type === 'login') {
      const { username, password } = data.payload || {};
      if (!username || !password) {
        return ws.send(JSON.stringify({
          type: 'auth_error',
          payload: { message: 'Username and password required.' }
        }));
      }
      try {
        const { data: loginData, error: loginErr } =
          await supabase.auth.signInWithPassword({
            email: `${username}@sytesn.netlify.app`,
            password
          });
        if (loginErr) throw loginErr;

        const token = loginData.session.access_token;
        // Lookup profile and cache it
        const { data: profileData, error: profErr } = await supabase
          .from('profiles')
          .select('id, username, is_admin')
          .eq('id', loginData.user.id)
          .single();
        if (profErr) throw profErr;
        clients.set(ws, { user: profileData });

        // Send login success + history
        ws.send(JSON.stringify({
          type: 'login_success',
          payload: { token }
        }));
        await sendChatHistory();
      } catch (err) {
        console.error('WS login error:', err);
        ws.send(JSON.stringify({
          type: 'auth_error',
          payload: { message: 'Invalid credentials.' }
        }));
      }
      return;
    }

    // ─── RE-AUTHENTICATE TOKEN ────────────────────────────────
    if (data.type === 'authenticate') {
      try {
        const { data: { user }, error: uErr } =
          await supabase.auth.getUser(data.token);
        if (uErr || !user) throw uErr || new Error('Invalid token');

        const { data: profileData, error: profErr } = await supabase
          .from('profiles')
          .select('id, username, is_admin')
          .eq('id', user.id)
          .single();
        if (profErr) throw profErr;
        clients.set(ws, { user: profileData });

        // Now that we know who they are, send the chat history
        await sendChatHistory();
      } catch (err) {
        console.error('Token auth failed:', err);
        ws.send(JSON.stringify({
          type: 'auth_error',
          payload: { message: 'Session expired, please log in again.' }
        }));
      }
      return;
    }

    // ─── CHAT MESSAGE ─────────────────────────────────────────
    if (data.type === 'chat_message') {
      const client = clients.get(ws);
      if (!client) {
        return ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated.' }));
      }

      const now = Date.now();
      const last = userCooldowns.get(client.user.id) || 0;
      if (now - last < 3000) {
        return ws.send(JSON.stringify({
          type: 'error',
          message: 'You are sending messages too quickly.'
        }));
      }

      let content = data.content.trim().slice(0, 100);
      if (!content) return;

      userCooldowns.set(client.user.id, now);

      // Persist
      await supabase.from('messages').insert({
        user_id: client.user.id,
        content
      });

      // Broadcast
      broadcast({
        type: 'chat_message',
        payload: {
          username: client.user.username,
          is_admin: client.user.is_admin,
          content,
          timestamp: new Date().toISOString()
        }
      });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    broadcastViewerCount();
  });
  ws.on('error', console.error);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
