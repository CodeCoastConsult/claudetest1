const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// Initialize SQLite database
const db = new Database('pto_buddy.db');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    can_donate BOOLEAN DEFAULT 0,
    need_support BOOLEAN DEFAULT 0,
    available_pto_hours INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS support_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    hours_needed INTEGER NOT NULL,
    hours_received INTEGER DEFAULT 0,
    urgency TEXT NOT NULL,
    category TEXT NOT NULL,
    reason TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS donations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    donor_id INTEGER NOT NULL,
    request_id INTEGER NOT NULL,
    hours INTEGER NOT NULL,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (donor_id) REFERENCES users(id),
    FOREIGN KEY (request_id) REFERENCES support_requests(id)
  );
`);

// ============== AUTH ROUTES ==============

// Register a new user
app.post('/api/register', async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone,
      username, password, canDonate, needSupport, ptoHours
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !phone || !username || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Check if user already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ? OR username = ?').get(email, username);
    if (existingUser) {
      return res.status(400).json({ error: 'User with this email or username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const stmt = db.prepare(`
      INSERT INTO users (first_name, last_name, email, phone, username, password, can_donate, need_support, available_pto_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      firstName, lastName, email, phone, username, hashedPassword,
      canDonate ? 1 : 0, needSupport ? 1 : 0, ptoHours || 0
    );

    // Return user data for auto-login
    const newUser = {
      id: result.lastInsertRowid,
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phone,
      username: username,
      can_donate: canDonate ? 1 : 0,
      need_support: needSupport ? 1 : 0,
      available_pto_hours: ptoHours || 0
    };

    res.status(201).json({
      message: 'Registration successful',
      user: newUser
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Return user info (excluding password)
    const { password: _, ...userWithoutPassword } = user;
    res.json({
      message: 'Login successful',
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get user profile
app.get('/api/users/:id', (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, first_name, last_name, email, phone, username, can_donate, need_support, available_pto_hours, created_at
      FROM users WHERE id = ?
    `).get(req.params.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// ============== SUPPORT REQUEST ROUTES ==============

// Create a support request
app.post('/api/requests', (req, res) => {
  try {
    const { userId, hoursNeeded, urgency, category, reason, startDate, endDate } = req.body;

    if (!userId || !hoursNeeded || !urgency || !category || !reason || !startDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const stmt = db.prepare(`
      INSERT INTO support_requests (user_id, hours_needed, urgency, category, reason, start_date, end_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(userId, hoursNeeded, urgency, category, reason, startDate, endDate || null);

    res.status(201).json({
      message: 'Support request created',
      requestId: result.lastInsertRowid
    });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

// Get all active support requests
app.get('/api/requests', (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT
        sr.*,
        u.first_name,
        u.last_name,
        (SELECT COALESCE(SUM(hours), 0) FROM donations WHERE request_id = sr.id) as hours_received
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      WHERE sr.status = 'active'
      ORDER BY
        CASE sr.urgency
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          ELSE 3
        END,
        sr.created_at DESC
    `).all();

    res.json(requests);
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ error: 'Failed to get requests' });
  }
});

// Get a single request
app.get('/api/requests/:id', (req, res) => {
  try {
    const request = db.prepare(`
      SELECT
        sr.*,
        u.first_name,
        u.last_name,
        (SELECT COALESCE(SUM(hours), 0) FROM donations WHERE request_id = sr.id) as hours_received
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      WHERE sr.id = ?
    `).get(req.params.id);

    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json(request);
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({ error: 'Failed to get request' });
  }
});

// Get requests by user
app.get('/api/users/:userId/requests', (req, res) => {
  try {
    const requests = db.prepare(`
      SELECT
        sr.*,
        (SELECT COALESCE(SUM(hours), 0) FROM donations WHERE request_id = sr.id) as hours_received
      FROM support_requests sr
      WHERE sr.user_id = ?
      ORDER BY sr.created_at DESC
    `).all(req.params.userId);

    res.json(requests);
  } catch (error) {
    console.error('Get user requests error:', error);
    res.status(500).json({ error: 'Failed to get requests' });
  }
});

// ============== DONATION ROUTES ==============

// Make a donation
app.post('/api/donations', (req, res) => {
  try {
    const { donorId, requestId, hours, message } = req.body;

    if (!donorId || !requestId || !hours) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if donor has enough PTO
    const donor = db.prepare('SELECT available_pto_hours FROM users WHERE id = ?').get(donorId);
    if (!donor || donor.available_pto_hours < hours) {
      return res.status(400).json({ error: 'Insufficient PTO hours available' });
    }

    // Check if request exists and is active
    const request = db.prepare('SELECT * FROM support_requests WHERE id = ? AND status = ?').get(requestId, 'active');
    if (!request) {
      return res.status(404).json({ error: 'Support request not found or closed' });
    }

    // Create donation
    const insertDonation = db.prepare(`
      INSERT INTO donations (donor_id, request_id, hours, message)
      VALUES (?, ?, ?, ?)
    `);

    // Update donor's available PTO
    const updateDonorPTO = db.prepare(`
      UPDATE users SET available_pto_hours = available_pto_hours - ? WHERE id = ?
    `);

    // Update request's received hours
    const updateRequestHours = db.prepare(`
      UPDATE support_requests SET hours_received = hours_received + ? WHERE id = ?
    `);

    // Run as transaction
    const transaction = db.transaction(() => {
      insertDonation.run(donorId, requestId, hours, message || null);
      updateDonorPTO.run(hours, donorId);
      updateRequestHours.run(hours, requestId);

      // Check if request is fully funded
      const updatedRequest = db.prepare('SELECT hours_needed, hours_received FROM support_requests WHERE id = ?').get(requestId);
      if (updatedRequest.hours_received >= updatedRequest.hours_needed) {
        db.prepare('UPDATE support_requests SET status = ? WHERE id = ?').run('fulfilled', requestId);
      }
    });

    transaction();

    res.status(201).json({ message: 'Donation successful' });
  } catch (error) {
    console.error('Donation error:', error);
    res.status(500).json({ error: 'Donation failed' });
  }
});

// Get donations by user (donor)
app.get('/api/users/:userId/donations', (req, res) => {
  try {
    const donations = db.prepare(`
      SELECT
        d.*,
        sr.reason,
        sr.category,
        u.first_name as recipient_first_name,
        u.last_name as recipient_last_name
      FROM donations d
      JOIN support_requests sr ON d.request_id = sr.id
      JOIN users u ON sr.user_id = u.id
      WHERE d.donor_id = ?
      ORDER BY d.created_at DESC
    `).all(req.params.userId);

    res.json(donations);
  } catch (error) {
    console.error('Get donations error:', error);
    res.status(500).json({ error: 'Failed to get donations' });
  }
});

// Get donation stats for a user
app.get('/api/users/:userId/stats', (req, res) => {
  try {
    const userId = req.params.userId;

    const totalDonated = db.prepare(`
      SELECT COALESCE(SUM(hours), 0) as total FROM donations WHERE donor_id = ?
    `).get(userId);

    const peopleHelped = db.prepare(`
      SELECT COUNT(DISTINCT sr.user_id) as count
      FROM donations d
      JOIN support_requests sr ON d.request_id = sr.id
      WHERE d.donor_id = ?
    `).get(userId);

    const user = db.prepare('SELECT available_pto_hours FROM users WHERE id = ?').get(userId);

    res.json({
      totalDonated: totalDonated.total,
      peopleHelped: peopleHelped.count,
      availablePTO: user ? user.available_pto_hours : 0
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ============== SERVE FRONTEND ==============

// Serve index.html for root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`PTO Buddy server running on http://localhost:${PORT}`);
});
