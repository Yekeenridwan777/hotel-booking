const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./hotel.db");

db.all("SELECT * FROM lounge_bookings;", (err, rows) => {
  if (err) console.error("❌ Error reading data:", err.message);
  else console.log("✅ Lounge Bookings:", rows);
  db.close();
});