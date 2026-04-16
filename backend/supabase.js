const { createClient } = require('@supabase/supabase-js')
require('dotenv').config()

// Use SERVICE_KEY for admin operations (create users, etc.)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // ← Change this!
)

module.exports = supabase