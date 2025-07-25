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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/admin', adminRoutes(wss));

function broadcast(data) {
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data));
  });
}
function broadcastViewerCount() {
  broadcast({ type: 'viewer_count', count: wss.clients.size });
}

const clients = new Map();      
const userCooldowns = new Map();

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.send(JSON.stringify({ type: 'viewer_count', count: wss.clients.size }));
  broadcastViewerCount();
	
	async function sendChatHistory() {
	  try {
		const { data: rows, error: messagesError } = await supabase
		  .from('messages')
		  .select(`
			id,
			content,
			timestamp:created_at,
			profiles ( id, username, is_admin ),
			replying_to_id
		  `)
		  .order('created_at', { ascending: true });

		if (messagesError) {
		  console.error('Error fetching messages:', messagesError);
		  throw messagesError;
		}

		const uniqueReplyingToIds = new Set();
		rows.forEach(row => {
		  if (row.replying_to_id) {
			uniqueReplyingToIds.add(row.replying_to_id);
		  }
		});

		let repliedMessagesMap = new Map();
		if (uniqueReplyingToIds.size > 0) {
		  const { data: repliedMessages, error: repliedMessagesError } = await supabase
			.from('messages')
			.select('id, content, profiles ( username )')
			.in('id', Array.from(uniqueReplyingToIds));

		  if (repliedMessagesError) {
			console.error('Error fetching replied messages:', repliedMessagesError);
		  } else {
			repliedMessages.forEach(msg => {
			  if (msg.profiles) {
				repliedMessagesMap.set(msg.id, {
				  content: msg.content,
				  username: msg.profiles.username
				});
			  }
			});
		  }
		}
		const history = rows.map(r => {
		  const replyingToData = r.replying_to_id ? repliedMessagesMap.get(r.replying_to_id) : null;

		  return {
			id: r.id,
			username: r.profiles ? r.profiles.username : 'Unknown User',
			is_admin: r.profiles ? r.profiles.is_admin : false,
			content: r.content,
			timestamp: r.timestamp,
			replying_to: replyingToData // This will be null if no reply or if not found in map
		  };
		});

		ws.send(JSON.stringify({ type: 'chat_history', payload: history }));
		console.log('Chat history sent via WebSocket.');

	  } catch (err) {
		console.error('Error fetching or sending chat history:', err);
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

        const { data: profileData, error: profErr } = await supabase
          .from('profiles')
          .select('id, username, is_admin')
          .eq('id', loginData.user.id)
          .single();
        if (profErr) throw profErr;
        clients.set(ws, { user: profileData });

        ws.send(JSON.stringify({
          type: 'login_success',
          payload: { token, user: profileData }
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

        ws.send(JSON.stringify({
          type: 'login_success',
          payload: { token: data.token, user: profileData }
        }));
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

      const { payload, replying_to_id } = data;
      const content = payload ? payload.content : undefined;

      if (!content) return;

      userCooldowns.set(client.user.id, now);

      const { data: message, error } = await supabase.from('messages').insert({
        user_id: client.user.id,
        content: content.trim().slice(0, 500),
        replying_to_id
      }).select('*, profiles (id, username, is_admin)').single();

      if (error) {
        console.error('Error sending message:', error);
        return ws.send(JSON.stringify({ type: 'error', message: 'Failed to send message.' }));
      }
	    
      let replyingToData = null;
      if (replying_to_id) {
        const { data: repliedMsg, error: repliedMsgErr } = await supabase
          .from('messages')
          .select('content, profiles ( username )')
          .eq('id', replying_to_id)
          .single();

        if (repliedMsgErr) {
          console.error("Error fetching replied-to message:", repliedMsgErr);
        } else {
          replyingToData = {
            content: repliedMsg.content,
            username: repliedMsg.profiles ? repliedMsg.profiles.username : 'Unknown User'
          };
        }
      }

      const mentionRegex = /@([a-zA-Z0-9_]+)/g;
      let match;
      const mentionedUsernames = new Set();
      while ((match = mentionRegex.exec(message.content)) !== null) {
        mentionedUsernames.add(match[1]);
      }

      if (mentionedUsernames.size > 0) {
        const { data: mentionedProfiles, error: profilesError } = await supabase
          .from('profiles')
          .select('id, username')
          .in('username', Array.from(mentionedUsernames));

        if (profilesError) {
          console.error('Error fetching mentioned profiles:', profilesError);
        } else if (mentionedProfiles.length > 0) {
          const notificationsToInsert = mentionedProfiles.map(profile => ({
            recipient_user_id: profile.id,
            message_id: message.id,
            is_read: false
          }));
          const { error: notificationsError } = await supabase
            .from('notifications')
            .insert(notificationsToInsert);

          if (notificationsError) {
            console.error('Error inserting notifications:', notificationsError);
          }
        }
      }

      broadcast({
        type: 'chat_message',
        payload: {
          id: message.id,
          username: message.profiles.username,
          is_admin: message.profiles.is_admin,
          content: message.content,
          timestamp: message.created_at,
          replying_to: replyingToData
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
  console.log(`Server listening on port ${PORT}`);
});
