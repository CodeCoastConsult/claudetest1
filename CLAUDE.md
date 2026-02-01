# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## Project Overview

**PTO Buddy** is an application that allows employees to donate their extra PTO (paid time off) to colleagues who need it. The app builds workplace community by connecting those with unused time off to those facing unexpected life challenges.

## Development Commands

- Open `index.html` in a browser to view the title page

## Project Structure

```
/
├── index.html           # Main title/landing page
├── register.html        # User registration page
├── dashboard.html       # Main dashboard with PTO requests
├── request-support.html # Form to request PTO support
├── my-donations.html    # User's donation history
├── CLAUDE.md            # Claude Code guidance
└── README.md            # Project readme
```

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
