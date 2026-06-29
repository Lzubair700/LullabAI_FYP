require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function showData() {
  const users = await pool.query("SELECT * FROM users");
  console.log("Users:", users.rows);

  const feedback = await pool.query("SELECT * FROM feedback");
  console.log("Feedback:", feedback.rows);

  await pool.end();
}

showData();
