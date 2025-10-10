// server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();
const Brevo = require("@getbrevo/brevo"); // Brevo transactional email API

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------- Basic Routes ----------
app.get("/", (req, res) => res.send("Hotel Booking API is running..."));
app.get("/api/test", (req, res) => res.json({ status: "success", message: "Test route is working!" }));

// ---------- Database (PostgreSQL) ----------
const { Pool } = require("pg");
const path = require("path");
const fs = require("fs");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

console.log("📂 Using DATABASE_URL from env:", !!process.env.DATABASE_URL);
console.log("⚠️ BREVO_API_KEY is set:", !!process.env.BREVO_API_KEY);

// Helper wrappers for queries
async function queryAll(text, params = []) {
  const r = await pool.query(text, params);
  return r.rows;
}
async function queryOne(text, params = []) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}
async function queryRun(text, params = []) {
  // returns the full result (for checking rowCount / insert id where applicable)
  return pool.query(text, params);
}

// Initialize tables (similar schema to your earlier SQLite version)
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT,
        phone TEXT,
        room TEXT,
        guests INTEGER,
        check_in TEXT,
        check_out TEXT,
        status TEXT DEFAULT 'available',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE,
        status TEXT DEFAULT 'available'
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS lounge_bookings (
        id SERIAL PRIMARY KEY,
        name TEXT,
        email TEXT,
        phone TEXT,
        tableType TEXT,
        LoungeGuest INTEGER,
        date TEXT,
        time TEXT,
        message TEXT,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Initialize rooms 1–5
    const defaultRooms = ["Room 1", "Room 2", "Room 3", "Room 4", "Room 5"];
    for (const room of defaultRooms) {
      await pool.query(
        `INSERT INTO rooms (name, status) VALUES ($1, 'available') ON CONFLICT (name) DO NOTHING`,
        [room]
      );
    }

    console.log("✅ PostgreSQL tables ready!");
  } catch (err) {
    console.error("❌ DB initialization error:", err);
  }
}
initDB().catch((e) => console.error("initDB failed:", e));

// ---------- Brevo Setup ----------
const brevoClient = new Brevo.TransactionalEmailsApi();

if (!process.env.BREVO_API_KEY) {
  console.warn("⚠️ BREVO_API_KEY is not set. Emails will fail.");
} else {
  brevoClient.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
}

// ---------- Email Sender Helper ----------
async function sendTransacEmail({ fromEmail, toEmails = [], subject = "", htmlContent = "", textContent = "" }) {
  if (!process.env.BREVO_API_KEY) {
    throw new Error("Brevo client not configured (missing BREVO_API_KEY)");
  }

  const payload = {
    sender: { email: fromEmail },
    to: toEmails.map(email => ({ email })),
    subject,
  };

  if (htmlContent) payload.htmlContent = htmlContent;
  if (textContent) payload.textContent = textContent;

  return brevoClient.sendTransacEmail(payload);
}

// ---------- Contact Email Logic ----------
async function sendContactEmails(name, email, message) {
  const from = process.env.EMAIL_FROM || process.env.ADMIN_EMAIL;
  const admin = process.env.ADMIN_EMAIL;

  try {
    // Send to hotel/admin
    await sendTransacEmail({
      fromEmail: from,
      toEmails: [admin],
      subject: `📩 New Contact Message from ${name}`,
      htmlContent: `
        <h3>New Contact Form Submission</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong></p>
        <p>${message}</p>
      `
    });
    console.log("✅ Contact email sent to admin:", admin);

    // Auto reply to client
    await sendTransacEmail({
      fromEmail: from,
      toEmails: [email],
      subject: `Thanks for contacting ${process.env.HOTEL_NAME || "Minista of Enjoyment Hotel"}`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif">
          <h3>Hi ${name},</h3>
          <p>We’ve received your message and will respond as soon as possible.</p>
          <p>— ${process.env.HOTEL_NAME || "Minista of Enjoyment Hotel"}</p>
        </div>
      `
    });
    console.log("✅ Auto reply sent to client:", email);
  } catch (err) {
    console.error("❌ Email error (contact):", err && (err.response?.text || err.message || err));
  }
}

// ---------- Booking Email Logic ----------
async function sendBookingEmails(name, email, phone, room, guests, checkIn, checkOut) {
  const from = process.env.EMAIL_FROM || process.env.ADMIN_EMAIL;
  const admin = process.env.ADMIN_EMAIL;

  // --- Email to admin ---
  await sendTransacEmail({
    fromEmail: from,
    toEmails: [admin],
    subject: `New Booking Received from ${name}`,
    textContent: `New booking details:
Name: ${name}
Email: ${email}
Phone: ${phone}
Room: ${room}
Guests: ${guests}
Check-in: ${checkIn}
Check-out: ${checkOut}`,
    htmlContent: `
      <div style="font-family:Arial,sans-serif">
        <h3>New Booking Received</h3>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Room:</strong> ${room}</p>
        <p><strong>Guests:</strong> ${guests}</p>
        <p><strong>Check-in:</strong> ${checkIn}</p>
        <p><strong>Check-out:</strong> ${checkOut}</p>
      </div>`
  });

  // --- Auto reply to guest ---
  await sendTransacEmail({
    fromEmail: from,
    toEmails: [email],
    subject: `Booking Confirmation — ${process.env.HOTEL_NAME || "Minista of Enjoyment Hotel"}`,
    textContent: `Hello ${name},

Thank you for booking with ${process.env.HOTEL_NAME || "Minista of Enjoyment Hotel"}.
Here are your booking details:

Room: ${room}
Guests: ${guests}
Check-in: ${checkIn}
Check-out: ${checkOut}

We look forward to your stay!

— ${process.env.HOTEL_NAME || "Minista of Enjoyment Hotel"}`,
    htmlContent: `
      <div style="font-family:Arial,sans-serif">
        <h3>Hello ${name},</h3>
        <p>Thank you for booking with <strong>${process.env.HOTEL_NAME || "Minista of Enjoyment Hotel"}</strong>.</p>
        <p>Here are your booking details:</p>
        <ul>
          <li><strong>Room:</strong> ${room}</li>
          <li><strong>Guests:</strong> ${guests}</li>
          <li><strong>Check-in:</strong> ${checkIn}</li>
          <li><strong>Check-out:</strong> ${checkOut}</li>
        </ul>
        <p>We look forward to your stay!</p>
        <p>— ${process.env.HOTEL_NAME || "Minister of Enjoyment Hotel"}</p>
      </div>`
  });
}

// ---------- PUBLIC ROUTES ----------

// Contact endpoint
app.post("/contact", async (req, res) => {
  try {
    const { name = "", email = "", message = "" } = req.body;

    // Save to DB (Postgres)
    await queryRun(`INSERT INTO contacts (name, email, message) VALUES ($1, $2, $3)`, [name, email, message]);

    // Attempt to send emails (Brevo)
    try {
      await sendContactEmails(name, email, message);
      console.log("✅ Contact emails sent");
    } catch (err) {
      console.error("❌ Contact email error:", err && err.message ? err.message : err);
      // continue — DB saved regardless
    }

    return res.json({ success: true, message: "Contact saved" });
  } catch (err) {
    console.error("❌ /contact error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Booking endpoint
app.post("/book", async (req, res) => {
  try {
    const {
      name = "",
      email = "",
      phone = "",
      room = "Not specified",
      checkIn = "",
      checkOut = "",
      guests = 1,
    } = req.body;

    // Insert booking into the database (Postgres)
    await queryRun(
      `INSERT INTO bookings (name, email, phone, room, guests, check_in, check_out)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, email, phone, room, guests, checkIn, checkOut]
    );
    console.log(`✅ Booking saved for ${name}`);

    // Attempt to send booking emails (Brevo)
    try {
      await sendBookingEmails(name, email, phone, room, guests, checkIn, checkOut);
      console.log("✅ Booking emails sent successfully");
      return res.json({ success: true, message: "Booking saved & email sent" });
    } catch (err) {
      console.error("❌ Email error (booking):", err && err.message ? err.message : err);
      // Still succeed for booking saved even if email fails
      return res.json({ success: true, message: "Booking saved (email failed to send)" });
    }

  } catch (err) {
    console.error("❌ /book error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ---------- Lounge Booking Route ----------
app.post("/lounge", async (req, res) => {
  const { name, email, phone, tableType, LoungeGuest, date, time, message } = req.body;

  if (!name || !email || !phone || !tableType || !LoungeGuest || !date || !time) {
    return res.json({ success: false, message: "All required fields must be filled." });
  }

  console.log("📥 Lounge booking received:", req.body);

  try {
    // Save to database (Postgres)
    await queryRun(
      `INSERT INTO lounge_bookings (name, email, phone, tableType, LoungeGuest, date, time, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [name, email, phone, tableType, LoungeGuest, date, time, message]
    );

    // --- ADMIN EMAIL (via Brevo helper) ---
    const from = process.env.EMAIL_FROM || process.env.ADMIN_EMAIL;
    const admin = process.env.ADMIN_EMAIL;

    // Admin notification
    await sendTransacEmail({
      fromEmail: from,
      toEmails: [admin],
      subject: `🎉 New Lounge Booking: ${tableType}`,
      htmlContent: `
        <h2>New Lounge Booking</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Phone:</strong> ${phone}</p>
        <p><strong>Booking Type:</strong> ${tableType}</p>
        <p><strong>Guest Number:</strong> ${LoungeGuest}</p>
        <p><strong>Date:</strong> ${date}</p>
        <p><strong>Time:</strong> ${time}</p>
        <p><strong>Message:</strong> ${message || "No message provided"}</p>
      `,
      textContent: `Lounge booking: ${tableType} - ${name} - ${email} - ${phone} - ${LoungeGuest} - ${date} ${time}`
    });

    // --- AUTO REPLY TO CLIENT ---
    await sendTransacEmail({
      fromEmail: from,
      toEmails: [email],
      subject: `🍸 Lounge Booking Confirmation — ${process.env.HOTEL_NAME || "Minista of Enjoyment Hotel"}`,
      htmlContent: `
        <h3>Hi ${name},</h3>
        <p>We’ve received your lounge booking request for <strong>${tableType}</strong> on <strong>${date}</strong> at <strong>${time}</strong>.</p>
        <p>Our team will contact you shortly to confirm your reservation.</p>
        <p>— ${process.env.HOTEL_NAME || "Minista of Enjoyment Lounge and Suite"}</p>
      `,
      textContent: `Hi ${name}, we received your lounge booking for ${tableType} on ${date} at ${time}. We'll contact you to confirm.`
    });

    console.log(`✅ Lounge booking saved for ${name} (${tableType} on ${date} ${time})`);
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving lounge booking:", err && (err.message || err));
    return res.json({ success: false, message: "Server error" });
  }
});

// ---------- ADMIN (simple) ----------
let isLoggedIn = false;

app.get("/admin/login", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Admin Login</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="d-flex justify-content-center align-items-center vh-100 bg-light">
        <div class="card shadow-lg" style="width: 400px;">
          <div class="card-body">
            <h2 class="text-center mb-4">🔐 Admin Login</h2>
            <form method="POST" action="/admin/login">
              <div class="mb-3"><input type="text" name="username" class="form-control" placeholder="Username" required></div>
              <div class="mb-3"><input type="password" name="password" class="form-control" placeholder="Password" required></div>
              <button type="submit" class="btn btn-primary w-100">Login</button>
            </form>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  const ADMIN_USER = process.env.ADMIN_USER || "Minista of enjoyment";
  const ADMIN_PASS = process.env.ADMIN_PASS || "6776";

  if (username === ADMIN_USER && password === ADMIN_PASS) {
    isLoggedIn = true;
    return res.redirect("/admin/bookings");
  }
  return res.send("<h2>❌ Invalid credentials. <a href='/admin/login'>Try again</a></h2>");
});

app.get("/admin/logout", (req, res) => {
  isLoggedIn = false;
  res.send("<h2>✅ Logged out. <a href='/admin/login'>Login again</a></h2>");
});

function requireLogin(req, res, next) {
  if (isLoggedIn) return next();
  res.redirect("/admin/login");
}

function renderPage(title, heading, headers, rows) {
  return `
    <html>
      <head>
        <title>${title}</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="container py-4">
        <nav class="mb-4">
          <a href="/admin/bookings" class="btn btn-primary me-2">📑 Bookings</a>
          <a href="/admin/rooms" class="btn btn-success me-2">🏨 Rooms</a>
          <a href="/admin/contacts" class="btn btn-info me-2">📧 Contacts</a>
          <a href="/admin/logout" class="btn btn-danger">🚪 Logout</a>
        </nav>
        <h1 class="mb-4">${heading}</h1>
        <div class="table-responsive">
          <table class="table table-striped table-bordered align-middle">
            <thead class="table-dark">
              <tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

// Bookings for admin
app.get("/admin/bookings", requireLogin, async (req, res) => {
  try {
    const rows = await queryAll("SELECT * FROM bookings ORDER BY created_at DESC");
    const rowsHtml = rows.map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${r.name}</td>
        <td>${r.email}</td>
        <td>${r.phone}</td>
        <td>${r.room}</td>
        <td>${r.guests}</td>
        <td>${r.check_in}</td>
        <td>${r.check_out}</td>
        <td>${r.status || "available"}</td>
        <td>${r.created_at}</td>
        <td>
          <form method="POST" action="/admin/bookings/toggle/${r.id}" style="display:inline;">
            <button type="submit" class="btn btn-sm ${r.status === "booked" ? "btn-secondary" : "btn-success"}">${r.status === "booked" ? "Mark Available" : "Mark Booked"}</button>
          </form>
          <form method="POST" action="/admin/bookings/delete/${r.id}" style="display:inline;" onsubmit="return confirm('Delete this booking?');">
            <button type="submit" class="btn btn-sm btn-danger">Delete</button>
          </form>
          <form method="GET" action="/admin/bookings/edit/${r.id}" style="display:inline;">
            <button type="submit" class="btn btn-sm btn-warning">Edit</button>
          </form>
        </td>
      </tr>`).join("");
    res.send(renderPage("Bookings", "📑 All Bookings", ["ID","Name","Email","Phone","Room","Guests","Check-in","Check-out","Status","Created","Actions"], rowsHtml));
  } catch (err) {
    console.error("❌ Admin bookings error:", err);
    res.status(500).send("Error loading bookings");
  }
});

// Delete booking
app.post("/admin/bookings/delete/:id", requireLogin, async (req, res) => {
  try {
    await queryRun("DELETE FROM bookings WHERE id = $1", [req.params.id]);
    res.redirect("/admin/bookings");
  } catch (err) {
    console.error("❌ Delete error:", err);
    res.status(500).send("Error deleting booking");
  }
});

// Edit booking (GET + POST)
app.get("/admin/bookings/edit/:id", requireLogin, async (req, res) => {
  try {
    const row = await queryOne("SELECT * FROM bookings WHERE id = $1", [req.params.id]);
    if (!row) return res.status(404).send("<h1>Booking not found</h1>");
    res.send(`
      <html>
        <head><title>Edit Booking</title></head>
        <body style="font-family:Arial; padding:20px;">
          <h2>Edit Booking ID: ${row.id}</h2>
          <form method="POST" action="/admin/bookings/edit/${row.id}">
            <input type="text" name="name" value="${row.name}" required/><br/><br/>
            <input type="email" name="email" value="${row.email}" required/><br/><br/>
            <input type="text" name="phone" value="${row.phone}" required/><br/><br/>
            <input type="text" name="room" value="${row.room}" required/><br/><br/>
            <input type="number" name="guests" value="${row.guests}" required/><br/><br/>
            <input type="date" name="check_in" value="${row.check_in}" required/><br/><br/>
            <input type="date" name="check_out" value="${row.check_out}" required/><br/><br/>
            <button type="submit">Save Changes</button>
          </form>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Edit booking page error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/bookings/edit/:id", requireLogin, async (req, res) => {
  try {
    const { name, email, phone, room, guests, check_in, check_out } = req.body;
    await queryRun(
      `UPDATE bookings SET name=$1, email=$2, phone=$3, room=$4, guests=$5, check_in=$6, check_out=$7 WHERE id=$8`,
      [name, email, phone, room, guests, check_in, check_out, req.params.id]
    );
    res.redirect("/admin/bookings");
  } catch (err) {
    console.error("❌ Update booking error:", err);
    res.status(500).send("Error updating booking");
  }
});

// Contacts admin
app.get("/admin/contacts", requireLogin, async (req, res) => {
  try {
    const rows = await queryAll("SELECT * FROM contacts ORDER BY created_at DESC");
    const rowsHtml = rows.map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${r.name}</td>
        <td>${r.email}</td>
        <td>${r.message}</td>
        <td>${r.created_at}</td>
        <td>
          <form method="POST" action="/admin/contacts/delete/${r.id}" style="display:inline;" onsubmit="return confirm('Delete this contact?');">
            <button type="submit" class="btn btn-sm btn-danger">Delete</button>
          </form>
          <form method="GET" action="/admin/contacts/edit/${r.id}" style="display:inline;">
            <button type="submit" class="btn btn-sm btn-warning">Edit</button>
          </form>
        </td>
      </tr>`).join("");
    res.send(renderPage("Contacts", "📧 All Contacts", ["ID","Name","Email","Message","Created","Actions"], rowsHtml));
  } catch (err) {
    console.error("❌ Admin contacts error:", err);
    res.status(500).send("Error loading contacts");
  }
});

app.post("/admin/contacts/delete/:id", requireLogin, async (req, res) => {
  try {
    await queryRun("DELETE FROM contacts WHERE id = $1", [req.params.id]);
    res.redirect("/admin/contacts");
  } catch (err) {
    console.error("❌ Delete contact error:", err);
    res.status(500).send("Error deleting contact");
  }
});

app.get("/admin/contacts/edit/:id", requireLogin, async (req, res) => {
  try {
    const row = await queryOne("SELECT * FROM contacts WHERE id = $1", [req.params.id]);
    if (!row) return res.status(404).send("<h1>Contact not found</h1>");
    res.send(`
      <html>
        <head><title>Edit Contact</title></head>
        <body style="font-family:Arial; padding:20px;">
          <h2>Edit Contact ID: ${row.id}</h2>
          <form method="POST" action="/admin/contacts/edit/${row.id}">
            <input type="text" name="name" value="${row.name}" required/><br/><br/>
            <input type="email" name="email" value="${row.email}" required/><br/><br/>
            <textarea name="message" required>${row.message}</textarea><br/><br/>
            <button type="submit">Save Changes</button>
          </form>
        </body>
      </html>
    `);
  } catch (err) {
    console.error("❌ Edit contact page error:", err);
    res.status(500).send("Server error");
  }
});

app.post("/admin/contacts/edit/:id", requireLogin, async (req, res) => {
  try {
    const { name, email, message } = req.body;
    await queryRun(`UPDATE contacts SET name=$1, email=$2, message=$3 WHERE id=$4`, [name, email, message, req.params.id]);
    res.redirect("/admin/contacts");
  } catch (err) {
    console.error("❌ Update contact error:", err);
    res.status(500).send("Error updating contact");
  }
});

// ---------- Room Booking Status Feature ----------
// Ensure 'status' column exists in bookings table (Postgres supports IF NOT EXISTS for add column)
(async () => {
  try {
    await queryRun(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'available'`);
  } catch (e) {
    console.warn("⚠️ Could not ALTER bookings table:", e.message || e);
  }
})();

// Show status column in admin bookings page (already handled above)

// Toggle booking status + sync with rooms table
app.post("/admin/bookings/toggle/:id", requireLogin, async (req, res) => {
  try {
    const booking = await queryOne("SELECT status, room FROM bookings WHERE id = $1", [req.params.id]);
    if (!booking) return res.status(404).send("Booking not found");

    const newStatus = booking.status === "booked" ? "available" : "booked";

    // Update the booking itself
    await queryRun("UPDATE bookings SET status = $1 WHERE id = $2", [newStatus, req.params.id]);

    // Also update the room table so frontend reflects the same status
    await queryRun("UPDATE rooms SET status = $1 WHERE name = $2", [newStatus, booking.room]);

    console.log(`✅ Booking ID ${req.params.id} marked as ${newStatus}`);
    res.redirect("/admin/bookings");
  } catch (err) {
    console.error("❌ Toggle booking status sync error:", err);
    res.status(500).send("Error toggling booking status");
  }
});

// API endpoint to get current room status (for frontend)
app.get("/api/rooms/status", async (req, res) => {
  try {
    const rows = await queryAll("SELECT name, status FROM rooms");
    console.log("📡 Room status data:", rows);
    res.json({ success: true, rooms: rows });
  } catch (err) {
    console.error("Error fetching room status:", err);
    res.status(500).json({ success: false, message: "Error fetching room status" });
  }
});

// ---------- ADMIN: Room Management ----------
app.get("/admin/rooms", requireLogin, async (req, res) => {
  try {
    const rows = await queryAll("SELECT * FROM rooms ORDER BY id ASC");
    const rowsHtml = rows.map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${r.name}</td>
        <td>${r.status}</td>
        <td>
          <form method="POST" action="/admin/rooms/toggle/${r.id}" style="display:inline;">
            <button type="submit" class="btn btn-sm ${r.status === 'booked' ? 'btn-secondary' : 'btn-success'}">
              ${r.status === 'booked' ? 'Mark Available' : 'Mark Booked'}
            </button>
          </form>
        </td>
      </tr>`).join("");

    res.send(renderPage("Rooms", "🏨 Manage Rooms", ["ID", "Room Name", "Status", "Actions"], rowsHtml));
  } catch (err) {
    console.error("❌ Admin rooms error:", err);
    res.status(500).send("Error loading rooms");
  }
});

// Toggle room status
app.post("/admin/rooms/toggle/:id", requireLogin, async (req, res) => {
  try {
    const row = await queryOne("SELECT status FROM rooms WHERE id = $1", [req.params.id]);
    if (!row) return res.status(404).send("Room not found");
    const newStatus = row.status === "booked" ? "available" : "booked";
    await queryRun("UPDATE rooms SET status = $1 WHERE id = $2", [newStatus, req.params.id]);
    console.log(`✅ Room ID ${req.params.id} marked as ${newStatus}`);
    res.redirect("/admin/rooms");
  } catch (err) {
    console.error("❌ Toggle room status error:", err);
    res.status(500).send("Error toggling room status");
  }
});

// API endpoint for frontend to check booked rooms (same as /api/rooms/status above)

// diagnostic logs
console.log("💾 Pool config present:", !!process.env.DATABASE_URL);

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Running at http://localhost:${PORT}`));
