// api/auth.js
const express = require('express');
const router = express.Router();
const supabase = require('../supabaseClient');

// Add the express.json() middleware here to parse request bodies
router.use(express.json());

// Signup Endpoint
router.post('/signup', async (req, res) => {
    // This check is important to prevent the 'destructure' error if body is empty
    if (!req.body) {
        return res.status(400).json({ error: 'Request body is missing.' });
    }
    const { username, password } = req.body;

    if (!username || !password || username.length > 16) {
        return res.status(400).json({ error: 'Username (max 16 chars) and password are required.' });
    }

    try {
        // Check if username is already taken
        const { data: existingProfile, error: profileError } = await supabase
            .from('profiles')
            .select('username')
            .eq('username', username)
            .single();

        if (existingProfile) {
            return res.status(400).json({ error: 'Username is already taken.' });
        }
        if (profileError && profileError.code !== 'PGRST116') { // Ignore "no rows found" error
            throw profileError;
        }

        // Create the user in Supabase Auth
        const { data: { user }, error: authError } = await supabase.auth.signUp({
            // We use the username as the email for simplicity, as email is required by Supabase Auth
            email: `${username}@sytesn.netlify.app`, 
            password: password,
        });

        if (authError) throw authError;

        // Create a corresponding profile in the 'profiles' table
        const { error: insertError } = await supabase
            .from('profiles')
            .insert({ id: user.id, username: username });

        if (insertError) throw insertError;

        res.status(201).json({ message: 'User created successfully.' });

    } catch (error) {
        console.error('Signup Error:', error);
        res.status(500).json({ error: error.message || 'An internal server error occurred.' });
    }
});

// Login Endpoint
router.post('/login', async (req, res) => {
    if (!req.body) {
        return res.status(400).json({ error: 'Request body is missing.' });
    }
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: `${username}@sytesn.netlify.app`,
            password: password,
        });

        if (error) throw error;

        res.status(200).json({ 
            message: 'Login successful', 
            access_token: data.session.access_token 
        });

    } catch (error)
    {
        console.error('Login Error:', error);
        res.status(401).json({ error: 'Invalid credentials.' });
    }
});

module.exports = router;
