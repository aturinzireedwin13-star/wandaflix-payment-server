const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Your Pesapal keys
const CONSUMER_KEY = "CjmavNhVjPUfzdByvopgp0iWy81L75MM";
const CONSUMER_SECRET = "jTjD/OOj77qJZJrqqFx8HGfzhLM=";

// Choose environment: "sandbox" or "production"
const ENVIRONMENT = "sandbox"; // change to "production" if using live keys

const PESAPAL_URL = ENVIRONMENT === "sandbox"
  ? "https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken"
  : "https://www.pesapal.com/pesapalv3/api/Auth/RequestToken";

// Root route
app.get("/", (req, res) => {
  res.send("Wandaflix Payment Server Running");
});

// Get Pesapal token
app.get("/get-token", async (req, res) => {
  try {
    console.log("Requesting Pesapal token...");

    // Trim keys to avoid accidental whitespace
    const body = {
      consumer_key: CONSUMER_KEY.trim(),
      consumer_secret: CONSUMER_SECRET.trim()
    };

    const response = await fetch(PESAPAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    console.log("Pesapal response:", data);

    if (data.error) {
      // Log and return Pesapal error
      console.error("Pesapal API error:", data);
      return res.status(500).json({ error: data });
    }

    res.json(data);
  } catch (error) {
    console.error("Request failed:", error);
    res.status(500).json({ error: "Token request failed", details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});