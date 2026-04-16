# 🚀 Agency Automation — AI-Powered Creative Task Management System

A full-stack automation platform that intelligently assigns creative tasks (Posters, Reels, Ads) to designers using smart workload balancing, skill-based routing, and deadline-priority algorithms — with real-time dashboards for Planners, Designers, and Admins.

---

## 💡 Problem vs Solution

| **❌ The Problem** | Creative agencies manually assign tasks via WhatsApp/Excel — leading to uneven designer workloads, missed deadlines, and near-impossible tracking. |
| **✅ The Solution** | A *Zero-Human Intervention* system that parses Google Drive CSVs and uses a math-based scoring engine to ensure fair work distribution and 100% automated tracking. |

---

## 📌 Project Overview

Agency Automation eliminates manual task distribution in creative agencies. Planners upload a monthly CSV file to **Google Drive**, and the system **automatically parses, assigns, and tracks every task** through completion — with no human intervention needed for scheduling.

Built for a **6-designer, 2-planner, 1-admin** agency workflow.

---

## 👥 Role-Based Dashboards (RBAC)

Security and workflow integrity are maintained through 3 specialized dashboards:

| Role | Responsibility | Key Actions |
|------|---------------|-------------|
| **Admin** | Decision Maker | Full visibility, Approve/Reject submissions, Reassign tasks, Manage leaves |
| **Planner** | Coordinator | Upload CSV, Monitor status (Read-only), Share approved assets with clients |
| **Designer** | Creative Execution | View today's tasks, Start/Submit work, Preview tomorrow's tasks |

---

## ✨ Key Features

### 🧠 Smart Auto-Assignment Engine
- Reads CSV from Google Drive (via OAuth 2.0) and auto-assigns tasks to designers
- Multi-factor scoring algorithm combining:
  - Skill match (Poster / Reel / Ads)
  - Live workload score
  - Deadline urgency weight
  - Date-wise availability check

### 📂 Google Drive Integration
- Planner uploads CSV → auto-detected via Google Drive API (OAuth 2.0)
- Filename encodes planner identity: `Karthik_2026-04-05-14-20_tasks.csv`
- Submissions uploaded to Drive's submissions folder
- File format validated before upload (CSV columns verified)

### 📅 Today-Only Task View
- All dashboards show **only today's tasks** (`publish_date` / `is_today` flag)
- Daily midnight cron auto-updates `is_today` flags in Supabase
- IST (Indian Standard Time) aware — all timestamps in +5:30 offset

### 📤 Designer Submission Flow

```
Assigned → Start Work → Submit File → Manager Review → Approved / Rejected → Resubmit
```

File format validation per task type:

| Task Type | Accepted Formats |
|-----------|-----------------|
| **Poster** | PNG, JPG |
| **Reel** | MP4, MOV, AVI |
| **Ads** | PNG, JPG, GIF, MP4, ZIP |

### 🔔 Real-Time Notifications
- Designer starts work → Planner notified instantly
- Designer submits → Planner notified with file link
- Admin approves/rejects → Designer + Planner both notified

### 🏖️ Leave & No-Show Management
- Designer requests leave → Admin approves/rejects
- On approval → Tasks auto-reassigned to available designers
- No-login by 10 AM → Tasks auto-reassigned (cron checks at 10:00 AM & 10:30 AM)

### 📊 Client Requirements Tracking
- Each task stores client-specific content requirements
- Requirements visible to designers in task row and submit modal

### 🔑 Upload Token System
- Every CSV upload generates a unique token: `PLN-KARTHIK-20260405-142052-A3B7`
- Traceable in Admin's Upload Logs tab

---

## ⏰ Advanced Automated Workflows (Cron Jobs)

The system's core reliability runs on these scheduled jobs:

| Time (IST) | Automation Task | Logic / Condition |
|------------|----------------|-------------------|
| **00:00 AM** | State Reset | Updates `is_today` flags in Supabase for current date filtering |
| **08:00 AM** | Urgency Alerts | Automatic 2-day deadline reminders sent to designers |
| **10:00 AM** | No-Show Detection | **Hybrid Logic:** Alerts Manager for manual reassignment. If no action by 10:30 AM, system auto-assigns to the next free designer |
| **04:00 PM** | EOD Pressure Alert | "Only 2 hours left!" reminder — prompts Admin approval if extra time is needed |
| **05:30 PM** | Tomorrow's Roadmap | Tomorrow's task list becomes visible as a "Preview" for advanced planning |
| **Every 30m** | Drive Polling | Scans Google Drive for new CSV uploads to trigger the Assignment Engine |

---

## 🧮 Algorithms Used

### 1. Smart Workload Score Algorithm
```
Score = active_tasks + (urgent_tasks × 0.5)
Lower score = less busy = assigned first
```
- `active_tasks` = Pending + Assigned + In Progress tasks
- `urgent_tasks` = tasks with deadline ≤ today (IST)

### 2. Date-Wise Availability Algorithm
```
New task arrives with Publish Date = April 7
  ↓
Check: Does designer have a task on April 7?
  → No  → Assign here (free on that date)
  → Yes → Compare total workload → assign to lower
```
Priority order:
1. Designer with **zero** tasks on that publish date
2. Tie-break by total active task count (lowest first)
3. Final tie-break by urgent task count

### 3. Skill-Based Routing
```
task_type = "Reel"
  ↓
Filter designers where skill IN ['reel']
  → Sneha (skill: reel)   ✅
  → Divya (skill: reel)   ✅
  → Lavanya (skill: poster) ❌  — filtered out
```

### 4. Urgent Task Priority Filter
```
Urgent task (deadline ≤ today):
  ↓
Prefer designers with 0 urgent tasks currently
  → If none free → pick designer with fewest urgent tasks
  → Score penalty: urgent_tasks × 0.5 added to workload score
```

### 5. Filename-Based Planner Identity
```
Filename: "Preethi_2026-04-05-14-20-52_tasks_batch2.csv"
  ↓
Split by "_" → parts[0] = "Preethi"
  ↓
planner_name = "Preethi" (stored on all tasks from this upload)
```

### 6. IST-Aware Date Filtering
```javascript
// UTC offset +5:30 applied manually for IST accuracy
function getISTDate() {
  const IST = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
  return IST.toISOString().split('T')[0];
}
```

### 7. is_today Flag System
- Supabase `tasks.is_today` (boolean) updated by daily midnight cron
- All dashboards filter by `publish_date = today` (IST-aware)
- Prevents tomorrow's tasks from showing in today's view

---

## 🗄️ Database Schema (Supabase / PostgreSQL)

```
profiles          — Users (planner / designer / admin)
tasks             — Core task table with publish_date, is_today, requirements
designer_skills   — Many-to-many: designer ↔ skill (poster/reel/ads)
clients           — Client master with planner assignment
notifications     — Real-time alerts (designer, planner, type-based)
leave_requests    — Designer leave with approve/reject workflow
sync_logs         — CSV upload audit trail with upload_token
```

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React.js (Create React App), inline CSS-in-JS |
| **Backend** | Node.js, Express.js |
| **Database** | Supabase (PostgreSQL) with Row Level Security |
| **Auth** | Supabase Auth (JWT) |
| **Storage** | Google Drive API v3 (OAuth 2.0) |
| **Scheduler** | node-cron (multiple scheduled jobs) |
| **CSV Parsing** | csv-parser (Node.js stream-based) |
| **Fonts** | Google Fonts — Outfit + Fraunces |

---

## 📁 Project Structure

```
Automation/
├── backend/
│   ├── server.js          # Express API — all routes + cron jobs
│   ├── Automation.js      # Smart assign engine
│   ├── DriveService.js    # Google Drive OAuth + file ops
│   ├── supabase.js        # Supabase client
│   ├── create-users.js    # Seed script
│   └── .env               # Environment variables
├── frontend/
│   └── src/
│       ├── components/
│       │   ├── DesignerDashboard.js
│       │   ├── PlannerDashboard.js
│       │   └── AdminDashboard.js
│       ├── contexts/
│       │   └── AuthContext.js
│       └── services/
│           └── api.js
└── README.md
```

---

## 🔐 Environment Variables

```env
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:5000/auth/callback
GOOGLE_DRIVE_FOLDER_ID=
GOOGLE_DRIVE_SUBMISSIONS_FOLDER_ID=
PORT=5000
```

---

## 🚀 Getting Started

```bash
# 1. Clone the repo
git clone https://github.com/your-username/agency-automation.git
cd agency-automation

# 2. Backend setup
cd backend
npm install
cp .env.example .env   # Fill in your credentials

# 3. Connect Google Drive (one-time OAuth setup)
node server.js
# Visit: http://localhost:5000/auth/google

# 4. Frontend setup
cd ../frontend
npm install
npm start

# 5. Seed Supabase
# Run schema.sql in Supabase SQL Editor
# Run create-users.js to create accounts
```

---

## 📋 CSV Format

Planners upload a CSV with these columns:

```csv
Task ID,Client Name,Task Type,Content Requirement,Publish Date
T501,Bloom Kids Academy,Ads,"Admission open ads, all banner sizes",2026-04-05
T502,Street Bites,Reel,"Street food vibe reel, 30sec, Tamil text",2026-04-05
T503,Velora Boutique,Poster,"New collection poster, dark maroon & gold",2026-04-06
```

- `Task Type`: `Poster` / `Reel` / `Ads`
- `Publish Date`: `YYYY-MM-DD`

---

👨‍💻 Developed By
Hari Latha M.Sc Computer Science (AI), Kamaraj College.

📄 License
MIT License.

MIT License — feel free to fork and adapt for your agency.
