# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

**PTO Buddy** is an application that allows employees to donate their extra PTO (paid time off) to colleagues who need it. The app builds workplace community by connecting those with unused time off to those facing unexpected life challenges.

## Development Commands

```bash
# Install dependencies
npm install

# Start the server
npm start

# Server runs at http://localhost:3000
```

## Project Structure

```
/
├── server.js            # Express.js backend server
├── package.json         # Node.js dependencies
├── index.html           # Main title/landing page
├── login.html           # User login page
├── register.html        # User registration page
├── dashboard.html       # Main dashboard with PTO requests
├── request-support.html # Form to request PTO support
├── my-donations.html    # User's donation history
├── CLAUDE.md            # Claude Code guidance
└── README.md            # Project readme
```

## Backend API

The server uses Express.js with SQLite database. Key endpoints:

- `POST /api/register` - Register new user
- `POST /api/login` - User authentication
- `GET /api/requests` - Get all active PTO requests
- `POST /api/requests` - Create a support request
- `POST /api/donations` - Make a PTO donation
- `GET /api/users/:id/donations` - Get user's donation history
- `GET /api/users/:id/stats` - Get user's stats

## User Workflow

1. **Landing Page** (`index.html`) - Users learn about PTO Buddy
2. **Registration** (`register.html`) - Users create account, indicate if donor/recipient
3. **Dashboard** (`dashboard.html`) - View active PTO requests from colleagues
4. **Request Support** (`request-support.html`) - Submit a request for PTO donations
5. **Donate PTO** - Click "Donate PTO" on any request card to give hours
6. **My Donations** (`my-donations.html`) - Track donation history and impact

## Code Style Guidelines

- Use semantic HTML5 elements
- CSS should be mobile-responsive
- Follow BEM naming conventions for CSS classes when scaling up

## Additional Notes

Key features of PTO Buddy:
- **Donate PTO** - Employees can give unused hours to colleagues
- **Request Support** - Those in need can request PTO donations
- **Build Community** - Strengthens organizational bonds
