const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '/')));

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        domain TEXT,
        allow_cross_company BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        company_id INTEGER REFERENCES companies(id),
        is_company_admin BOOLEAN DEFAULT FALSE,
        can_donate BOOLEAN DEFAULT FALSE,
        need_support BOOLEAN DEFAULT FALSE,
        available_pto_hours INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS support_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        hours_needed INTEGER NOT NULL,
        hours_received INTEGER DEFAULT 0,
        urgency TEXT NOT NULL,
        category TEXT NOT NULL,
        reason TEXT NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE,
        status TEXT DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS donations (
        id SERIAL PRIMARY KEY,
        donor_id INTEGER NOT NULL REFERENCES users(id),
        request_id INTEGER NOT NULL REFERENCES support_requests(id),
        hours INTEGER NOT NULL,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Database tables initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
  } finally {
    client.release();
  }
}

// Initialize database on startup
initializeDatabase();

// ============== COMPANY ROUTES ==============

// Get all companies (for dropdown)
app.get('/api/companies', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM companies ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({ error: 'Failed to get companies' });
  }
});

// Create a new company
app.post('/api/companies', async (req, res) => {
  try {
    const { name, domain, allowCrossCompany } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Company name is required' });
    }

    const existing = await pool.query('SELECT id FROM companies WHERE name = $1', [name]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Company already exists' });
    }

    const result = await pool.query(
      'INSERT INTO companies (name, domain, allow_cross_company) VALUES ($1, $2, $3) RETURNING id',
      [name, domain || null, allowCrossCompany || false]
    );

    res.status(201).json({
      message: 'Company created',
      companyId: result.rows[0].id
    });
  } catch (error) {
    console.error('Create company error:', error);
    res.status(500).json({ error: 'Failed to create company' });
  }
});

// Get company details
app.get('/api/companies/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM companies WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ error: 'Failed to get company' });
  }
});

// Get company employees
app.get('/api/companies/:id/employees', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, first_name, last_name, email, phone, username,
             is_company_admin, can_donate, need_support, available_pto_hours, created_at
      FROM users
      WHERE company_id = $1
      ORDER BY last_name, first_name
    `, [req.params.id]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get employees error:', error);
    res.status(500).json({ error: 'Failed to get employees' });
  }
});

// Get company stats
app.get('/api/companies/:id/stats', async (req, res) => {
  try {
    const companyId = req.params.id;

    const totalEmployees = await pool.query('SELECT COUNT(*) as count FROM users WHERE company_id = $1', [companyId]);
    const totalDonors = await pool.query('SELECT COUNT(*) as count FROM users WHERE company_id = $1 AND can_donate = TRUE', [companyId]);

    const totalDonated = await pool.query(`
      SELECT COALESCE(SUM(d.hours), 0) as total
      FROM donations d
      JOIN users u ON d.donor_id = u.id
      WHERE u.company_id = $1
    `, [companyId]);

    const totalReceived = await pool.query(`
      SELECT COALESCE(SUM(d.hours), 0) as total
      FROM donations d
      JOIN support_requests sr ON d.request_id = sr.id
      JOIN users u ON sr.user_id = u.id
      WHERE u.company_id = $1
    `, [companyId]);

    const activeRequests = await pool.query(`
      SELECT COUNT(*) as count
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      WHERE u.company_id = $1 AND sr.status = 'active'
    `, [companyId]);

    const crossCompanyGiven = await pool.query(`
      SELECT COALESCE(SUM(d.hours), 0) as total
      FROM donations d
      JOIN users donor ON d.donor_id = donor.id
      JOIN support_requests sr ON d.request_id = sr.id
      JOIN users recipient ON sr.user_id = recipient.id
      WHERE donor.company_id = $1 AND recipient.company_id != $1
    `, [companyId]);

    const crossCompanyReceived = await pool.query(`
      SELECT COALESCE(SUM(d.hours), 0) as total
      FROM donations d
      JOIN users donor ON d.donor_id = donor.id
      JOIN support_requests sr ON d.request_id = sr.id
      JOIN users recipient ON sr.user_id = recipient.id
      WHERE recipient.company_id = $1 AND donor.company_id != $1
    `, [companyId]);

    res.json({
      totalEmployees: parseInt(totalEmployees.rows[0].count),
      totalDonors: parseInt(totalDonors.rows[0].count),
      totalDonated: parseInt(totalDonated.rows[0].total),
      totalReceived: parseInt(totalReceived.rows[0].total),
      activeRequests: parseInt(activeRequests.rows[0].count),
      crossCompanyGiven: parseInt(crossCompanyGiven.rows[0].total),
      crossCompanyReceived: parseInt(crossCompanyReceived.rows[0].total)
    });
  } catch (error) {
    console.error('Get company stats error:', error);
    res.status(500).json({ error: 'Failed to get company stats' });
  }
});

// Update employee (for admin)
app.put('/api/companies/:companyId/employees/:userId', async (req, res) => {
  try {
    const { companyId, userId } = req.params;
    const { company_id, first_name, last_name, email, phone, can_donate, need_support, available_pto_hours, is_company_admin } = req.body;

    const userCheck = await pool.query('SELECT company_id FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].company_id != companyId) {
      return res.status(403).json({ error: 'User does not belong to this company' });
    }

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (company_id !== undefined) { updates.push(`company_id = $${paramCount++}`); values.push(company_id); }
    if (first_name !== undefined) { updates.push(`first_name = $${paramCount++}`); values.push(first_name); }
    if (last_name !== undefined) { updates.push(`last_name = $${paramCount++}`); values.push(last_name); }
    if (email !== undefined) { updates.push(`email = $${paramCount++}`); values.push(email); }
    if (phone !== undefined) { updates.push(`phone = $${paramCount++}`); values.push(phone); }
    if (can_donate !== undefined) { updates.push(`can_donate = $${paramCount++}`); values.push(can_donate); }
    if (need_support !== undefined) { updates.push(`need_support = $${paramCount++}`); values.push(need_support); }
    if (available_pto_hours !== undefined) { updates.push(`available_pto_hours = $${paramCount++}`); values.push(available_pto_hours); }
    if (is_company_admin !== undefined) { updates.push(`is_company_admin = $${paramCount++}`); values.push(is_company_admin); }

    if (updates.length > 0) {
      values.push(userId);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`, values);
    }

    const updatedEmployee = await pool.query(`
      SELECT id, first_name, last_name, email, phone, username, company_id,
             is_company_admin, can_donate, need_support, available_pto_hours, created_at
      FROM users WHERE id = $1
    `, [userId]);

    res.json({ message: 'Employee updated', employee: updatedEmployee.rows[0] });
  } catch (error) {
    console.error('Update employee error:', error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

// Remove employee from company
app.delete('/api/companies/:companyId/employees/:userId', async (req, res) => {
  try {
    const { companyId, userId } = req.params;
    const { removeFromCompany } = req.query;

    const userCheck = await pool.query('SELECT company_id, is_company_admin FROM users WHERE id = $1', [userId]);
    if (userCheck.rows.length === 0 || userCheck.rows[0].company_id != companyId) {
      return res.status(403).json({ error: 'User does not belong to this company' });
    }

    if (userCheck.rows[0].is_company_admin) {
      const adminCount = await pool.query('SELECT COUNT(*) as count FROM users WHERE company_id = $1 AND is_company_admin = TRUE', [companyId]);
      if (parseInt(adminCount.rows[0].count) <= 1) {
        return res.status(400).json({ error: 'Cannot remove the only company admin' });
      }
    }

    if (removeFromCompany === 'true') {
      await pool.query('UPDATE users SET company_id = NULL, is_company_admin = FALSE WHERE id = $1', [userId]);
      res.json({ message: 'Employee removed from company' });
    } else {
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
      res.json({ message: 'Employee deleted' });
    }
  } catch (error) {
    console.error('Remove employee error:', error);
    res.status(500).json({ error: 'Failed to remove employee' });
  }
});

// Add employee to company
app.post('/api/companies/:companyId/employees', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { email, firstName, lastName, phone, username, password, canDonate, needSupport, ptoHours } = req.body;

    const company = await pool.query('SELECT id FROM companies WHERE id = $1', [companyId]);
    if (company.rows.length === 0) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const existingUser = await pool.query('SELECT id, company_id FROM users WHERE email = $1', [email]);

    if (existingUser.rows.length > 0) {
      if (existingUser.rows[0].company_id) {
        return res.status(400).json({ error: 'User is already assigned to a company' });
      }
      await pool.query('UPDATE users SET company_id = $1 WHERE id = $2', [companyId, existingUser.rows[0].id]);
      res.json({ message: 'User added to company', userId: existingUser.rows[0].id });
    } else {
      if (!firstName || !lastName || !phone || !username || !password) {
        return res.status(400).json({ error: 'All fields required for new employee' });
      }

      const existingUsername = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
      if (existingUsername.rows.length > 0) {
        return res.status(400).json({ error: 'Username already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const result = await pool.query(`
        INSERT INTO users (first_name, last_name, email, phone, username, password, company_id, can_donate, need_support, available_pto_hours)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id
      `, [firstName, lastName, email, phone, username, hashedPassword, companyId, canDonate || false, needSupport || false, ptoHours || 0]);

      res.status(201).json({ message: 'Employee created', userId: result.rows[0].id });
    }
  } catch (error) {
    console.error('Add employee error:', error);
    res.status(500).json({ error: 'Failed to add employee' });
  }
});

// ============== PASSWORD MANAGEMENT ==============

app.put('/api/users/:id/password', async (req, res) => {
  try {
    const { id } = req.params;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await pool.query('SELECT password FROM users WHERE id = $1', [id]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(currentPassword, user.rows[0].password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, id]);

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

app.post('/api/password-reset', async (req, res) => {
  try {
    const { identifier, newPassword } = req.body;

    if (!identifier || !newPassword) {
      return res.status(400).json({ error: 'Username/email and new password required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const user = await pool.query('SELECT id FROM users WHERE username = $1 OR email = $1', [identifier]);
    if (user.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, user.rows[0].id]);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// ============== GLOBAL STATS ==============

app.get('/api/stats/global', async (req, res) => {
  try {
    const totalHours = await pool.query('SELECT COALESCE(SUM(hours), 0) as total FROM donations');
    const totalPeopleHelped = await pool.query(`
      SELECT COUNT(DISTINCT sr.user_id) as count
      FROM donations d
      JOIN support_requests sr ON d.request_id = sr.id
    `);
    const totalCompanies = await pool.query('SELECT COUNT(*) as count FROM companies');
    const totalDonors = await pool.query('SELECT COUNT(DISTINCT donor_id) as count FROM donations');

    res.json({
      totalHours: parseInt(totalHours.rows[0].total),
      totalPeopleHelped: parseInt(totalPeopleHelped.rows[0].count),
      totalCompanies: parseInt(totalCompanies.rows[0].count),
      totalDonors: parseInt(totalDonors.rows[0].count)
    });
  } catch (error) {
    console.error('Get global stats error:', error);
    res.status(500).json({ error: 'Failed to get global stats' });
  }
});

// ============== AUTH ROUTES ==============

app.post('/api/register', async (req, res) => {
  try {
    const {
      firstName, lastName, email, phone,
      username, password, canDonate, needSupport, ptoHours,
      companyId, companyName, isCompanyAdmin, registrationType
    } = req.body;

    if (!firstName || !lastName || !email || !phone || !username || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email or username already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let finalCompanyId = companyId;

    if (registrationType === 'company' && companyName) {
      const existingCompany = await pool.query('SELECT id FROM companies WHERE name = $1', [companyName]);
      if (existingCompany.rows.length > 0) {
        return res.status(400).json({ error: 'Company already exists. Please join as an employee or contact your admin.' });
      }

      const companyResult = await pool.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [companyName]);
      finalCompanyId = companyResult.rows[0].id;
    }

    // If employee selected "new" company, create it
    if (!finalCompanyId && companyName) {
      const existingCompany = await pool.query('SELECT id FROM companies WHERE name = $1', [companyName]);
      if (existingCompany.rows.length > 0) {
        finalCompanyId = existingCompany.rows[0].id;
      } else {
        const companyResult = await pool.query('INSERT INTO companies (name) VALUES ($1) RETURNING id', [companyName]);
        finalCompanyId = companyResult.rows[0].id;
      }
    }

    const result = await pool.query(`
      INSERT INTO users (first_name, last_name, email, phone, username, password, company_id, is_company_admin, can_donate, need_support, available_pto_hours)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id
    `, [
      firstName, lastName, email, phone, username, hashedPassword,
      finalCompanyId || null,
      (registrationType === 'company' || isCompanyAdmin) || false,
      canDonate || false,
      needSupport || false,
      ptoHours || 0
    ]);

    let companyInfo = null;
    if (finalCompanyId) {
      const companyResult = await pool.query('SELECT id, name FROM companies WHERE id = $1', [finalCompanyId]);
      companyInfo = companyResult.rows[0];
    }

    const newUser = {
      id: result.rows[0].id,
      first_name: firstName,
      last_name: lastName,
      email: email,
      phone: phone,
      username: username,
      company_id: finalCompanyId || null,
      company_name: companyInfo ? companyInfo.name : null,
      is_company_admin: (registrationType === 'company' || isCompanyAdmin) || false,
      can_donate: canDonate || false,
      need_support: needSupport || false,
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

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(`
      SELECT u.*, c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.username = $1 OR u.email = $1
    `, [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

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
app.get('/api/users/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.username,
             u.company_id, u.is_company_admin, u.can_donate, u.need_support,
             u.available_pto_hours, u.created_at, c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update user profile
app.put('/api/users/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const { first_name, last_name, email, phone, company_id, can_donate, need_support, available_pto_hours } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (first_name !== undefined) { updates.push(`first_name = $${paramCount++}`); values.push(first_name); }
    if (last_name !== undefined) { updates.push(`last_name = $${paramCount++}`); values.push(last_name); }
    if (email !== undefined) { updates.push(`email = $${paramCount++}`); values.push(email); }
    if (phone !== undefined) { updates.push(`phone = $${paramCount++}`); values.push(phone); }
    if (company_id !== undefined) { updates.push(`company_id = $${paramCount++}`); values.push(company_id); }
    if (can_donate !== undefined) { updates.push(`can_donate = $${paramCount++}`); values.push(can_donate); }
    if (need_support !== undefined) { updates.push(`need_support = $${paramCount++}`); values.push(need_support); }
    if (available_pto_hours !== undefined) { updates.push(`available_pto_hours = $${paramCount++}`); values.push(available_pto_hours); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(userId);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`, values);

    const result = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.username,
             u.company_id, u.is_company_admin, u.can_donate, u.need_support,
             u.available_pto_hours, u.created_at, c.name as company_name
      FROM users u
      LEFT JOIN companies c ON u.company_id = c.id
      WHERE u.id = $1
    `, [userId]);

    res.json({ message: 'Profile updated', user: result.rows[0] });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// ============== SUPPORT REQUEST ROUTES ==============

app.post('/api/requests', async (req, res) => {
  try {
    const { userId, hoursNeeded, urgency, category, reason, startDate, endDate } = req.body;

    if (!userId || !hoursNeeded || !urgency || !category || !reason || !startDate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await pool.query(`
      INSERT INTO support_requests (user_id, hours_needed, urgency, category, reason, start_date, end_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [userId, hoursNeeded, urgency, category, reason, startDate, endDate || null]);

    res.status(201).json({
      message: 'Support request created',
      requestId: result.rows[0].id
    });
  } catch (error) {
    console.error('Create request error:', error);
    res.status(500).json({ error: 'Failed to create request' });
  }
});

app.get('/api/requests', async (req, res) => {
  try {
    const result = await pool.query(`
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
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Get requests error:', error);
    res.status(500).json({ error: 'Failed to get requests' });
  }
});

app.get('/api/requests/:id', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        sr.*,
        u.first_name,
        u.last_name,
        (SELECT COALESCE(SUM(hours), 0) FROM donations WHERE request_id = sr.id) as hours_received
      FROM support_requests sr
      JOIN users u ON sr.user_id = u.id
      WHERE sr.id = $1
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get request error:', error);
    res.status(500).json({ error: 'Failed to get request' });
  }
});

app.get('/api/users/:userId/requests', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        sr.*,
        (SELECT COALESCE(SUM(hours), 0) FROM donations WHERE request_id = sr.id) as hours_received
      FROM support_requests sr
      WHERE sr.user_id = $1
      ORDER BY sr.created_at DESC
    `, [req.params.userId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get user requests error:', error);
    res.status(500).json({ error: 'Failed to get requests' });
  }
});

// ============== DONATION ROUTES ==============

app.post('/api/donations', async (req, res) => {
  const client = await pool.connect();
  try {
    const { donorId, requestId, hours, message } = req.body;

    if (!donorId || !requestId || !hours) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await client.query('BEGIN');

    const donor = await client.query('SELECT available_pto_hours FROM users WHERE id = $1', [donorId]);
    if (donor.rows.length === 0 || donor.rows[0].available_pto_hours < hours) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Insufficient PTO hours available' });
    }

    const request = await client.query('SELECT * FROM support_requests WHERE id = $1 AND status = $2', [requestId, 'active']);
    if (request.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Support request not found or closed' });
    }

    await client.query(`
      INSERT INTO donations (donor_id, request_id, hours, message)
      VALUES ($1, $2, $3, $4)
    `, [donorId, requestId, hours, message || null]);

    await client.query('UPDATE users SET available_pto_hours = available_pto_hours - $1 WHERE id = $2', [hours, donorId]);
    await client.query('UPDATE support_requests SET hours_received = hours_received + $1 WHERE id = $2', [hours, requestId]);

    const updatedRequest = await client.query('SELECT hours_needed, hours_received FROM support_requests WHERE id = $1', [requestId]);
    if (updatedRequest.rows[0].hours_received >= updatedRequest.rows[0].hours_needed) {
      await client.query('UPDATE support_requests SET status = $1 WHERE id = $2', ['fulfilled', requestId]);
    }

    await client.query('COMMIT');
    res.status(201).json({ message: 'Donation successful' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Donation error:', error);
    res.status(500).json({ error: 'Donation failed' });
  } finally {
    client.release();
  }
});

app.get('/api/users/:userId/donations', async (req, res) => {
  try {
    const result = await pool.query(`
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
      WHERE d.donor_id = $1
      ORDER BY d.created_at DESC
    `, [req.params.userId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Get donations error:', error);
    res.status(500).json({ error: 'Failed to get donations' });
  }
});

app.get('/api/users/:userId/stats', async (req, res) => {
  try {
    const userId = req.params.userId;

    const totalDonated = await pool.query('SELECT COALESCE(SUM(hours), 0) as total FROM donations WHERE donor_id = $1', [userId]);
    const peopleHelped = await pool.query(`
      SELECT COUNT(DISTINCT sr.user_id) as count
      FROM donations d
      JOIN support_requests sr ON d.request_id = sr.id
      WHERE d.donor_id = $1
    `, [userId]);
    const user = await pool.query('SELECT available_pto_hours FROM users WHERE id = $1', [userId]);

    res.json({
      totalDonated: parseInt(totalDonated.rows[0].total),
      peopleHelped: parseInt(peopleHelped.rows[0].count),
      availablePTO: user.rows.length > 0 ? user.rows[0].available_pto_hours : 0
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ============== SEED DATA ==============

app.post('/api/seed', async (req, res) => {
  try {
    let companyResult = await pool.query('SELECT id FROM companies WHERE name = $1', ['Test Company']);
    let companyId;

    if (companyResult.rows.length === 0) {
      const newCompany = await pool.query(
        'INSERT INTO companies (name, domain, allow_cross_company) VALUES ($1, $2, $3) RETURNING id',
        ['Test Company', 'testcompany.com', true]
      );
      companyId = newCompany.rows[0].id;
    } else {
      companyId = companyResult.rows[0].id;
    }

    const testUsers = [
      { firstName: 'Admin', lastName: 'User', email: 'admin@testcompany.com', phone: '555-0001', username: 'admin', password: 'password123', isAdmin: true, canDonate: true, needSupport: false, ptoHours: 80 },
      { firstName: 'John', lastName: 'Donor', email: 'john@testcompany.com', phone: '555-0002', username: 'john', password: 'password123', isAdmin: false, canDonate: true, needSupport: false, ptoHours: 40 },
      { firstName: 'Jane', lastName: 'Recipient', email: 'jane@testcompany.com', phone: '555-0003', username: 'jane', password: 'password123', isAdmin: false, canDonate: false, needSupport: true, ptoHours: 0 },
      { firstName: 'Test', lastName: 'User', email: 'test@test.com', phone: '555-0004', username: 'testuser', password: 'password123', isAdmin: false, canDonate: true, needSupport: true, ptoHours: 20 }
    ];

    const createdUsers = [];

    for (const user of testUsers) {
      const existing = await pool.query('SELECT id FROM users WHERE email = $1 OR username = $2', [user.email, user.username]);
      if (existing.rows.length === 0) {
        const hashedPassword = await bcrypt.hash(user.password, 10);
        await pool.query(`
          INSERT INTO users (first_name, last_name, email, phone, username, password, company_id, is_company_admin, can_donate, need_support, available_pto_hours)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [user.firstName, user.lastName, user.email, user.phone, user.username, hashedPassword, companyId, user.isAdmin, user.canDonate, user.needSupport, user.ptoHours]);
        createdUsers.push({ username: user.username, email: user.email, password: user.password });
      } else {
        createdUsers.push({ username: user.username, email: user.email, password: user.password, note: 'already exists' });
      }
    }

    res.json({
      message: 'Seed data created successfully',
      company: 'Test Company',
      users: createdUsers
    });
  } catch (error) {
    console.error('Seed data error:', error);
    res.status(500).json({ error: 'Failed to seed data' });
  }
});

// ============== SERVE FRONTEND ==============

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`PTO Buddy server running on http://localhost:${PORT}`);
});
