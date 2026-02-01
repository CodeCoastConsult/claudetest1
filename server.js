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
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    domain TEXT,
    allow_cross_company BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    company_id INTEGER,
    is_company_admin BOOLEAN DEFAULT 0,
    can_donate BOOLEAN DEFAULT 0,
    need_support BOOLEAN DEFAULT 0,
    available_pto_hours INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id)
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

// Add columns to existing tables if they don't exist (for migrations)
try {
  db.exec(`ALTER TABLE users ADD COLUMN company_id INTEGER REFERENCES companies(id)`);
} catch (e) { /* column already exists */ }

try {
  db.exec(`ALTER TABLE users ADD COLUMN is_company_admin BOOLEAN DEFAULT 0`);
} catch (e) { /* column already exists */ }

// ============== COMPANY ROUTES ==============

// Get all companies (for dropdown)
app.get('/api/companies', (req, res) => {
  try {
    const companies = db.prepare('SELECT id, name FROM companies ORDER BY name').all();
    res.json(companies);
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ error: 'Failed to get companies' });
  }
});

// Create a new company (when registering as company admin)
app.post('/api/companies', (req, res) => {
  try {
    const { name, domain, allowCrossCompany } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    // Check if company already exists
    const existing = db.prepare('SELECT id FROM companies WHERE name = ?').get(name);
    if (existing) {
      return res.status(400).json({ error: 'Company already exists' });
    }

    const stmt = db.prepare('INSERT INTO companies (name, domain, allow_cross_company) VALUES (?, ?, ?)');
    const result = stmt.run(name, domain || null, allowCrossCompany ? 1 : 0);

    res.status(201).json({
      message: 'Company created',
      companyId: result.lastInsertRowid
    });
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({ error: 'Failed to create company' });
  }
});

// Get company details
app.get('/api/companies/:id', (req, res) => {
  try {
    const company = db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.id);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    res.json(company);
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ error: 'Failed to get company' });
  }
});

// Get company employees (for admin)
app.get('/api/companies/:id/employees', (req, res) => {
  try {
    const employees = db.prepare(`
      SELECT
        id, first_name, last_name, email, phone, username,
        is_company_admin, can_donate, need_support, available_pto_hours, created_at
      FROM users
      WHERE company_id = ?
      ORDER BY last_name, first_name
    `).all(req.params.id);

    res.json(employees);
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ error: 'Failed to get employees' });
  }
});

// Get company stats (for admin)
app.get('/api/companies/:id/stats', (req, res) => {
  try {
    const companyId = req.params.id;

    const totalEmployees = db.prepare('SELECT COUNT(*) as count FROM users WHERE company_id = ?').get(companyId);

    const totalDonors = db.prepare('SELECT COUNT(*) as count FROM users WHERE company_id = ? AND can_donate = 1').get(companyId);

    const totalDonated = db.prepare(`
      SELECT COALESCE(SUM(d.hours), 0) as total
      FROM donations d
      JOIN users u ON d.donor_id = u.id
      WHERE u.company_id = ?
    `).get(companyId);

    const totalReceived = db.prepare(`
      SELECT COALESCE(SUM(d.hours), 0) as total
      FROM donations d
      JOIN support_requests sr ON d.request_id = sr.id
      JOIN users u ON sr.user_id = u.id
      WHERE u.company_id = ?
    `).get(companyId);

    const activeRequests = db.prepare(`
      SELECT COUNT(*) as count
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      WHERE u.company_id = ? AND sr.status = 'active'
    `).get(companyId);

    // Cross-company donations given
    const crossCompanyGiven = db.prepare(`
      SELECT COALESCE(SUM(d.hours), 0) as total
      FROM donations d
      JOIN users donor ON d.donor_id = donor.id
      JOIN support_requests sr ON d.request_id = sr.id
      JOIN users recipient ON sr.user_id = recipient.id
      WHERE donor.company_id = ? AND recipient.company_id != ?
    `).get(companyId, companyId);

    // Cross-company donations received
    const crossCompanyReceived = db.prepare(`
      SELECT COALESCE(SUM(d.hours), 0) as total
      FROM donations d
      JOIN users donor ON d.donor_id = donor.id
      JOIN support_requests sr ON d.request_id = sr.id
      JOIN users recipient ON sr.user_id = recipient.id
      WHERE recipient.company_id = ? AND donor.company_id != ?
    `).get(companyId, companyId);

    res.json({
      totalEmployees: totalEmployees.count,
      totalDonors: totalDonors.count,
      totalDonated: totalDonated.total,
      totalReceived: totalReceived.total,
      activeRequests: activeRequests.count,
      crossCompanyGiven: crossCompanyGiven.total,
      crossCompanyReceived: crossCompanyReceived.total
    });
  } catch (error) {
    console.error('Get company stats error:', error);
    res.status(500).json({ error: 'Failed to get company stats' });
  }
});

// Update employee (for admin)
app.put('/api/companies/:companyId/employees/:userId', (req, res) => {
  try {
    const { companyId, userId } = req.params;
    const { company_id } = req.body;

    // Verify user belongs to this company
    const user = db.prepare('SELECT company_id FROM users WHERE id = ?').get(userId);
    if (!user || user.company_id != companyId) {
      return res.status(403).json({ error: 'User does not belong to this company' });
    }

    if (company_id !== undefined) {
      db.prepare('UPDATE users SET company_id = ? WHERE id = ?').run(company_id, userId);
    }

    res.json({ message: 'Employee updated' });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// ============== GLOBAL STATS ==============

app.get('/api/stats/global', (req, res) => {
  try {
    const totalHours = db.prepare('SELECT COALESCE(SUM(hours), 0) as total FROM donations').get();

    const totalPeopleHelped = db.prepare(`
      SELECT COUNT(DISTINCT sr.user_id) as count
      FROM donations d
      JOIN support_requests sr ON d.request_id = sr.id
    `).get();

    const totalCompanies = db.prepare('SELECT COUNT(*) as count FROM companies').get();

    const totalDonors = db.prepare('SELECT COUNT(DISTINCT donor_id) as count FROM donations').get();

    res.json({
      totalHours: totalHours.total,
      totalPeopleHelped: totalPeopleHelped.count,
      totalCompanies: totalCompanies.count,
      totalDonors: totalDonors.count
    });
  } catch (error) {
    console.error('Get global stats error:', error);
    res.status(500).json({ error: 'Failed to get global stats' });
  }
});

// ============== AUTH ROUTES ==============

// Register a new user
app.post('/api/register', async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone,
      username, password, canDonate, needSupport, ptoHours,
      companyId, companyName, isCompanyAdmin, registrationType
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

    let finalCompanyId = companyId;

    // If registering as company admin, create the company first
    if (registrationType === 'company' && companyName) {
      // Check if company exists
      let company = db.prepare('SELECT id FROM companies WHERE name = ?').get(companyName);
      if (company) {
        return res.status(400).json({ error: 'Company already exists. Please join as an employee or contact your admin.' });
      }

      // Create new company
      const companyResult = db.prepare('INSERT INTO companies (name) VALUES (?)').run(companyName);
      finalCompanyId = companyResult.lastInsertRowid;
    }

    // Insert user
    const stmt = db.prepare(`
      INSERT INTO users (first_name, last_name, email, phone, username, password, company_id, is_company_admin, can_donate, need_support, available_pto_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      firstName, lastName, email, phone, username, hashedPassword,
      finalCompanyId || null,
      (registrationType === 'company' || isCompanyAdmin) ? 1 : 0,
      canDonate ? 1 : 0,
      needSupport ? 1 : 0,
      ptoHours || 0
    );

    // Get company name if exists
    let companyInfo = null;
    if (finalCompanyId) {
      companyInfo = db.prepare('SELECT id, name FROM companies WHERE id = ?').get(finalCompanyId);
    }

    // Return user data for auto-login
    const newUser = {
      id: result.lastInsertRowid,
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phone,
      username: username,
      company_id: finalCompanyId || null,
      company_name: companyInfo ? companyInfo.name : null,
      is_company_admin: (registrationType === 'company' || isCompanyAdmin) ? 1 : 0,
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

    const user = db.prepare(`
      SELECT u.*, c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.username = ?
    `).get(username);

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
      SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.username,
             u.company_id, u.is_company_admin, u.can_donate, u.need_support,
             u.available_pto_hours, u.created_at, c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = ?
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

// Update user profile
app.put('/api/users/:id', (req, res) => {
  try {
    const userId = req.params.id;
    const { first_name, last_name, email, phone, company_id, can_donate, need_support, available_pto_hours } = req.body;

    const updates = [];
    const values = [];

    if (first_name !== undefined) { updates.push('first_name = ?'); values.push(first_name); }
    if (last_name !== undefined) { updates.push('last_name = ?'); values.push(last_name); }
    if (email !== undefined) { updates.push('email = ?'); values.push(email); }
    if (phone !== undefined) { updates.push('phone = ?'); values.push(phone); }
    if (company_id !== undefined) { updates.push('company_id = ?'); values.push(company_id); }
    if (can_donate !== undefined) { updates.push('can_donate = ?'); values.push(can_donate ? 1 : 0); }
    if (need_support !== undefined) { updates.push('need_support = ?'); values.push(need_support ? 1 : 0); }
    if (available_pto_hours !== undefined) { updates.push('available_pto_hours = ?'); values.push(available_pto_hours); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);

    // Return updated user
    const user = db.prepare(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.username,
             u.company_id, u.is_company_admin, u.can_donate, u.need_support,
             u.available_pto_hours, u.created_at, c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = ?
    `).get(userId);

    res.json({ message: 'Profile updated', user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
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
        u.company_id,
        c.name as company_name,
        (SELECT COALESCE(SUM(hours), 0) FROM donations WHERE request_id = sr.id) as hours_received
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      LEFT JOIN companies c ON u.company_id = c.id
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
        u.last_name as recipient_last_name,
        u.company_id as recipient_company_id,
        c.name as recipient_company_name
      FROM donations d
      JOIN support_requests sr ON d.request_id = sr.id
      JOIN users u ON sr.user_id = u.id
      LEFT JOIN companies c ON u.company_id = c.id
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
