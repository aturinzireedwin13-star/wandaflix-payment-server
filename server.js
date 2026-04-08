const express = require("express");
const fetch = require("node-fetch");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const CONSUMER_KEY = "CjmavNhVjPUfzdByvopgp0iWy81L75MM";
const CONSUMER_SECRET = "jTjD/OOj77qJZJrqqFx8HGfzhLM=";
const IPN_ID = "af8de284-55a1-4e81-b00d-da86eb52bdf0";

// ✅ FIXED URLs: V3 uses /api/... not /pesapalv3/api/...
const BASE_URL = "https://pay.pesapal.com/v3/api"; 

// 1️⃣ HELPER: GET AUTH TOKEN
async function getAuthToken() {
    const response = await fetch(`${BASE_URL}/Auth/RequestToken`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ consumer_key: CONSUMER_KEY, consumer_secret: CONSUMER_SECRET })
    });
    const data = await response.json();
    return data.token;
}

// 2️⃣ ROUTE: GENERATE PAYMENT LINK
app.post("/pay", async (req, res) => {
    try {
        const token = await getAuthToken();
        
        const orderData = {
            id: `WANDA-${Date.now()}`, // Unique ID for this transaction
            currency: "UGX",
            amount: req.body.amount || 1000,
            description: "Wandaflix Access",
            callback_url: "https://your-domain.com/callback", 
            notification_id: IPN_ID,
            billing_address: {
                email_address: req.body.email || "customer@wandaflix.com",
                first_name: "Wandaflix",
                last_name: "User"
            }
        };

        const response = await fetch(`${BASE_URL}/Transactions/SubmitOrderRequest`, {
            method: "POST",
            headers: { 
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(orderData)
        });

        const result = await response.json();
        res.json(result); // This sends the redirect_url to your app
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3️⃣ ROUTE: IPN HANDLER (The "Unlocker")
app.get("/ipn", async (req, res) => {
    const { OrderTrackingId, OrderMerchantReference } = req.query;
    
    // Here is where you check status and unlock the movie in Firebase
    console.log(`Payment Notification received for ${OrderMerchantReference}`);
    
    // Pesapal status check logic would go here
    res.json({ status: 200, message: "OK" });
});

app.listen(PORT, () => console.log(`Wandaflix API live on port ${PORT}`));
