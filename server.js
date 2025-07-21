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

// Serve static frontend and Admin HTTP
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', adminRoutes(wss));

// Helpers to broadcast
function broadcast(data) {
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data));
  });
}

function broadcastViewerCount() {
  broadcast({ type: 'viewer_count', count: wss.clients.size });
}

// Map each ws to its authenticated user
const clients = new Map();
const userCooldowns = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');
  // send initial count
  ws.send(JSON.stringify({ type: 'viewer_count', count: wss.clients.size }));
  broadcastViewerCount();

  ws.on('message', async (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return ws.send(JSON.stringify({
        type: 'auth_error',
        payload: { message: 'Invalid JSON' }
      }));
    }

    // ─── SIGNUP ──────────────────────────────────────
    if (data.type === 'signup') {
      const { username, password } = data.payload || {};
      if (!username || !password) {
        return ws.send(JSON.stringify({
          type: 'auth_error',
          payload: { message: 'Username and password required.' }
        }));
      }

      try {
        // 1) Create user in Supabase Auth
        const { data: signData, error: signErr } = 
          await supabase.auth.signUp({
            email: `${username}@sytesn.netlify.app`,
            password
          });
        if (signErr) throw signErr;
        const user = signData.user;
        // 2) Insert profile row
        const { error: profileErr } = await supabase
          .from('profiles')
          .insert({ id: user.id, username });
        if (profileErr) throw profileErr;

        // 3) Success reply
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

    // ─── LOGIN ───────────────────────────────────────
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
        // Fetch user profile & attach to this ws
        const { data: profileData, error: profErr } = await supabase
          .from('profiles')
          .select('id, username, is_admin')
          .eq('id', loginData.user.id)
          .single();
        if (profErr) throw profErr;
        clients.set(ws, { user: profileData });

        ws.send(JSON.stringify({
          type: 'login_success',
          payload: { token }
        }));

      } catch (err) {
        console.error('WS login error:', err);
        ws.send(JSON.stringify({
          type: 'auth_error',
          payload: { message: 'Invalid credentials.' }
        }));
      }
      return;
    }

    // ─── AUTHENTICATE TOKEN ─────────────────────────
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
        console.log(`User ${profileData.username} re‑authenticated.`);
      } catch (err) {
        console.error('Token auth failed:', err);
        ws.send(JSON.stringify({
          type: 'auth_error',
          payload: { message: 'Session expired, please log in again.' }
        }));
      }
      return;
    }

    // ─── CHAT MESSAGE ───────────────────────────────
    if (data.type === 'chat_message') {
      const clientData = clients.get(ws);
      if (!clientData) {
        return ws.send(JSON.stringify({
          type: 'error',
          message: 'Not authenticated.'
        }));
      }

      const now = Date.now();
      const last = userCooldowns.get(clientData.user.id) || 0;
      if (now - last < 3000) {
        return ws.send(JSON.stringify({
          type: 'error',
          message: 'You are sending messages too quickly.'
        }));
      }

      let content = data.content.trim().slice(0, 100);
      if (!content) return;

      userCooldowns.set(clientData.user.id, now);

      // Persist
      await supabase.from('messages').insert({
        user_id: clientData.user.id,
        content
      });

      // Broadcast
      broadcast({
        type: 'chat_message',
        payload: {
          user_id: clientData.user.id,
          username: clientData.user.username,
          is_admin: clientData.user.is_admin,
          content,
          timestamp: new Date().toISOString()
        }
      });
    }

  }); // end on message

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
