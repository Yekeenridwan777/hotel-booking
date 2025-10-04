const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
require("dotenv").config();
const nodemailer = require("nodemailer");
const sqlite3 = require("sqlite3").verbose();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.get("/", (req, res) => {
  res.send("Hotel Booking API is running...");
});
// ✅ Connect or create database
const db = new sqlite3.Database("./hotel.db", (err) => {
  if (err) console.error("❌ Database error:", err.message);
  else console.log("✅ Connected to SQLite database");
});

// ✅ Create tables if not exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    phone TEXT,
    room TEXT,
    guests INTEGER,
    check_in TEXT,
    check_out TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ✅ Setup Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  secure: false, // false for port 587
  tls: {
    rejectUnauthorized: false, // avoid self-signed cert issues
  },
});

// ----------------- PUBLIC ROUTES -----------------

// 📩 Contact form
app.post("/contact", async (req, res) => {
  const { name, email, message } = req.body;

  db.run(
    `INSERT INTO contacts (name, email, message) VALUES (?, ?, ?)`,
    [name, email, message],
    (err) => {
      if (err) console.error("❌ DB Save Error (contact):", err.message);
      else console.log("✅ Contact saved");
    }
  );

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `New Contact from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nMessage: ${message}`,
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Thank you for contacting Minister of Enjoyment Hotel",
      html: `<h2>Dear ${name},</h2><p>We got your message and will respond soon.</p>`,
    });

    res.json({ success: true, message: "✅ Contact saved & email sent" });
  } catch (error) {
    console.error("❌ Email error (contact):", error);
    res.json({ success: false, message: "❌ Error sending contact email" });
  }
});

// 📩 Booking form
app.post("/book", async (req, res) => {
  const {
    name = "",
    email = "",
    phone = "",
    room = "Not specified",
    checkIn = "",
    checkOut = "",
    guests = 1,
  } = req.body;

  db.run(
    `INSERT INTO bookings (name, email, phone, room, guests, check_in, check_out) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, email, phone, room, guests, checkIn, checkOut],
    (err) => {
      if (err) {
        console.error("❌ DB Save Error (booking):", err.message);
        return res.json({ success: false, message: "❌ Database error" });
      }
      console.log(`✅ Booking saved for ${name}`);
    }
  );

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_USER,
      subject: `New Booking Request from ${name}`,
      text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone}\nRoom: ${room}\nGuests: ${guests}\nCheck-in: ${checkIn}\nCheck-out: ${checkOut}`,
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Your Booking Request at Minister of Enjoyment Hotel",
      html: `<h2>Hello ${name},</h2><p>We received your booking for <b>${room}</b> from <b>${checkIn}</b> to <b>${checkOut}</b> for <b>${guests} guest(s)</b>.</p>`,
    });

    res.json({ success: true, message: "✅ Booking saved & email sent" });
  } catch (error) {
    console.error("❌ Email error (booking):", error);
    res.json({ success: false, message: "❌ Error sending booking email" });
  }
});

// ----------------- ADMIN SECTION -----------------

let isLoggedIn = false;

// Login page
app.get("/admin/login", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Admin Login</title>
        <!-- ✅ Bootstrap CSS -->
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="d-flex justify-content-center align-items-center vh-100 bg-light">
        <div class="card shadow-lg" style="width: 400px;">
          <div class="card-body">
            <h2 class="text-center mb-4">🔐 Admin Login</h2>
            <form method="POST" action="/admin/login">
              <div class="mb-3">
                <input type="text" name="username" class="form-control" placeholder="Username" required>
              </div>
              <div class="mb-3">
                <input type="password" name="password" class="form-control" placeholder="Password" required>
              </div>
              <button type="submit" class="btn btn-primary w-100">Login</button>
            </form>
          </div>
        </div>
      </body>
    </html>
  `);
});


// Handle login
app.post("/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === "Minista of enjoyment" && password === "6776") {
    isLoggedIn = true;
    res.redirect("/admin/bookings");
  } else {
    res.send("<h2>❌ Invalid credentials. <a href='/admin/login'>Try again</a></h2>");
  }
});

// Logout
app.get("/admin/logout", (req, res) => {
  isLoggedIn = false;
  res.send("<h2>✅ Logged out. <a href='/admin/login'>Login again</a></h2>");
});

// Middleware
function requireLogin(req, res, next) {
  if (isLoggedIn) return next();
  res.redirect("/admin/login");
}

// Helper to render admin table
function renderPage(title, heading, headers, rows) {
  return `
    <html>
      <head>
        <title>${title}</title>
        <!-- ✅ Bootstrap CSS -->
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="container py-4">
        <nav class="mb-4">
          <a href="/admin/bookings" class="btn btn-primary me-2">📑 Bookings</a>
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

// ----------------- BOOKINGS -----------------

app.get("/admin/bookings", requireLogin, (req, res) => {
  db.all("SELECT * FROM bookings ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).send("<h1>Error loading bookings</h1>");
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
          <form method="POST" action="/admin/bookings/delete/${r.id}" style="display:inline;" onsubmit="return confirm('⚠️ Are you sure you want to delete this booking?');">
            <button type="submit" class="btn delete">Delete</button>
          </form>
          <form method="GET" action="/admin/bookings/edit/${r.id}" style="display:inline;">
            <button type="submit" class="btn edit">Edit</button>
          </form>
        </td>
      </tr>`).join("");
    res.send(renderPage("Bookings", "📑 All Bookings",
      ["ID","Name","Email","Phone","Room","Guests","Check-in","Check-out","Created","Actions"], rowsHtml));
  });
});

// Delete booking
app.post("/admin/bookings/delete/:id", requireLogin, (req, res) => {
  console.log("🗑️ Deleting booking ID:", req.params.id);
  db.run("DELETE FROM bookings WHERE id = ?", [req.params.id], function (err) {
    if (err) {
      console.error("❌ Delete error:", err.message);
      return res.status(500).send("❌ Error deleting booking: " + err.message);
    }
    console.log(`✅ Deleted rows: ${this.changes}`);
    res.redirect("/admin/bookings");
  });
});


// Edit booking page
app.get("/admin/bookings/edit/:id", requireLogin, (req, res) => {
  db.get("SELECT * FROM bookings WHERE id = ?", [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).send("<h1>Booking not found</h1>");
    res.send(`
      <html>
        <head><title>Edit Booking</title></head>
        <body style="font-family:Arial; padding:20px;">
          <h2>✏️ Edit Booking ID: ${row.id}</h2>
          <form method="POST" action="/admin/bookings/edit/${row.id}">
            <input type="text" name="name" value="${row.name}" required/><br/><br/>
            <input type="email" name="email" value="${row.email}" required/><br/><br/>
            <input type="text" name="phone" value="${row.phone}" required/><br/><br/>
            <input type="text" name="room" value="${row.room}" required/><br/><br/>
            <input type="number" name="guests" value="${row.guests}" required/><br/><br/>
            <input type="date" name="check_in" value="${row.check_in}" required/><br/><br/>
            <input type="date" name="check_out" value="${row.check_out}" required/><br/><br/>
            <button type="submit">💾 Save Changes</button>
          </form>
        </body>
      </html>
    `);
  });
});

// Save booking edits
app.post("/admin/bookings/edit/:id", requireLogin, (req, res) => {
  const { name, email, phone, room, guests, check_in, check_out } = req.body;
  db.run(
    `UPDATE bookings SET name=?, email=?, phone=?, room=?, guests=?, check_in=?, check_out=? WHERE id=?`,
    [name, email, phone, room, guests, check_in, check_out, req.params.id],
    (err) => {
      if (err) return res.status(500).send("❌ Error updating booking");
      res.redirect("/admin/bookings");
    }
  );
});

// ----------------- CONTACTS -----------------

app.get("/admin/contacts", requireLogin, (req, res) => {
  db.all("SELECT * FROM contacts ORDER BY created_at DESC", [], (err, rows) => {
    if (err) return res.status(500).send("<h1>Error loading contacts</h1>");
    const rowsHtml = rows.map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${r.name}</td>
        <td>${r.email}</td>
        <td>${r.message}</td>
        <td>${r.created_at}</td>
        <td>
         <form method="POST" action="/admin/contacts/delete/${r.id}" style="display:inline;" onsubmit="return confirm('⚠️ Are you sure you want to delete this contact?');">
            <button type="submit" class="btn delete">Delete</button>
          </form>
          <form method="GET" action="/admin/contacts/edit/${r.id}" style="display:inline;">
            <button type="submit" class="btn edit">Edit</button>
          </form>
        </td>
      </tr>`).join("");
    res.send(renderPage("Contacts", "📧 All Contacts",
      ["ID","Name","Email","Message","Created","Actions"], rowsHtml));
  });
});

// Delete contact
app.post("/admin/contacts/delete/:id", requireLogin, (req, res) => {
  db.run("DELETE FROM contacts WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).send("❌ Error deleting contact");
    res.redirect("/admin/contacts");
  });
});

// Edit contact page
app.get("/admin/contacts/edit/:id", requireLogin, (req, res) => {
  db.get("SELECT * FROM contacts WHERE id = ?", [req.params.id], (err, row) => {
    if (err || !row) return res.status(404).send("<h1>Contact not found</h1>");
    res.send(`
      <html>
        <head><title>Edit Contact</title></head>
        <body style="font-family:Arial; padding:20px;">
          <h2>✏️ Edit Contact ID: ${row.id}</h2>
          <form method="POST" action="/admin/contacts/edit/${row.id}">
            <input type="text" name="name" value="${row.name}" required/><br/><br/>
            <input type="email" name="email" value="${row.email}" required/><br/><br/>
            <textarea name="message" required>${row.message}</textarea><br/><br/>
            <button type="submit">💾 Save Changes</button>
          </form>
        </body>
      </html>
    `);
  });
});

// Save contact edits
app.post("/admin/contacts/edit/:id", requireLogin, (req, res) => {
  const { name, email, message } = req.body;
  db.run(
    `UPDATE contacts SET name=?, email=?, message=? WHERE id=?`,
    [name, email, message, req.params.id],
    (err) => {
      if (err) return res.status(500).send("❌ Error updating contact");
      res.redirect("/admin/contacts");
    }
  );
});

// ----------------- START -----------------
app.listen(3000, () => {
  console.log("🚀 Running at http://localhost:3000");
});
