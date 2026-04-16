const express = require('express')
const cors = require('cors')
const cron = require('node-cron')
const multer = require('multer')
const { v4: uuidv4 } = require('uuid')
require('dotenv').config()

const { runAutomation, runAutomationFromBuffer } = require('./automation')
const supabase = require('./supabase')
const {
  listFolders, listFilesInFolder, uploadFileToDrive,
  getFileViewLink, createFolder,
  getAuthUrl, saveTokenFromCode, hasOAuthToken,
} = require('./DriveService')

const app = express()
const upload = multer({ storage: multer.memoryStorage() })
const uploadDesigner = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

app.use(cors())
app.use(express.json())

const REEL_DESIGNERS   = ['Divya', 'Sneha']
const POSTER_DESIGNERS = ['Lavanya', 'Arun']
const ADS_DESIGNERS    = ['Kiran', 'Vikram']

// ─── IST Helpers ───────────────────────────────────────────
function getISTDate() {
  const IST = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000))
  return IST.toISOString().split('T')[0]
}

function getISTTomorrow() {
  const IST = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000))
  IST.setDate(IST.getDate() + 1)
  return IST.toISOString().split('T')[0]
}

function isAfter430PM() {
  const now = new Date()
  const IST = new Date(now.getTime() + (5.5 * 60 * 60 * 1000))
  const hours   = IST.getUTCHours()
  const minutes = IST.getUTCMinutes()
  const result  = hours > 16 || (hours === 16 && minutes >= 30)
  console.log(`⏰ IST Time: ${hours}:${String(minutes).padStart(2,'0')} | After 4:30PM: ${result}`)
  return result
}

// ─── is_today flag update ──────────────────────────────────
async function updateIsTodayFlags() {
  const today = getISTDate()
  console.log(`🔄 Updating is_today flags for ${today}...`)
  try {
    await supabase.from('tasks').update({ is_today: false }).neq('task_id', '')
    await supabase.from('tasks').update({ is_today: true })
      .or(`end_date.eq.${today},publish_date.eq.${today}`)
      .in('status', ['Pending', 'Assigned', 'In Progress', 'Submitted'])
    console.log(`✅ is_today updated for ${today}`)
  } catch (err) {
    console.error('is_today update error:', err.message)
  }
}

function generateUploadToken(userId) {
  const now     = new Date()
  const date    = now.toISOString().slice(0, 10).replace(/-/g, '')
  const time    = now.toTimeString().slice(0, 8).replace(/:/g, '')
  const shortId = (userId || 'UNKNOWN').slice(0, 8).toUpperCase()
  const random  = uuidv4().split('-')[0].toUpperCase()
  return `PLN-${shortId}-${date}-${time}-${random}`
}

// ─── Auth Middleware ───────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'No token' })
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Invalid token' })
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  req.user = { ...user, ...profile }
  next()
}

app.get('/', (req, res) => res.json({ message: 'Agency Automation Backend Running!' }))

app.get('/api/test-date', (req, res) => {
  const now = new Date()
  const IST = new Date(now.getTime() + (5.5 * 60 * 60 * 1000))
  res.json({
    serverUTC:  now.toISOString(),
    istTime:    IST.toISOString(),
    istHour:    IST.getUTCHours(),
    istMinute:  IST.getUTCMinutes(),
    today:      getISTDate(),
    tomorrow:   getISTTomorrow(),
    isAfter430: isAfter430PM(),
  })
})

// ════════════════════════════════════════════
// OAUTH
// ════════════════════════════════════════════
app.get('/auth/google', (req, res) => res.redirect(getAuthUrl()))

app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query
    if (!code) return res.status(400).send('No code')
    await saveTokenFromCode(code)
    res.send(`<html><body style="font-family:Arial;text-align:center;padding:60px;background:#f0fdf4">
      <h1 style="color:#15803d">✅ Google Drive Connected!</h1><p>Close this tab.</p>
    </body></html>`)
  } catch (err) { res.status(500).send(`OAuth error: ${err.message}`) }
})

app.get('/auth/status', (req, res) => {
  res.json({ connected: hasOAuthToken(), message: hasOAuthToken() ? '✅ Connected' : '❌ Visit /auth/google' })
})

// ─── LOGIN ─────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return res.status(401).json({ success: false, error: 'Invalid credentials' })
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', data.user.id).single()
    if (!profile) return res.status(401).json({ success: false, error: 'Profile not found' })
    res.json({
      success: true,
      token: data.session.access_token,
      user: { id: data.user.id, email: data.user.email, name: profile.name, role: profile.role }
    })
  } catch (err) { res.status(500).json({ success: false, error: err.message }) }
})

// ════════════════════════════════════════════
// DESIGNER ROUTES
// ════════════════════════════════════════════

// Before 4:30PM → today only | After 4:30PM → today + tomorrow preview
app.get('/api/designer/tasks', authMiddleware, async (req, res) => {
  try {
    const today        = getISTDate()
    const tomorrow     = getISTTomorrow()
    const designerName = req.user.name
    const showTomorrow = isAfter430PM()

    console.log(`\n🎨 Designer: ${designerName} | Today: ${today} | ShowTomorrow: ${showTomorrow}`)

    const dateFilter = showTomorrow ? [today, tomorrow] : [today]

    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('assigned_designer', designerName)
      .in('end_date', dateFilter)
      .in('status', ['Pending', 'Assigned', 'In Progress', 'Submitted', 'Rejected', 'Completed'])
      .order('end_date', { ascending: true })

    if (error) return res.status(500).json({ error: error.message })

    const tasks = (data || []).map(t => ({
      ...t,
      day_label: t.end_date === today    ? '📅 Today' :
                 t.end_date === tomorrow ? '🔜 Tomorrow' :
                 t.end_date < today      ? '⚠️ Overdue' : `📆 ${t.end_date}`
    }))

    console.log(`✅ ${tasks.length} tasks | dates: ${dateFilter.join(', ')}`)
    res.json({ tasks, today, tomorrow, showTomorrow })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Designer: Start Work
app.put('/api/designer/task', authMiddleware, async (req, res) => {
  try {
    const { taskId, status } = req.body
    const { data: task } = await supabase.from('tasks').select('*').eq('task_id', taskId).single()
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (task.assigned_designer !== req.user.name) return res.status(403).json({ error: 'Not your task' })

    await supabase.from('tasks').update({
      status,
      started_at: status === 'In Progress' ? new Date().toISOString() : undefined,
    }).eq('task_id', taskId)

    if (status === 'In Progress') {
      await supabase.from('notifications').insert({
        planner_name:  task.planner_name,
        designer_name: req.user.name,
        task_id:       taskId,
        message:       `▶ ${req.user.name} started "${task.task_type}" for ${task.client_name}`,
        type:          'task_started',
        is_read:       false,
        created_at:    new Date().toISOString(),
      })
    }
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Designer: Submit task with file
app.post('/api/designer/submit-task', authMiddleware, uploadDesigner.single('file'), async (req, res) => {
  try {
    if (req.user.role !== 'designer') return res.status(403).json({ error: 'Access denied' })
    const { taskId, note } = req.body
    if (!taskId || !req.file) return res.status(400).json({ error: 'taskId and file required' })

    const { data: task } = await supabase.from('tasks').select('*').eq('task_id', taskId).single()
    if (!task) return res.status(404).json({ error: 'Task not found' })
    if (task.assigned_designer !== req.user.name) return res.status(403).json({ error: 'Not your task' })

    let driveFile = null
    try {
      const folderId = process.env.GOOGLE_DRIVE_SUBMISSIONS_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID
      const fileName = `${taskId}_${req.user.name}_${req.file.originalname}`
      driveFile = await uploadFileToDrive(req.file.buffer, fileName, req.file.mimetype, folderId, req.user.name)
    } catch (e) {
      return res.status(500).json({ error: 'Drive upload failed: ' + e.message })
    }

    await supabase.from('tasks').update({
      status:               'Submitted',
      submitted_date:       new Date().toISOString(),
      submission_note:      note || null,
      submission_file_id:   driveFile?.id,
      submission_file_link: driveFile?.webViewLink,
      submission_file_name: driveFile?.name,
    }).eq('task_id', taskId)

    // ★ Notify admin (for review) + planner
    await supabase.from('notifications').insert([
      {
        planner_name:  'admin',
        designer_name: req.user.name,
        task_id:       taskId,
        message:       `📤 ${req.user.name} submitted "${task.task_type}" for ${task.client_name} — waiting for admin review`,
        type:          'submission',
        is_read:       false,
        created_at:    new Date().toISOString(),
      },
      {
        planner_name:  task.planner_name,
        designer_name: req.user.name,
        task_id:       taskId,
        message:       `📤 ${req.user.name} submitted "${task.task_type}" for ${task.client_name}`,
        type:          'submission',
        is_read:       false,
        created_at:    new Date().toISOString(),
      },
    ])

    res.json({ success: true, drive_file: driveFile })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Designer: Notifications
app.get('/api/designer/notifications', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('notifications').select('*')
      .eq('designer_name', req.user.name)
      .order('created_at', { ascending: false }).limit(50)
    await supabase.from('notifications').update({ is_read: true })
      .eq('designer_name', req.user.name).eq('is_read', false)
    res.json({ notifications: data || [] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Designer: Login ping
app.post('/api/designer/login-ping', authMiddleware, async (req, res) => {
  try {
    await supabase.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', req.user.id)
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Designer: Leave request
app.post('/api/designer/leave', authMiddleware, async (req, res) => {
  try {
    const { leaveDate, reason } = req.body
    if (!leaveDate) return res.status(400).json({ error: 'Leave date required' })
    const { data, error } = await supabase.from('leave_requests').insert({
      designer_id:   req.user.id,
      designer_name: req.user.name,
      leave_date:    leaveDate,
      reason:        reason || null,
      status:        'pending',
      requested_at:  new Date().toISOString(),
    }).select().single()
    if (error) throw error
    await supabase.from('notifications').insert({
      planner_name:     'admin',
      message:          `🏖️ ${req.user.name} requested leave for ${leaveDate}${reason ? ` — ${reason}` : ''}`,
      type:             'leave_request',
      is_read:          false,
      created_at:       new Date().toISOString(),
      leave_request_id: data.id,
    })
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Designer: Leave status
app.get('/api/designer/leave-status', authMiddleware, async (req, res) => {
  try {
    const { data } = await supabase.from('leave_requests').select('*')
      .eq('designer_id', req.user.id).eq('leave_date', getISTDate()).single()
    res.json({ status: data?.status || null, leave_data: data })
  } catch { res.json({ status: null }) }
})

// ════════════════════════════════════════════
// PLANNER ROUTES
// ════════════════════════════════════════════

app.get('/api/planner/tasks', authMiddleware, async (req, res) => {
  try {
    if (!['planner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' })
    const today = getISTDate()
    const { data, error } = await supabase.from('tasks').select('*')
      .eq('planner_name', req.user.name)
      .eq('end_date', today)
      .order('end_date', { ascending: true })
    if (error) return res.status(500).json({ error: error.message })
    res.json({ tasks: data || [], today })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/planner/completed-tasks', authMiddleware, async (req, res) => {
  try {
    if (!['planner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' })
    const today = getISTDate()
    const { data } = await supabase.from('tasks').select('*')
      .eq('planner_name', req.user.name)
      .eq('status', 'Completed')
      .eq('end_date', today)
      .order('completed_date', { ascending: false })
    res.json({ tasks: data || [], today })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Planner: Upload CSV
app.post('/api/planner/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!['planner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' })
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const uploadToken = generateUploadToken(req.user.id)
    const result = await runAutomationFromBuffer(req.file.buffer, req.user.name)
    await supabase.from('sync_logs').insert({
      file_name:    req.file.originalname,
      rows_synced:  result?.inserted || 0,
      status:       'success',
      uploaded_by:  req.user.name,
      planner_id:   req.user.id,
      upload_token: uploadToken,
    })
    res.json({ success: true, stats: result, upload_token: uploadToken })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Planner: Drive upload
app.post('/api/drive/upload', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    if (!['planner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' })
    if (!req.file) return res.status(400).json({ error: 'No file' })
    if (!hasOAuthToken()) return res.status(500).json({ error: 'Drive not connected. Visit /auth/google' })
    const plannerName = req.user.name
    const uploadToken = generateUploadToken(req.user.id)
    const driveFile   = await uploadFileToDrive(
      req.file.buffer, req.file.originalname,
      req.file.mimetype, process.env.GOOGLE_DRIVE_FOLDER_ID, plannerName
    )
    const result = await runAutomationFromBuffer(req.file.buffer, plannerName)
    await supabase.from('sync_logs').insert({
      file_name:     driveFile.name,
      rows_synced:   result?.inserted || 0,
      status:        'success',
      uploaded_by:   plannerName,
      planner_id:    req.user.id,
      upload_token:  uploadToken,
      drive_file_id: driveFile.id,
      drive_link:    driveFile.webViewLink,
    })
    res.json({ success: true, driveFile, stats: result, upload_token: uploadToken })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Planner: Notifications
app.get('/api/planner/notifications', authMiddleware, async (req, res) => {
  try {
    if (!['planner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' })
    const { data } = await supabase.from('notifications').select('*')
      .eq('planner_name', req.user.name)
      .order('created_at', { ascending: false }).limit(50)
    res.json({ notifications: data || [] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ════════════════════════════════════════════
// MANAGER / ADMIN REVIEW
// ════════════════════════════════════════════

// Pending submissions — admin only view
app.get('/api/manager/pending-submissions', authMiddleware, async (req, res) => {
  try {
    if (!['planner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' })
    const today = getISTDate()
    const { data } = await supabase.from('tasks').select('*')
      .eq('status', 'Submitted')
      .eq('end_date', today)
      .order('submitted_date', { ascending: false })
    res.json({ submissions: data || [] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Manager tasks overview
app.get('/api/manager/tasks', authMiddleware, async (req, res) => {
  try {
    if (!['planner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' })
    const today = getISTDate()
    const { data } = await supabase.from('tasks').select('*')
      .eq('end_date', today).order('end_date', { ascending: true })
    res.json({ tasks: data || [], today })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ★ Approve / Reject — ADMIN ONLY
app.post('/api/manager/review-submission', authMiddleware, async (req, res) => {
  try {
    // ★ Only admin can approve/reject
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only — planners cannot approve/reject' })
    const { taskId, action, feedback } = req.body
    if (!taskId || !['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid params' })

    const { data: task } = await supabase.from('tasks').select('*').eq('task_id', taskId).single()
    if (!task) return res.status(404).json({ error: 'Task not found' })

    const newStatus = action === 'approve' ? 'Completed' : 'Rejected'
    await supabase.from('tasks').update({
      status:           newStatus,
      completed_date:   action === 'approve' ? new Date().toISOString() : null,
      reviewed_by:      req.user.name,
      reviewed_date:    new Date().toISOString(),
      manager_note:     feedback || null,
      rejection_reason: action === 'reject' ? (feedback || 'Please revise and resubmit') : null,
    }).eq('task_id', taskId)

    // Notify designer
    await supabase.from('notifications').insert({
      designer_name: task.assigned_designer,
      planner_name:  task.planner_name,
      task_id:       taskId,
      message: action === 'approve'
        ? `✅ "${task.task_type}" for ${task.client_name} — Approved by Admin!`
        : `❌ "${task.task_type}" for ${task.client_name} — Rejected: ${feedback || 'Please resubmit'}`,
      type:       action === 'approve' ? 'approval' : 'rejection',
      is_read:    false,
      created_at: new Date().toISOString(),
    })

    // Notify planner
    await supabase.from('notifications').insert({
      planner_name: task.planner_name,
      task_id:      taskId,
      message: action === 'approve'
        ? `✅ Admin approved "${task.task_type}" for ${task.client_name}`
        : `❌ Admin rejected "${task.task_type}" for ${task.client_name}`,
      type:       action === 'approve' ? 'approval' : 'rejection',
      is_read:    false,
      created_at: new Date().toISOString(),
    })

    res.json({ success: true, new_status: newStatus })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Manager notifications
app.get('/api/manager/notifications', authMiddleware, async (req, res) => {
  try {
    if (!['planner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' })
    const { data } = await supabase.from('notifications').select('*')
      .or(`planner_name.eq.${req.user.name},planner_name.eq.admin`)
      .order('created_at', { ascending: false }).limit(50)
    res.json({ notifications: data || [] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ════════════════════════════════════════════
// ADMIN ROUTES
// ════════════════════════════════════════════

app.get('/api/admin/tasks', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
    const { data } = await supabase.from('tasks').select('*').order('end_date', { ascending: true })
    res.json({ tasks: data || [], today: getISTDate() })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/admin/designers', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
    const today = getISTDate()
    const { data: designers } = await supabase.from('profiles').select('*').eq('role', 'designer').order('name')
    const { data: tasks } = await supabase.from('tasks').select('assigned_designer, status, end_date')
      .in('status', ['Pending', 'Assigned', 'In Progress'])
    const workload = {}, urgent = {}
    tasks?.forEach(t => {
      if (!t.assigned_designer) return
      workload[t.assigned_designer] = (workload[t.assigned_designer] || 0) + 1
      if (t.end_date && t.end_date <= today) urgent[t.assigned_designer] = (urgent[t.assigned_designer] || 0) + 1
    })
    res.json({
      designers: (designers || []).map(d => ({
        ...d,
        current_workload: workload[d.name] || 0,
        urgent_tasks:     urgent[d.name]   || 0,
      }))
    })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/admin/planners', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
    const { data } = await supabase.from('profiles').select('*').eq('role', 'planner').order('name')
    res.json({ planners: data || [] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/admin/reassign', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
    const { taskId, designerId, designerName } = req.body
    await supabase.from('tasks').update({
      assigned_designer:    designerName,
      assigned_designer_id: designerId,
      status: 'Assigned',
    }).eq('task_id', taskId)
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/admin/upload-logs', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
    const { data } = await supabase.from('sync_logs').select('*').order('created_at', { ascending: false }).limit(50)
    res.json({ logs: data || [] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/admin/leave-requests', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
    const { data } = await supabase.from('leave_requests').select('*')
      .eq('status', 'pending').order('requested_at', { ascending: false })
    res.json({ leave_requests: data || [] })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.post('/api/admin/handle-leave', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' })
    const { requestId, action } = req.body
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid' })
    const { data: leave } = await supabase.from('leave_requests').select('*').eq('id', requestId).single()
    if (!leave) return res.status(404).json({ error: 'Not found' })

    await supabase.from('leave_requests').update({
      status:      action === 'approve' ? 'approved' : 'rejected',
      reviewed_by: req.user.name,
      reviewed_at: new Date().toISOString(),
    }).eq('id', requestId)

    if (action === 'approve') {
      const { data: tasks } = await supabase.from('tasks').select('*')
        .eq('assigned_designer', leave.designer_name)
        .in('status', ['Pending', 'Assigned', 'In Progress'])
        .or(`end_date.eq.${leave.leave_date},publish_date.eq.${leave.leave_date}`)
      const { data: others } = await supabase.from('profiles').select('*')
        .eq('role', 'designer').neq('id', leave.designer_id)

      if (others?.length && tasks?.length) {
        for (let i = 0; i < tasks.length; i++) {
          const task     = tasks[i]
          const isReel   = (task.task_type || '').toLowerCase().includes('reel')
          const reelOths = others.filter(d => REEL_DESIGNERS.includes(d.name))
          const target   = isReel && reelOths.length ? reelOths[i % reelOths.length] : others[i % others.length]
          if (target) {
            await supabase.from('tasks').update({
              assigned_designer:    target.name,
              assigned_designer_id: target.id,
              status: 'Assigned',
            }).eq('task_id', task.task_id)
            await supabase.from('notifications').insert({
              designer_name: target.name,
              message:       `🔄 "${task.task_type}" for ${task.client_name} reassigned to you (${leave.designer_name} on leave)`,
              is_read:       false,
              created_at:    new Date().toISOString(),
            })
          }
        }
      }
      await supabase.from('notifications').insert({
        designer_name: leave.designer_name,
        message:       `✅ Leave approved for ${leave.leave_date}. ${tasks?.length || 0} tasks reassigned.`,
        is_read:       false,
        created_at:    new Date().toISOString(),
      })
    } else {
      await supabase.from('notifications').insert({
        designer_name: leave.designer_name,
        message:       `❌ Leave for ${leave.leave_date} not approved. Contact admin.`,
        is_read:       false,
        created_at:    new Date().toISOString(),
      })
    }
    res.json({ success: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// Drive routes
app.get('/api/drive/folders', authMiddleware, async (req, res) => {
  try { res.json({ folders: await listFolders(req.query.parentId || null) }) }
  catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/drive/files', authMiddleware, async (req, res) => {
  try {
    const { folderId } = req.query
    if (!folderId) return res.status(400).json({ error: 'folderId required' })
    res.json({ files: await listFilesInFolder(folderId) })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

// ════════════════════════════════════════════
// CRON JOBS (UTC times for IST)
// ════════════════════════════════════════════

// Midnight IST = 18:30 UTC
cron.schedule('30 18 * * *', async () => {
  console.log('🌅 Midnight IST: updating is_today...')
  await updateIsTodayFlags()
}, { timezone: 'UTC' })

// 8 AM IST = 02:30 UTC — Morning task reminders
cron.schedule('30 2 * * *', async () => {
  const today = getISTDate()
  const { data: tasks } = await supabase.from('tasks').select('*')
    .or(`end_date.eq.${today},publish_date.eq.${today}`)
    .in('status', ['Pending', 'Assigned'])
  for (const task of tasks || []) {
    await supabase.from('notifications').insert({
      designer_name: task.assigned_designer,
      task_id:       task.task_id,
      message:       `📋 Today's task: "${task.task_type}" for ${task.client_name} — Due: ${task.end_date}`,
      type:          'daily_reminder',
      is_read:       false,
      created_at:    new Date().toISOString(),
    })
  }
  console.log(`🔔 8AM reminders: ${tasks?.length || 0} tasks`)
}, { timezone: 'UTC' })

// 9 AM IST = 03:30 UTC — 2-day deadline reminder
cron.schedule('30 3 * * *', async () => {
  const twoDays = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000))
  twoDays.setDate(twoDays.getDate() + 2)
  const twoDaysStr = twoDays.toISOString().split('T')[0]
  const { data: tasks } = await supabase.from('tasks').select('*')
    .eq('end_date', twoDaysStr).in('status', ['Pending', 'Assigned', 'In Progress'])
  for (const task of tasks || []) {
    await supabase.from('notifications').insert({
      designer_name: task.assigned_designer,
      task_id:       task.task_id,
      message:       `⏰ 2-day deadline: "${task.task_type}" for ${task.client_name} — Due: ${task.end_date}`,
      type:          'reminder',
      is_read:       false,
      created_at:    new Date().toISOString(),
    })
  }
  console.log(`⏰ 2-day reminders: ${tasks?.length || 0}`)
}, { timezone: 'UTC' })

// 10 AM IST = 04:30 UTC — No-show check & auto-reassign
cron.schedule('30 4 * * *', async () => {
  const today = getISTDate()
  console.log(`\n⚡ 10AM no-show check for ${today}...`)
  const { data: designers } = await supabase.from('profiles').select('*').eq('role', 'designer')

  for (const designer of designers || []) {
    const lastLoginDate = designer.last_login?.split('T')[0]
    if (lastLoginDate === today) continue

    const { data: leave } = await supabase.from('leave_requests').select('*')
      .eq('designer_id', designer.id).eq('leave_date', today).eq('status', 'approved').single()
    if (leave) continue

    const { data: tasks } = await supabase.from('tasks').select('*')
      .eq('assigned_designer', designer.name)
      .in('status', ['Pending', 'Assigned', 'In Progress'])
      .or(`end_date.eq.${today},publish_date.eq.${today}`)
    if (!tasks?.length) continue

    const { data: others } = await supabase.from('profiles').select('*')
      .eq('role', 'designer').neq('id', designer.id)
    if (!others?.length) continue

    for (let i = 0; i < tasks.length; i++) {
      const task     = tasks[i]
      const isReel   = (task.task_type || '').toLowerCase().includes('reel')
      const reelOths = others.filter(d => REEL_DESIGNERS.includes(d.name))
      const target   = isReel && reelOths.length ? reelOths[i % reelOths.length] : others[i % others.length]
      if (target) {
        await supabase.from('tasks').update({
          assigned_designer:    target.name,
          assigned_designer_id: target.id,
          status: 'Assigned',
        }).eq('task_id', task.task_id)
        await supabase.from('notifications').insert({
          designer_name: target.name,
          message:       `🔄 "${task.task_type}" for ${task.client_name} reassigned (${designer.name} no login by 10AM)`,
          is_read:       false,
          created_at:    new Date().toISOString(),
        })
      }
    }

    await supabase.from('notifications').insert({
      planner_name: 'admin',
      message:      `🚨 ${designer.name} didn't login by 10AM. ${tasks.length} tasks reassigned.`,
      is_read:      false,
      created_at:   new Date().toISOString(),
    })
    console.log(`  ✅ ${designer.name}: ${tasks.length} reassigned`)
  }
}, { timezone: 'UTC' })

// ★ 4 PM IST = 10:30 UTC — Deadline reminder to designer + planner + admin
cron.schedule('30 10 * * *', async () => {
  const today = getISTDate()
  console.log(`\n🔔 4PM deadline reminder check for ${today}...`)

  // Find pending tasks due today
  const { data: pendingTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('end_date', today)
    .in('status', ['Pending', 'Assigned', 'In Progress'])

  if (!pendingTasks?.length) {
    console.log('✅ All tasks submitted — no 4PM reminder needed')
    return
  }

  // Group by designer → notify each designer
  const byDesigner = {}
  pendingTasks.forEach(task => {
    if (!task.assigned_designer) return
    if (!byDesigner[task.assigned_designer]) byDesigner[task.assigned_designer] = []
    byDesigner[task.assigned_designer].push(task)
  })

  for (const [designerName, tasks] of Object.entries(byDesigner)) {
    await supabase.from('notifications').insert({
      designer_name: designerName,
      message:       `⏰ 4PM Reminder: ${tasks.length} task${tasks.length > 1 ? 's' : ''} still pending! Submit before 6 PM — ${tasks.map(t => t.client_name).join(', ')}`,
      type:          'deadline_reminder',
      is_read:       false,
      created_at:    new Date().toISOString(),
    })
    console.log(`  📨 Designer notified: ${designerName} (${tasks.length} tasks pending)`)
  }

  // Group by planner → notify each planner
  const byPlanner = {}
  pendingTasks.forEach(task => {
    if (!task.planner_name) return
    if (!byPlanner[task.planner_name]) byPlanner[task.planner_name] = []
    byPlanner[task.planner_name].push(task)
  })

  for (const [plannerName, tasks] of Object.entries(byPlanner)) {
    await supabase.from('notifications').insert({
      planner_name: plannerName,
      message:      `⚠️ 4PM Alert: ${tasks.length} task${tasks.length > 1 ? 's' : ''} still not submitted — ${tasks.map(t => `${t.client_name} (${t.assigned_designer})`).join(', ')}`,
      type:         'deadline_reminder',
      is_read:      false,
      created_at:   new Date().toISOString(),
    })
    console.log(`  📨 Planner notified: ${plannerName}`)
  }

  // Notify admin
  await supabase.from('notifications').insert({
    planner_name: 'admin',
    message:      `⚠️ 4PM Alert: ${pendingTasks.length} task${pendingTasks.length > 1 ? 's' : ''} pending submission today`,
    type:         'deadline_reminder',
    is_read:      false,
    created_at:   new Date().toISOString(),
  })

  console.log(`✅ 4PM reminders sent — ${pendingTasks.length} tasks pending`)
}, { timezone: 'UTC' })

// Every 30 min — Drive CSV check
cron.schedule('*/30 * * * *', async () => {
  console.log('⏰ Drive CSV check...')
  await runAutomation()
})

// ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000
app.listen(PORT, async () => {
  console.log(`\n🚀 Server running on port ${PORT}`)
  console.log(`   IST Today:    ${getISTDate()}`)
  console.log(`   Tomorrow:     ${getISTTomorrow()}`)
  console.log(`   After 4:30PM: ${isAfter430PM()}`)
  await updateIsTodayFlags()
  console.log(hasOAuthToken() ? '✅ Drive connected!' : '⚠️  Visit /auth/google')
})