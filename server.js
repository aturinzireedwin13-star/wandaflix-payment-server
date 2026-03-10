const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const CONSUMER_KEY = "CjmavNhVjPUfzdByvopgp0iWy81L75MM";
const CONSUMER_SECRET = "jTjD/OOj77qJZJrqqFx8HGfzhLM=";

// Root route
app.get("/", (req, res) => {
    res.send("Wandaflix Payment Server Running");
});

// Pesapal token route
app.get("/get-token", async (req, res) => {
    try {
        const response = await fetch(
            "https://cybqa.pesapal.com/pesapalv3/api/Auth/RequestToken",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    consumer_key: CONSUMER_KEY,
                    consumer_secret: CONSUMER_SECRET
                })
            }
        );
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Token request failed" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});