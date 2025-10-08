// server.js
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();
const sqlite3 = require("sqlite3").verbose();
const Brevo = require("@getbrevo/brevo"); // Brevo transactional email API

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------- Basic Routes ----------
app.get("/", (req, res) => res.send("Hotel Booking API is running..."));
app.get("/api/test", (req, res) => res.json({ status: "success", message: "Test route is working!" }));

// ---------- Database ----------
// DATABASE CONNECTION
const db = new sqlite3.Database("./hotel.db", (err) => {
  if (err) {
    console.error("❌ Database error:", err.message);
  } else {
    console.log("✅ Connected to SQLite database");
  }
});

// CREATE TABLES
db.serialize(() => {
  // Contact messages
  db.run(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Room bookings
  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      phone TEXT,
      room TEXT,
      guests INTEGER,
      check_in TEXT,
      check_out TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Manual room status tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      status TEXT DEFAULT 'available'
    )
  `);
  db.run(`
  CREATE TABLE IF NOT EXISTS lounge_bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    phone TEXT,
    tableType TEXT,
    date TEXT,
    time TEXT,
    message TEXT
  )
`);

  // Initialize rooms 1–5
  const defaultRooms = ["Room 1", "Room 2", "Room 3", "Room 4", "Room 5"];
  defaultRooms.forEach((room) => {
    db.run(
      `INSERT OR IGNORE INTO rooms (name, status) VALUES (?, 'available')`,
      [room],
      (err) => {
        if (err) console.error("Room insert error:", err.message);
      }
    );
  });
});


// ---------- Promise Wrappers ----------
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

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
    console.error("❌ Email error (contact):", err.response?.text || err.message);
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

    // Save to DB
    await dbRun(`INSERT INTO contacts (name, email, message) VALUES (?, ?, ?)`, [name, email, message]);

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

    // Insert booking into the database
    await dbRun(
      `INSERT INTO bookings (name, email, phone, room, guests, check_in, check_out)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
import Brevo from "@getbrevo/brevo"; // make sure this import or require exists at the top if using ES modules

app.post("/lounge", async (req, res) => {
  const { name, email, phone, eventType, guests, date, message } = req.body;

  try {
    const client = new Brevo.TransactionalEmailsApi();
    client.authentications["apiKey"].apiKey = process.env.BREVO_API_KEY;

    // 1️⃣ Admin Notification (exact same format)
    await client.sendTransacEmail({
      sender: { email: "no-reply@yourdomain.com", name: "Hotel Lounge Booking" },
      to: [{ email: process.env.ADMIN_EMAIL, name: "Admin" }],
      subject: New Lounge Booking Request from ${name},
      htmlContent: `
        <h3>New Lounge Booking</h3>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Phone:</b> ${phone}</p>
        <p><b>Event Type:</b> ${eventType}</p>
        <p><b>Guests:</b> ${guests}</p>
        <p><b>Date:</b> ${date}</p>
        <p><b>Message:</b> ${message}</p>
      `,
    });

    // 2️⃣ Auto Reply (same tone and design)
    await client.sendTransacEmail({
      sender: { email: "no-reply@yourdomain.com", name: "Hotel Lounge Booking" },
      to: [{ email, name }],
      subject: "Lounge Booking Request Received",
      htmlContent: `
        <p>Dear ${name},</p>
        <p>Thank you for your interest in our lounge. We’ve received your booking request for <b>${eventType}</b> on <b>${date}</b>. Our events team will contact you shortly to confirm your reservation.</p>
        <p>Kind regards,<br>The Hotel Lounge Team</p>
      `,
    });

    console.log(✅ Lounge booking email sent for ${name});
    res.json({ success: true, message: "Booking request sent successfully!" });
  } catch (error) {
    console.error("❌ Lounge booking failed:", error);
    res.status(500).json({ success: false, message: "Could not send booking request" });
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
  // Set credentials via environment if you like, otherwise default below:
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
    const rows = await dbAll("SELECT * FROM bookings ORDER BY created_at DESC");
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
        <td>${r.created_at}</td>
        <td>
          <form method="POST" action="/admin/bookings/delete/${r.id}" style="display:inline;" onsubmit="return confirm('Delete this booking?');">
            <button type="submit" class="btn btn-sm btn-danger">Delete</button>
          </form>
          <form method="GET" action="/admin/bookings/edit/${r.id}" style="display:inline;">
            <button type="submit" class="btn btn-sm btn-warning">Edit</button>
          </form>
        </td>
      </tr>`).join("");
    res.send(renderPage("Bookings", "📑 All Bookings", ["ID","Name","Email","Phone","Room","Guests","Check-in","Check-out","Created","Actions"], rowsHtml));
  } catch (err) {
    console.error("❌ Admin bookings error:", err);
    res.status(500).send("Error loading bookings");
  }
});

// Delete booking
app.post("/admin/bookings/delete/:id", requireLogin, (req, res) => {
  db.run("DELETE FROM bookings WHERE id = ?", [req.params.id], function (err) {
    if (err) {
      console.error("❌ Delete error:", err.message);
      return res.status(500).send("Error deleting booking");
    }
    res.redirect("/admin/bookings");
  });
});

// Edit booking (GET + POST)
app.get("/admin/bookings/edit/:id", requireLogin, async (req, res) => {
  try {
    const row = await dbGet("SELECT * FROM bookings WHERE id = ?", [req.params.id]);
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

app.post("/admin/bookings/edit/:id", requireLogin, (req, res) => {
  const { name, email, phone, room, guests, check_in, check_out } = req.body;
  db.run(`UPDATE bookings SET name=?, email=?, phone=?, room=?, guests=?, check_in=?, check_out=? WHERE id=?`,
    [name, email, phone, room, guests, check_in, check_out, req.params.id],
    (err) => {
      if (err) {
        console.error("❌ Update booking error:", err);
        return res.status(500).send("Error updating booking");
      }
      res.redirect("/admin/bookings");
    }
  );
});

// Contacts admin
app.get("/admin/contacts", requireLogin, async (req, res) => {
  try {
    const rows = await dbAll("SELECT * FROM contacts ORDER BY created_at DESC");
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

app.post("/admin/contacts/delete/:id", requireLogin, (req, res) => {
  db.run("DELETE FROM contacts WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send("Error deleting contact");
    res.redirect("/admin/contacts");
  });
});

app.get("/admin/contacts/edit/:id", requireLogin, async (req, res) => {
  try {
    const row = await dbGet("SELECT * FROM contacts WHERE id = ?", [req.params.id]);
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

app.post("/admin/contacts/edit/:id", requireLogin, (req, res) => {
  const { name, email, message } = req.body;
  db.run(`UPDATE contacts SET name=?, email=?, message=? WHERE id=?`, [name, email, message, req.params.id], (err) => {
    if (err) return res.status(500).send("Error updating contact");
    res.redirect("/admin/contacts");
  });
});
// ---------- Room Booking Status Feature ----------

// Ensure 'status' column exists in bookings table
db.run(`ALTER TABLE bookings ADD COLUMN status TEXT DEFAULT 'available'`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.error("⚠️ Couldn't add status column:", err.message);
  }
});

// Show status column in admin bookings page
app.get("/admin/bookings", requireLogin, async (req, res) => {
  try {
    const rows = await dbAll("SELECT * FROM bookings ORDER BY created_at DESC");
    const rowsHtml = rows
      .map(
        (r) => `
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
            <button type="submit" class="btn btn-sm ${
              r.status === "booked" ? "btn-secondary" : "btn-success"
            }">${r.status === "booked" ? "Mark Available" : "Mark Booked"}</button>
          </form>
          <form method="POST" action="/admin/bookings/delete/${r.id}" style="display:inline;" onsubmit="return confirm('Delete this booking?');">
            <button type="submit" class="btn btn-sm btn-danger">Delete</button>
          </form>
          <form method="GET" action="/admin/bookings/edit/${r.id}" style="display:inline;">
            <button type="submit" class="btn btn-sm btn-warning">Edit</button>
          </form>
        </td>
      </tr>`
      )
      .join("");
    res.send(
      renderPage(
        "Bookings",
        "📑 All Bookings",
        ["ID","Name","Email","Phone","Room","Guests","Check-in","Check-out","Status","Created","Actions"],
        rowsHtml
      )
    );
  } catch (err) {
    console.error("❌ Admin bookings error:", err);
    res.status(500).send("Error loading bookings");
  }
});

// Toggle booking status
// Toggle booking status + sync with rooms table
app.post("/admin/bookings/toggle/:id", requireLogin, async (req, res) => {
  try {
    const booking = await dbGet("SELECT status, room FROM bookings WHERE id = ?", [req.params.id]);
    if (!booking) return res.status(404).send("Booking not found");

    const newStatus = booking.status === "booked" ? "available" : "booked";

    // Update the booking itself
    await dbRun("UPDATE bookings SET status = ? WHERE id = ?", [newStatus, req.params.id]);

    // Also update the room table so frontend reflects the same status
    await dbRun("UPDATE rooms SET status = ? WHERE name = ?", [newStatus, booking.room]);

    console.log('✅ Booking ID ${req.params.id} marked as ${newStatus}');
    res.redirect("/admin/bookings");
  } catch (err) {
    console.error("❌ Toggle booking status sync error:", err);
    res.status(500).send("Error toggling booking status");
  }
});

// API endpoint to get current room status (for frontend)
app.get("/api/rooms/status", async (req, res) => {
  try {
    const rooms = await dbAll("SELECT name, status FROM rooms");
    res.json({ success: true, rooms });
  } catch (err) {
    console.error("Error fetching room status:", err);
    res.status(500).json({ success: false, message: "Error fetching room status" });
  }
});
// ---------- ADMIN: Room Management ----------
app.get("/admin/rooms", requireLogin, async (req, res) => {
  try {
    const rows = await dbAll("SELECT * FROM rooms ORDER BY id ASC");
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
    const room = await dbGet("SELECT status FROM rooms WHERE id = ?", [req.params.id]);
    if (!room) return res.status(404).send("Room not found");
    const newStatus = room.status === "booked" ? "available" : "booked";
    await dbRun("UPDATE rooms SET status = ? WHERE id = ?", [newStatus, req.params.id]);
    console.log(`✅ Room ID ${req.params.id} marked as ${newStatus}`);
    res.redirect("/admin/rooms");
  } catch (err) {
    console.error("❌ Toggle room status error:", err);
    res.status(500).send("Error toggling room status");
  }
});

// API endpoint for frontend to check booked rooms
// ✅ Get all room statuses
app.get("/api/rooms/status", (req, res) => {
  db.all("SELECT name, status FROM rooms", (err, rows) => {
    if (err) {
      console.error("❌ Error fetching room status:", err.message);
      return res.json({ success: false });
    }

    // Log data for debugging
    console.log("📡 Room status data:", rows);

    res.json({ success: true, rooms: rows });
  });
});

// ---------- Start server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Running at http://localhost:${PORT}`));
